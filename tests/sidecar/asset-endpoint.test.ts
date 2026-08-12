import fs from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { SIDECAR_HOST } from '../../sidecar/config.js'
import { startServer, type ServerHandle } from '../../sidecar/server.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The one read this service does beyond describing the folder: handing over the
 * bytes of an asset, so the runtime can draw it.
 *
 * The privilege is stated in four lines at the top of `sidecar/asset-files.ts`,
 * and this file is what holds it to them. The refusals matter more than the
 * successes: a service that will hand a browser any file inside a human's
 * project folder is a much larger thing than the one that was asked for, and
 * the difference is invisible until somebody goes looking.
 */

/** A real PNG header, so the bytes served are recognisably a file and not a string. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

const SAMPLE = {
  'assets/textures/knight.png': PNG_BYTES.toString('binary'),
  'assets/textures/knight.png.meta': '{ "format": "kernel2d.asset-meta", "version": 1 }',
  'assets/audio/jump.wav': 'pretend-wav-bytes',
  'assets/source/README.txt': 'originals live here',
  'scenes/level-01.json': '{ "entities": [] }',
  'node_modules/some-package/logo.png': 'ignored',
}

async function withServer<T>(
  body: (ask: (path: string) => Promise<Response>, project: TempProject, base: string) => Promise<T>,
): Promise<T> {
  const project = await makeTempProject(SAMPLE)
  // Written again as real bytes: makeTempProject writes strings, and a PNG
  // round-tripped through utf8 is no longer a PNG.
  await fs.writeFile(project.file('assets/textures/knight.png'), PNG_BYTES)

  let server: ServerHandle | null = null
  try {
    server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })
    const url = server.url
    return await body((path) => fetch(`${url}/asset?path=${encodeURIComponent(path)}`), project, url)
  } finally {
    await server?.close()
    await project.cleanup()
  }
}

const refusal = async (response: Response): Promise<string> => {
  const body = (await response.json()) as { error?: string }
  return body.error ?? ''
}

describe('asking the editor service for the bytes of an asset', () => {
  it('hands back exactly the bytes that are on disk', async () => {
    await withServer(async (ask) => {
      const response = await ask('assets/textures/knight.png')

      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES)
    })
  })

  it('names the type from the extension, and never caches', async () => {
    await withServer(async (ask) => {
      const response = await ask('assets/textures/knight.png')

      expect(response.headers.get('content-type')).toBe('image/png')
      expect(response.headers.get('content-length')).toBe(String(PNG_BYTES.length))
      expect(response.headers.get('cache-control')).toBe('no-store')
    })
  })

  it('serves the other kinds of asset too, not only textures', async () => {
    await withServer(async (ask) => {
      const response = await ask('assets/audio/jump.wav')

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('audio/wav')
    })
  })

  it('says so plainly when there is no file there', async () => {
    await withServer(async (ask) => {
      const response = await ask('assets/textures/nothing-here.png')

      expect(response.status).toBe(404)
      expect(await refusal(response)).toMatch(/no file at that path/i)
    })
  })
})

describe('what the editor service will not hand over', () => {
  it('refuses a file it does not import, however ordinary', async () => {
    await withServer(async (ask) => {
      for (const path of ['scenes/level-01.json', 'assets/source/README.txt']) {
        const response = await ask(path)

        expect(response.status).toBe(400)
        expect(await refusal(response)).toMatch(/not a file the editor imports/i)
      }
    })
  })

  it('refuses a `.meta`, which is settings rather than an asset', async () => {
    await withServer(async (ask) => {
      const response = await ask('assets/textures/knight.png.meta')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toMatch(/not a file the editor imports/i)
    })
  })

  it('refuses to step outside the project folder', async () => {
    await withServer(async (ask) => {
      for (const path of ['../secrets.png', 'assets/../../secrets.png', './../x.png']) {
        const response = await ask(path)

        expect(response.status).toBe(400)
        expect(await refusal(response)).toMatch(/outside the project folder/i)
      }
    })
  })

  it('refuses an absolute path', async () => {
    await withServer(async (ask) => {
      for (const path of ['/etc/passwd.png', 'C:/Windows/system.png']) {
        const response = await ask(path)

        expect(response.status).toBe(400)
        expect(await refusal(response)).toMatch(/relative to the project folder/i)
      }
    })
  })

  it('refuses a path inside a folder it never reads', async () => {
    await withServer(async (ask) => {
      const response = await ask('node_modules/some-package/logo.png')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toMatch(/does not read/i)
    })
  })

  it('refuses a request that names no file at all', async () => {
    await withServer(async (_ask, _project, base) => {
      const response = await fetch(`${base}/asset`)

      expect(response.status).toBe(400)
      expect(await refusal(response)).toMatch(/no path was given/i)
    })
  })
})

describe('serving an asset changes nothing on disk', () => {
  it('leaves the file byte-for-byte and timestamp-for-timestamp as it was', async () => {
    await withServer(async (ask, project) => {
      const file = project.file('assets/textures/knight.png')
      const before = await fs.stat(file)

      await (await ask('assets/textures/knight.png')).arrayBuffer()

      const after = await fs.stat(file)
      expect(await fs.readFile(file)).toEqual(PNG_BYTES)
      // Contents alone would pass for a file rewritten with identical bytes,
      // which is a different promise (editor-verification V12).
      expect(after.mtimeMs).toBe(before.mtimeMs)
    })
  })

  it('creates no `.meta` for the file it served', async () => {
    await withServer(async (ask, project) => {
      await (await ask('assets/audio/jump.wav')).arrayBuffer()

      await expect(fs.access(project.file('assets/audio/jump.wav.meta'))).rejects.toThrow()
    })
  })
})
