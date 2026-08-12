import fs from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { SIDECAR_HOST } from '../../sidecar/config.js'
import { sweepProjectMetas } from '../../sidecar/meta-files.js'
import { AssetMetaSchema, type AssetMeta } from '../../sidecar/meta-schema.js'
import { MetaViewSchema, type MetaView } from '../../sidecar/meta-view-schema.js'
import { startServer, type ServerHandle } from '../../sidecar/server.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The one write the editor can ask for, and everything it is refused.
 *
 * The service's privilege is three lines wide (editor-kernel D17) and this file
 * is where the middle one is held to its edges: it replaces a named `.meta` when
 * the editor hands over a whole valid document, and does nothing else. Every
 * refusal is checked against the file's bytes *and* its timestamp, because
 * contents alone pass for a file that was rewritten identically — which is a
 * different promise from "did not write" (editor-verification V12).
 */

const SAMPLE = {
  'assets/textures/knight.png': 'pretend-png',
  'assets/textures/slime.png': 'pretend-png',
  'assets/audio/jump.wav': 'pretend-wav',
  'assets/source/README.txt': 'originals live here',
  'assets/textures/gone.png.meta': '{ "format": "kernel2d.asset-meta", "version": 1 }',
  'scenes/level-01.json': '{}',
}

interface Harness {
  project: TempProject
  /** The running service, for the handful of checks that need it directly. */
  url: string
  read: (path: string) => Promise<MetaView>
  write: (path: string, document: unknown) => Promise<Response>
  /** Sends a body verbatim, for the cases where it is not valid JSON at all. */
  writeRaw: (path: string, body: string) => Promise<Response>
  /** The `.meta` on disk, parsed. Nothing here trusts the answer over the file. */
  onDisk: (path: string) => Promise<AssetMeta>
}

async function withServer<T>(body: (harness: Harness) => Promise<T>): Promise<T> {
  const project = await makeTempProject(SAMPLE)
  await sweepProjectMetas(project.root)

  let server: ServerHandle | null = null
  try {
    server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })
    const url = server.url
    const at = (path: string): string => `${url}/meta?path=${encodeURIComponent(path)}`

    const put = (path: string, body: string): Promise<Response> =>
      fetch(at(path), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })

    return await body({
      project,
      url,
      read: async (path) => MetaViewSchema.parse(await (await fetch(at(path))).json()),
      write: (path, document) => put(path, JSON.stringify(document)),
      writeRaw: put,
      onDisk: async (path) =>
        AssetMetaSchema.parse(JSON.parse(await fs.readFile(project.file(`${path}.meta`), 'utf8'))),
    })
  } finally {
    await server?.close()
    await project.cleanup()
  }
}

/** Bytes and timestamp together — the pair that makes "untouched" checkable. */
async function fingerprint(absolutePath: string): Promise<{ text: string; modifiedAt: number }> {
  const [text, stats] = await Promise.all([fs.readFile(absolutePath, 'utf8'), fs.stat(absolutePath)])
  return { text, modifiedAt: stats.mtimeMs }
}

describe('the editor changing a setting', () => {
  it('writes what it was given, and the file on disk says so', async () => {
    await withServer(async ({ read, write, onDisk }) => {
      const before = await read('assets/textures/knight.png')
      const next = { ...before.meta, importSettings: { ...before.meta?.importSettings, filter: 'linear' } }

      const response = await write('assets/textures/knight.png', next)

      expect(response.status).toBe(200)
      const settings = (await onDisk('assets/textures/knight.png')).importSettings
      expect(settings.type === 'texture' && settings.filter).toBe('linear')
    })
  })

  it('answers with what is now on disk, so one round trip settles the truth', async () => {
    await withServer(async ({ read, write }) => {
      const before = await read('assets/textures/knight.png')
      const next = { ...before.meta, importSettings: { ...before.meta?.importSettings, filter: 'linear' } }

      const answer = MetaViewSchema.parse(await (await write('assets/textures/knight.png', next)).json())

      expect(answer.status).toBe('ok')
      expect(answer.meta).toEqual(next)
    })
  })

  /**
   * The write/watch/re-read cycle terminates because this is true: what comes
   * back is what went out, so adopting it changes nothing and nothing is
   * written a second time. Asserted here rather than only argued in a comment.
   */
  it('reads back exactly what was written, which is what stops the write cycle feeding itself', async () => {
    await withServer(async ({ read, write }) => {
      const before = await read('assets/textures/knight.png')
      const next = {
        ...before.meta,
        importSettings: {
          type: 'texture',
          filter: 'linear',
          pivot: { x: 0.25, y: 1 },
          slice: { mode: 'grid', frameWidth: 24, frameHeight: 32, margin: 1, spacing: 2 },
        },
      }

      await write('assets/textures/knight.png', next)
      const after = await read('assets/textures/knight.png')

      expect(after.meta).toEqual(next)
    })
  })

  it('keeps a key a human added by hand, which the editor never saw', async () => {
    await withServer(async ({ project, read, write, onDisk }) => {
      const metaPath = project.file('assets/textures/knight.png.meta')
      const handEdited = {
        ...JSON.parse(await fs.readFile(metaPath, 'utf8')),
        myOwnNote: 'the walk cycle starts on frame 3',
      }
      await fs.writeFile(metaPath, `${JSON.stringify(handEdited, null, 2)}\n`)

      // The editor reads it, changes one setting, and writes the whole document
      // back — which is exactly the moment an unmodelled key would disappear.
      const view = await read('assets/textures/knight.png')
      await write('assets/textures/knight.png', {
        ...view.meta,
        importSettings: { ...view.meta?.importSettings, filter: 'linear' },
      })

      const after = (await onDisk('assets/textures/knight.png')) as AssetMeta & { myOwnNote?: string }
      expect(after.myOwnNote).toBe('the walk cycle starts on frame 3')
    })
  })

  it('accepts a type that disagrees with the extension, because the file beats its name', async () => {
    await withServer(async ({ read, write, onDisk }) => {
      const before = await read('assets/textures/knight.png')

      const response = await write('assets/textures/knight.png', {
        ...before.meta,
        type: 'other',
        importSettings: { type: 'other' },
      })

      expect(response.status).toBe(200)
      expect((await onDisk('assets/textures/knight.png')).type).toBe('other')
    })
  })

  it('can be asked for by the sidecar file name as well as by the asset name', async () => {
    await withServer(async ({ read, write, onDisk }) => {
      const before = await read('assets/textures/knight.png')

      const response = await write('assets/textures/knight.png.meta', {
        ...before.meta,
        importSettings: { ...before.meta?.importSettings, filter: 'linear' },
      })

      expect(response.status).toBe(200)
      const settings = (await onDisk('assets/textures/knight.png')).importSettings
      expect(settings.type === 'texture' && settings.filter).toBe('linear')
    })
  })
})

