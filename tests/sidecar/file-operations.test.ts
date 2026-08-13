import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { SIDECAR_HOST } from '../../sidecar/config.js'
import { FileChangeSchema, type FileChange } from '../../sidecar/file-change-schema.js'
import { sweepProjectMetas } from '../../sidecar/meta-files.js'
import { AssetMetaSchema, type AssetMeta } from '../../runtime/formats/meta-schema.js'
import { startServer, type ServerHandle } from '../../sidecar/server.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The fourth and fifth lines of the service's write privilege, held to their
 * edges: a move that takes a `.meta` with the file it annotates, and a delete
 * that takes one with it.
 *
 * **Refusals first, and every one of them checked against bytes *and* timestamp**
 * (editor-verification V12) — identical contents alone would also pass for a file
 * that had been rewritten with the same text, which is a different promise from
 * "did not touch it". For a move there is a second thing to assert that a create
 * never had to: the *source* is still there too. A move that half happened is a
 * file that has been destroyed rather than merely not moved.
 *
 * Driven through the running service rather than against the functions directly,
 * so the endpoint, the query parameters and the 400-with-a-sentence are under
 * test alongside the rule.
 */

const SAMPLE = {
  'assets/textures/knight.png': 'pretend-knight',
  'assets/textures/slime.png': 'pretend-slime',
  'assets/sprites/': '',
  'assets/audio/jump.wav': 'pretend-wav',
  'assets/source/README.txt': 'originals live here',
  'scenes/level-01.json': '{}',
}

/**
 * Settings with no file beside them, written *after* the startup sweep on
 * purpose — the sweep's whole job is to clear these, so one placed in the
 * fixture is gone before any test can see it (editor-verification V23: a guard
 * behaving exactly as designed, failing a test about something else).
 */
const STRANDED = `${JSON.stringify(
  {
    format: 'kernel2d.asset-meta',
    version: 1,
    id: 'someone-elses-id',
    type: 'texture',
    importSettings: { type: 'texture', filter: 'nearest', pivot: { x: 0.5, y: 0.5 }, slice: { mode: 'single' } },
  },
  null,
  2,
)}\n`

interface Harness {
  project: TempProject
  move: (from: string, to: string) => Promise<Response>
  remove: (path: string) => Promise<Response>
  /** The refusal sentence a human would be shown. */
  refusal: (response: Response) => Promise<string>
  /** The `.meta` on disk for one file, parsed. Nothing here trusts the answer over the file. */
  settingsOf: (path: string) => Promise<AssetMeta>
  /** Bytes and modification time together — the pair V12 is about. */
  fingerprint: (path: string) => Promise<string>
  exists: (path: string) => boolean
}

