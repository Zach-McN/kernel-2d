import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import http from 'node:http'

import { describe, expect, it } from 'vitest'

import { SIDECAR_HOST } from '../../sidecar/config.js'
import { sweepProjectMetas } from '../../sidecar/meta-files.js'
import { startServer, type ServerHandle } from '../../sidecar/server.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * Who may ask, driven through the running service.
 *
 * The service binds to 127.0.0.1, which bounds who can *connect* — not who can
 * *instruct*. Any web page open in any browser on this machine can fire a blind
 * POST at the loopback port: it cannot read the answer, but `/delete` does not
 * need its answer read to destroy a file, and a simple POST with query
 * parameters never triggers the preflight that would stop it. The browser
 * stamps `Origin` on every such request and the page cannot forge it, so the
 * rule under test is the guard in `sidecar/request-guard.ts`: a state-changing
 * request whose Origin names anywhere but this machine is refused, and any
 * request whose Host does is refused too — the Host half being what a
 * DNS-rebound page cannot avoid sending.
 *
 * Every refusal is checked against the disk as well as the status line
 * (editor-verification V12's instinct): a guard that answers 403 and writes
 * anyway would pass a status-only test. Forged headers are sent through
 * `node:http` directly, because `fetch` treats Origin and Host as its own to
 * set — which is exactly the property the attack relies on, and exactly why
 * the tests must not rely on `fetch` here.
 */

const SAMPLE = {
  'assets/textures/knight.png': 'pretend-knight',
  'assets/textures/slime.png': 'pretend-slime',
  'assets/sprites/': '',
  'scenes/level-01.json': '{}',
}

interface Sent {
  status: number
  /** The refusal sentence a human would be shown, or '' when there was none. */
  error: string
}

interface Harness {
  project: TempProject
  send: (options: { method: string; path: string; headers?: Record<string, string>; body?: string }) => Promise<Sent>
  /** Bytes and modification time together — "did not touch it", not "same text". */
  fingerprint: (path: string) => Promise<string>
  exists: (path: string) => boolean
}

async function withServer<T>(body: (harness: Harness) => Promise<T>): Promise<T> {
  const project = await makeTempProject(SAMPLE)
  await sweepProjectMetas(project.root)

  let server: ServerHandle | null = null
  try {
    server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })
    const port = server.port

    return await body({
      project,
      send: (options) =>
        new Promise<Sent>((resolve, reject) => {
          const request = http.request(
            { host: SIDECAR_HOST, port, path: options.path, method: options.method, headers: options.headers },
            (response) => {
              const chunks: Buffer[] = []
              response.on('data', (chunk: Buffer) => chunks.push(chunk))
              response.on('end', () => {
                let error = ''
                try {
                  error = String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: unknown }).error ?? '')
                } catch {
                  // A non-JSON body is simply a response with no refusal sentence in it.
                }
                resolve({ status: response.statusCode ?? 0, error })
              })
            },
          )
          request.on('error', reject)
          request.end(options.body)
        }),
      fingerprint: async (path) => {
        const absolute = project.file(path)
        const [bytes, stats] = await Promise.all([fs.readFile(absolute, 'utf8'), fs.stat(absolute)])
        return `${bytes}@${stats.mtimeMs}`
      },
      exists: (path) => existsSync(project.file(path)),
    })
  } finally {
    await server?.close()
    await project.cleanup()
  }
}

const FORGED = { Origin: 'https://evil.example' }