describe('the editor service refuses a write, and leaves the file exactly as it was', () => {
  const refusals: [description: string, path: string, document: unknown][] = [
    ['a document that is not import settings at all', 'assets/textures/knight.png', { hello: 'world' }],
    [
      'a version it does not know, rather than reading it on a hope',
      'assets/textures/knight.png',
      {
        format: 'kernel2d.asset-meta',
        version: 2,
        id: 'abc',
        type: 'texture',
        importSettings: { type: 'texture', filter: 'nearest', pivot: { x: 0, y: 0 }, slice: { mode: 'single' } },
      },
    ],
    [
      'a sheet that does not say how big its frames are',
      'assets/textures/knight.png',
      {
        format: 'kernel2d.asset-meta',
        version: 1,
        id: 'abc',
        type: 'texture',
        importSettings: { type: 'texture', filter: 'nearest', pivot: { x: 0, y: 0 }, slice: { mode: 'grid' } },
      },
    ],
    [
      'settings that disagree with the type they are filed under',
      'assets/textures/knight.png',
      {
        format: 'kernel2d.asset-meta',
        version: 1,
        id: 'abc',
        type: 'audio',
        importSettings: { type: 'texture', filter: 'nearest', pivot: { x: 0, y: 0 }, slice: { mode: 'single' } },
      },
    ],
  ]

  it.each(refusals)('refuses %s', async (_description, path, document) => {
    await withServer(async ({ project, write }) => {
      const metaPath = project.file(`${path}.meta`)
      const before = await fingerprint(metaPath)

      const response = await write(path, document)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
      expect(await fingerprint(metaPath)).toEqual(before)
    })
  })

  it('refuses settings that did not arrive as readable JSON', async () => {
    await withServer(async ({ project, writeRaw }) => {
      const metaPath = project.file('assets/textures/knight.png.meta')
      const before = await fingerprint(metaPath)

      const response = await writeRaw('assets/textures/knight.png', '{ half a file')
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
      expect(await fingerprint(metaPath)).toEqual(before)
    })
  })

  it.each([
    ['a step out of the project folder', '../../secrets.txt'],
    ['a step out in the middle of one', 'assets/../../secrets.txt'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows absolute path', 'C:\\Windows\\System32\\config'],
    ['a folder it never reads', 'node_modules/thing/index.js'],
    ['no path at all', ''],
  ])('refuses to write to %s, with a reason rather than a stack trace', async (_description, path) => {
    await withServer(async ({ write }) => {
      const response = await write(path, {})
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
    })
  })

  /**
   * A `.meta` with no file beside it is deleted at the next startup, so writing
   * one is a change that quietly does not survive the day. Refusing is the
   * honest answer.
   */
  it('refuses to write settings that would be left stranded', async () => {
    await withServer(async ({ write }) => {
      const response = await write('assets/textures/nothing-here.png', {
        format: 'kernel2d.asset-meta',
        version: 1,
        id: 'abc',
        type: 'texture',
        importSettings: { type: 'texture', filter: 'nearest', pivot: { x: 0, y: 0 }, slice: { mode: 'single' } },
      })
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toContain('stranded')
    })
  })

  /**
   * The widened privilege is one method on one route, and this is the negative
   * half of that claim — the half a later session breaks by accident while
   * making the positive half more helpful (editor-verification V13).
   */
  it('still refuses every other method, on every other route', async () => {
    await withServer(async ({ url }) => {
      for (const [method, path] of [
        ['PUT', '/tree'],
        ['PUT', '/'],
        ['POST', '/meta'],
        ['DELETE', '/meta'],
      ] as const) {
        const response = await fetch(`${url}${path}`, { method, body: '{}' })

        expect(`${method} ${path} → ${response.status}`).toBe(`${method} ${path} → 405`)
      }
    })
  })
})