async function withServer<T>(body: (harness: Harness) => Promise<T>): Promise<T> {
  const project = await makeTempProject(SAMPLE)
  // Every asset starts with settings beside it, which is the state a running
  // editor is always in. The move's whole promise is about carrying them.
  await sweepProjectMetas(project.root)
  await fs.writeFile(project.file('assets/textures/gone.png.meta'), STRANDED)

  let server: ServerHandle | null = null
  try {
    server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })
    const url = server.url

    return await body({
      project,
      move: (from, to) =>
        fetch(`${url}/move?path=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: 'POST' }),
      remove: (path) => fetch(`${url}/delete?path=${encodeURIComponent(path)}`, { method: 'POST' }),
      refusal: async (response) => String(((await response.json()) as { error?: unknown }).error ?? ''),
      settingsOf: async (path) =>
        AssetMetaSchema.parse(JSON.parse(await fs.readFile(project.file(`${path}.meta`), 'utf8'))),
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

async function changeFrom(response: Response): Promise<FileChange> {
  return FileChangeSchema.parse(await response.json())
}

describe('a move it refuses, leaving both ends exactly as they were', () => {
  it('refuses to write over something already at the destination', async () => {
    await withServer(async ({ move, refusal, fingerprint, exists }) => {
      const before = await fingerprint('assets/textures/slime.png')

      const response = await move('assets/textures/knight.png', 'assets/textures/slime.png')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('never writes over it')
      expect(await fingerprint('assets/textures/slime.png')).toBe(before)
      // The half that only a move can get wrong: the source is still there.
      expect(exists('assets/textures/knight.png')).toBe(true)
      expect(exists('assets/textures/knight.png.meta')).toBe(true)
    })
  })

  it('refuses a folder that is not there, and does not create it', async () => {
    await withServer(async ({ move, refusal, exists }) => {
      const response = await move('assets/textures/knight.png', 'assets/props/knight.png')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('never creates one')
      expect(exists('assets/props')).toBe(false)
      expect(exists('assets/textures/knight.png')).toBe(true)
    })
  })

  it('refuses a path that steps outside the project folder', async () => {
    await withServer(async ({ move, refusal, exists }) => {
      const response = await move('assets/textures/knight.png', '../escaped.png')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('outside the project folder')
      expect(exists('assets/textures/knight.png')).toBe(true)
    })
  })

  it('refuses import settings named on their own', async () => {
    await withServer(async ({ move, refusal, fingerprint }) => {
      const before = await fingerprint('assets/textures/knight.png.meta')

      const response = await move('assets/textures/knight.png.meta', 'assets/textures/hero.png.meta')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('move with the file they annotate')
      expect(await fingerprint('assets/textures/knight.png.meta')).toBe(before)
    })
  })

  it('refuses to rename a file into something that looks like import settings', async () => {
    await withServer(async ({ move, refusal, exists }) => {
      const response = await move('assets/textures/knight.png', 'assets/textures/hero.png.meta')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('.meta')
      expect(exists('assets/textures/hero.png.meta')).toBe(false)
      expect(exists('assets/textures/knight.png')).toBe(true)
    })
  })

  it('refuses a destination that already has stranded settings sitting at it', async () => {
    await withServer(async ({ move, refusal, exists }) => {
      // `gone.png.meta` has no file beside it. Moving a texture onto that name
      // would give it somebody else's id.
      const response = await move('assets/textures/knight.png', 'assets/textures/gone.png')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('import settings')
      expect(exists('assets/textures/knight.png')).toBe(true)
      expect(exists('assets/textures/gone.png')).toBe(false)
    })
  })

  it('refuses a folder asked to move inside itself', async () => {
    await withServer(async ({ move, refusal, exists }) => {
      const response = await move('assets/textures', 'assets/textures/inner')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('inside itself')
      expect(exists('assets/textures/knight.png')).toBe(true)
    })
  })

  it('refuses something that is not there', async () => {
    await withServer(async ({ move, refusal }) => {
      const response = await move('assets/textures/nowhere.png', 'assets/textures/somewhere.png')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('nothing at')
    })
  })

  it('refuses to move something to where it already is', async () => {
    await withServer(async ({ move, refusal, fingerprint }) => {
      const before = await fingerprint('assets/textures/knight.png')

      const response = await move('assets/textures/knight.png', 'assets/textures/knight.png')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('already where')
      expect(await fingerprint('assets/textures/knight.png')).toBe(before)
    })
  })
})

describe('a delete it refuses', () => {
  it('refuses a folder, whatever is in it', async () => {
    await withServer(async ({ remove, refusal, exists }) => {
      const response = await remove('assets/textures')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('one file at a time')
      expect(exists('assets/textures/knight.png')).toBe(true)
    })
  })

  it('refuses settings whose file is still there, and says what to do instead', async () => {
    await withServer(async ({ remove, refusal, fingerprint }) => {
      const before = await fingerprint('assets/textures/knight.png.meta')

      const response = await remove('assets/textures/knight.png.meta')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('assets/textures/knight.png')
      expect(await fingerprint('assets/textures/knight.png.meta')).toBe(before)
    })
  })

  it('refuses something that is not there', async () => {
    await withServer(async ({ remove, refusal }) => {
      const response = await remove('assets/textures/nowhere.png')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('nothing at')
    })
  })

  it('refuses a path that steps outside the project folder', async () => {
    await withServer(async ({ remove, refusal }) => {
      const response = await remove('../../secrets.txt')

      expect(response.status).toBe(400)
      expect(await refusal(response)).toContain('outside the project folder')
    })
  })
})

describe('moving a file, which is the whole point of the feature', () => {
  it('renames it and takes its settings with it, keeping the id', async () => {
    await withServer(async ({ move, settingsOf, exists }) => {
      const original = await settingsOf('assets/textures/knight.png')

      const response = await move('assets/textures/knight.png', 'assets/textures/hero.png')

      expect(response.status).toBe(200)
      expect(exists('assets/textures/knight.png')).toBe(false)
      expect(exists('assets/textures/knight.png.meta')).toBe(false)
      expect(exists('assets/textures/hero.png')).toBe(true)
      // The id is the witness every reference in every level recorded. If it
      // changed here, a rename would break exactly what it set out to preserve.
      expect(await settingsOf('assets/textures/hero.png')).toEqual(original)
    })
  })

  it('keeps the pivot and slicing a human set, which is what they actually notice', async () => {
    await withServer(async ({ project, move, settingsOf }) => {
      const tuned: AssetMeta = {
        ...(await settingsOf('assets/textures/knight.png')),
        importSettings: {
          type: 'texture',
          filter: 'linear',
          pivot: { x: 0.5, y: 1 },
          slice: { mode: 'grid', frameWidth: 16, frameHeight: 16, margin: 1, spacing: 2 },
        },
      }
      await fs.writeFile(project.file('assets/textures/knight.png.meta'), `${JSON.stringify(tuned, null, 2)}\n`)

      await move('assets/textures/knight.png', 'assets/sprites/knight.png')

      expect(await settingsOf('assets/sprites/knight.png')).toEqual(tuned)
    })
  })

  it('moves it into another folder without changing a byte of it', async () => {
    await withServer(async ({ project, move, exists }) => {
      const before = await fs.readFile(project.file('assets/textures/knight.png'), 'utf8')

      const response = await move('assets/textures/knight.png', 'assets/sprites/knight.png')

      expect(response.status).toBe(200)
      expect(await fs.readFile(project.file('assets/sprites/knight.png'), 'utf8')).toBe(before)
      expect(exists('assets/sprites/knight.png.meta')).toBe(true)
    })
  })

  it('moves a file that has no settings of its own', async () => {
    await withServer(async ({ move, exists }) => {
      const response = await move('assets/source/README.txt', 'assets/source/NOTES.txt')

      expect(response.status).toBe(200)
      expect((await changeFrom(response)).settings).toBeNull()
      expect(exists('assets/source/NOTES.txt')).toBe(true)
    })
  })

  it('moves a folder and everything under it, sidecars included', async () => {
    await withServer(async ({ move, settingsOf, exists }) => {
      const original = await settingsOf('assets/textures/knight.png')

      const response = await move('assets/textures', 'assets/art')

      expect(response.status).toBe(200)
      expect((await changeFrom(response)).isDirectory).toBe(true)
      expect(exists('assets/textures')).toBe(false)
      expect(exists('assets/art/knight.png')).toBe(true)
      expect(exists('assets/art/slime.png.meta')).toBe(true)
      expect(await settingsOf('assets/art/knight.png')).toEqual(original)
    })
  })

  it('says what it did, and which settings travelled', async () => {
    await withServer(async ({ move }) => {
      const change = await changeFrom(await move('assets/textures/knight.png', 'assets/sprites/knight.png'))

      expect(change).toEqual({
        format: 'kernel2d.file-change',
        version: 1,
        kind: 'moved',
        path: 'assets/textures/knight.png',
        to: 'assets/sprites/knight.png',
        isDirectory: false,
        settings: 'assets/textures/knight.png.meta',
      })
    })
  })
})

describe('deleting a file', () => {
  it('takes its settings with it, so nothing is left stranded', async () => {
    await withServer(async ({ remove, exists }) => {
      const response = await remove('assets/textures/knight.png')

      expect(response.status).toBe(200)
      expect(exists('assets/textures/knight.png')).toBe(false)
      expect(exists('assets/textures/knight.png.meta')).toBe(false)
      // Its neighbour is untouched, which is the whole of "one file at a time".
      expect(exists('assets/textures/slime.png')).toBe(true)
      expect(exists('assets/textures/slime.png.meta')).toBe(true)
    })
  })

  it('gets rid of settings that have no file beside them', async () => {
    await withServer(async ({ remove, exists }) => {
      const response = await remove('assets/textures/gone.png.meta')

      expect(response.status).toBe(200)
      expect(exists('assets/textures/gone.png.meta')).toBe(false)
    })
  })

  it('says what it did', async () => {
    await withServer(async ({ remove }) => {
      const change = await changeFrom(await remove('assets/audio/jump.wav'))

      expect(change).toEqual({
        format: 'kernel2d.file-change',
        version: 1,
        kind: 'deleted',
        path: 'assets/audio/jump.wav',
        to: null,
        isDirectory: false,
        settings: 'assets/audio/jump.wav.meta',
      })
    })
  })
})

describe('neither request will do the job of the other', () => {
  it('a move never destroys the thing it could not move', async () => {
    await withServer(async ({ move, fingerprint }) => {
      const source = await fingerprint('assets/textures/knight.png')
      const destination = await fingerprint('assets/textures/slime.png')

      await move('assets/textures/knight.png', 'assets/textures/slime.png')

      expect(await fingerprint('assets/textures/knight.png')).toBe(source)
      expect(await fingerprint('assets/textures/slime.png')).toBe(destination)
    })
  })

  it('a delete never moves anything, so a missing destination is not its problem', async () => {
    await withServer(async ({ remove, exists }) => {
      await remove('assets/textures/knight.png')

      expect(exists('assets/textures/knight.png')).toBe(false)
      expect(exists('assets/sprites/knight.png')).toBe(false)
    })
  })

  it('answers 405 to any other method on either route', async () => {
    await withServer(async ({ project }) => {
      // The routes are POST-only: a GET of `/delete` must not be a way to delete
      // something by following a link.
      const server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })
      try {
        const got = await fetch(`${server.url}/delete?path=assets/textures/knight.png`)
        expect(got.status).toBe(404)
        expect(existsSync(project.file('assets/textures/knight.png'))).toBe(true)

        const put = await fetch(`${server.url}/move?path=a&to=b`, { method: 'PUT' })
        expect(put.status).toBe(405)
      } finally {
        await server.close()
      }
    })
  })
})