describe("a write asked for by another site's web page is refused, and nothing on disk moves", () => {
  it('refuses a delete, and the file and its settings are untouched', async () => {
    await withServer(async ({ send, fingerprint, exists }) => {
      const before = await fingerprint('assets/textures/knight.png')

      const response = await send({
        method: 'POST',
        path: '/delete?path=assets/textures/knight.png',
        headers: FORGED,
      })

      expect(response.status).toBe(403)
      expect(response.error).toContain("other sites' web pages")
      expect(response.error).toContain('https://evil.example')
      expect(await fingerprint('assets/textures/knight.png')).toBe(before)
      expect(exists('assets/textures/knight.png.meta')).toBe(true)
    })
  })

  it('refuses a move, leaving both ends exactly as they were', async () => {
    await withServer(async ({ send, fingerprint, exists }) => {
      const before = await fingerprint('assets/textures/knight.png')

      const response = await send({
        method: 'POST',
        path: '/move?path=assets/textures/knight.png&to=assets/sprites/knight.png',
        headers: FORGED,
      })

      expect(response.status).toBe(403)
      expect(await fingerprint('assets/textures/knight.png')).toBe(before)
      expect(exists('assets/sprites/knight.png')).toBe(false)
    })
  })

  it('refuses to replace import settings, before ever reading the body', async () => {
    await withServer(async ({ send, fingerprint }) => {
      const before = await fingerprint('assets/textures/knight.png.meta')

      const response = await send({
        method: 'PUT',
        path: '/meta?path=assets/textures/knight.png',
        headers: FORGED,
        body: '{}',
      })

      // 403 with the guard's sentence, not the 400 a bad body would earn:
      // the request was turned away at the door, not argued with inside.
      expect(response.status).toBe(403)
      expect(response.error).toContain("other sites' web pages")
      expect(await fingerprint('assets/textures/knight.png.meta')).toBe(before)
    })
  })

  it('refuses to replace a document', async () => {
    await withServer(async ({ send, fingerprint }) => {
      const before = await fingerprint('scenes/level-01.json')

      const response = await send({
        method: 'PUT',
        path: '/document?path=scenes/level-01.json',
        headers: FORGED,
        body: '{}',
      })

      expect(response.status).toBe(403)
      expect(await fingerprint('scenes/level-01.json')).toBe(before)
    })
  })

  it('refuses to create a document, and no file appears', async () => {
    await withServer(async ({ send, exists }) => {
      const response = await send({
        method: 'POST',
        path: '/document?path=scenes/level-02.json',
        headers: FORGED,
        body: '{}',
      })

      expect(response.status).toBe(403)
      expect(exists('scenes/level-02.json')).toBe(false)
    })
  })

  it('refuses an Origin of "null", which is what a sandboxed page sends', async () => {
    await withServer(async ({ send, exists }) => {
      const response = await send({
        method: 'POST',
        path: '/delete?path=assets/textures/knight.png',
        headers: { Origin: 'null' },
      })

      expect(response.status).toBe(403)
      expect(exists('assets/textures/knight.png')).toBe(true)
    })
  })
})

describe("the editor's own requests still pass", () => {
  it("a delete carrying the editor window's loopback origin goes through", async () => {
    await withServer(async ({ send, exists }) => {
      const response = await send({
        method: 'POST',
        path: '/delete?path=assets/textures/knight.png',
        headers: { Origin: 'http://127.0.0.1:5173' },
      })

      expect(response.status).toBe(200)
      expect(exists('assets/textures/knight.png')).toBe(false)
    })
  })

  it('a loopback origin spelled localhost goes through too', async () => {
    await withServer(async ({ send, exists }) => {
      const response = await send({
        method: 'POST',
        path: '/move?path=assets/textures/knight.png&to=assets/sprites/knight.png',
        headers: { Origin: 'http://localhost:5173' },
      })

      expect(response.status).toBe(200)
      expect(exists('assets/sprites/knight.png')).toBe(true)
    })
  })

  it('a write with no Origin at all is not from a browser, and passes', async () => {
    await withServer(async ({ send, exists }) => {
      const response = await send({ method: 'POST', path: '/delete?path=assets/textures/slime.png' })

      expect(response.status).toBe(200)
      expect(exists('assets/textures/slime.png')).toBe(false)
    })
  })
})

describe('a request addressed to another name is refused, reads included', () => {
  it('refuses a read whose Host names another site — the DNS-rebinding door', async () => {
    await withServer(async ({ send }) => {
      const response = await send({
        method: 'GET',
        path: '/tree',
        headers: { Host: 'evil.example:7331' },
      })

      expect(response.status).toBe(403)
      expect(response.error).toContain('answers only to this machine')
      expect(response.error).toContain('evil.example')
    })
  })

  it('refuses a write whose Host names another site, even with no Origin', async () => {
    await withServer(async ({ send, exists }) => {
      const response = await send({
        method: 'POST',
        path: '/delete?path=assets/textures/knight.png',
        headers: { Host: 'evil.example:7331' },
      })

      expect(response.status).toBe(403)
      expect(exists('assets/textures/knight.png')).toBe(true)
    })
  })

  it("answers the dev server's proxy, whose Host carries the editor's port", async () => {
    await withServer(async ({ send }) => {
      const response = await send({
        method: 'GET',
        path: '/tree',
        headers: { Host: '127.0.0.1:5173' },
      })

      expect(response.status).toBe(200)
    })
  })

  it('answers a Host spelled localhost, which is a hand-typed browser address', async () => {
    await withServer(async ({ send }) => {
      const response = await send({
        method: 'GET',
        path: '/',
        headers: { Host: 'localhost:7331' },
      })

      expect(response.status).toBe(200)
    })
  })
})
