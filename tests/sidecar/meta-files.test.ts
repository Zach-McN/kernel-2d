import fs from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  BadPathError,
  ensureMetaFor,
  ensureMetaForDeletedSidecar,
  mintAssetId,
  readMetaView,
  resolveInsideProject,
  sweepProjectMetas,
} from '../../sidecar/meta-files.js'
import { AssetMetaSchema, type AssetMeta } from '../../sidecar/meta-schema.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The sidecar's only write into a human's project folder, held to exactly the
 * privilege it was given: create a `.meta` that is missing, delete one at
 * startup that has nothing beside it, and never touch one that exists.
 *
 * Tested against a real filesystem rather than a mock (editor-verification V2).
 * Every property worth knowing here — whether an exclusive create really
 * refuses, whether a file came back byte-identical — belongs to the operating
 * system, and a fake cannot get it wrong in the same way the real thing does.
 */

const SAMPLE = {
  'assets/textures/knight.png': 'pretend-png',
  'assets/textures/slime.png': 'pretend-png',
  'assets/audio/jump.wav': 'pretend-wav',
  'assets/source/README.txt': 'originals live here',
  'scenes/level-01.json': '{}',
  'project.json': '{}',
}

async function withProject<T>(
  files: Readonly<Record<string, string>>,
  body: (project: TempProject) => Promise<T>,
): Promise<T> {
  const project = await makeTempProject(files)
  try {
    return await body(project)
  } finally {
    await project.cleanup()
  }
}

describe('giving assets that were already there their settings', () => {
  it('writes a .meta beside every asset it finds', async () => {
    await withProject(SAMPLE, async (project) => {
      const report = await sweepProjectMetas(project.root)

      expect(report.created).toEqual([
        'assets/audio/jump.wav.meta',
        'assets/textures/knight.png.meta',
        'assets/textures/slime.png.meta',
      ])
      await expect(fs.readFile(project.file('assets/textures/knight.png.meta'), 'utf8')).resolves.toContain(
        '"type": "texture"',
      )
    })
  })

  it('writes something the schema accepts, with an id of its own', async () => {
    await withProject(SAMPLE, async (project) => {
      await sweepProjectMetas(project.root)

      const read = async (path: string): Promise<AssetMeta> =>
        AssetMetaSchema.parse(JSON.parse(await fs.readFile(project.file(path), 'utf8')))

      const knight = await read('assets/textures/knight.png.meta')
      const slime = await read('assets/textures/slime.png.meta')

      expect(knight.type).toBe('texture')
      expect(knight.id).not.toBe(slime.id)
    })
  })

  it('leaves alone anything the editor does not import', async () => {
    await withProject(SAMPLE, async (project) => {
      await sweepProjectMetas(project.root)

      for (const path of ['assets/source/README.txt.meta', 'scenes/level-01.json.meta', 'project.json.meta']) {
        await expect(fs.access(project.file(path))).rejects.toThrow()
      }
    })
  })

  it('never gives a .meta a .meta of its own', async () => {
    await withProject(SAMPLE, async (project) => {
      await sweepProjectMetas(project.root)
      const second = await sweepProjectMetas(project.root)

      expect(second.created).toEqual([])
      await expect(fs.access(project.file('assets/textures/knight.png.meta.meta'))).rejects.toThrow()
    })
  })

  it('settles: running it again changes nothing at all', async () => {
    await withProject(SAMPLE, async (project) => {
      await sweepProjectMetas(project.root)
      const before = await fs.readFile(project.file('assets/textures/knight.png.meta'), 'utf8')

      const second = await sweepProjectMetas(project.root)

      expect(second.created).toEqual([])
      expect(second.kept).toBe(3)
      expect(await fs.readFile(project.file('assets/textures/knight.png.meta'), 'utf8')).toBe(before)
    })
  })

  it('does not read into folders the editor ignores', async () => {
    await withProject({ ...SAMPLE, 'node_modules/some-package/logo.png': 'pretend-png' }, async (project) => {
      const report = await sweepProjectMetas(project.root)

      expect(report.created).not.toContain('node_modules/some-package/logo.png.meta')
      await expect(fs.access(project.file('node_modules/some-package/logo.png.meta'))).rejects.toThrow()
    })
  })
})

describe('settings a human already wrote', () => {
  const mine = '{\n  "format": "kernel2d.asset-meta",\n  "version": 1,\n  "id": "mine",\n  "type": "audio",\n  "importSettings": { "type": "audio" }\n}\n'

  it('is read, never regenerated — byte for byte, down to the timestamp', async () => {
    await withProject({ ...SAMPLE, 'assets/audio/jump.wav.meta': mine }, async (project) => {
      const before = await fs.stat(project.file('assets/audio/jump.wav.meta'))

      await sweepProjectMetas(project.root)

      const after = await fs.stat(project.file('assets/audio/jump.wav.meta'))
      expect(await fs.readFile(project.file('assets/audio/jump.wav.meta'), 'utf8')).toBe(mine)
      expect(after.mtimeMs).toBe(before.mtimeMs)
    })
  })

  it('is left alone even when it is broken, because a broken file is usually one being edited', async () => {
    await withProject({ ...SAMPLE, 'assets/audio/jump.wav.meta': '{ not json' }, async (project) => {
      await sweepProjectMetas(project.root)

      expect(await fs.readFile(project.file('assets/audio/jump.wav.meta'), 'utf8')).toBe('{ not json')
    })
  })

  it('is not replaced by a second sidecar racing for the same file', async () => {
    await withProject(SAMPLE, async (project) => {
      const first = await ensureMetaFor(project.file('assets/textures/knight.png'))
      const written = await fs.readFile(project.file('assets/textures/knight.png.meta'), 'utf8')

      const second = await ensureMetaFor(project.file('assets/textures/knight.png'))

      expect(first).toBe('created')
      expect(second).toBe('kept')
      expect(await fs.readFile(project.file('assets/textures/knight.png.meta'), 'utf8')).toBe(written)
    })
  })
})

describe('settings whose file has gone', () => {
  const orphan = { 'assets/textures/removed.png.meta': '{}', ...SAMPLE }

  it('are cleared out at startup, and named so the human can see what went', async () => {
    await withProject(orphan, async (project) => {
      const report = await sweepProjectMetas(project.root)

      expect(report.removedOrphans).toEqual(['assets/textures/removed.png.meta'])
      await expect(fs.access(project.file('assets/textures/removed.png.meta'))).rejects.toThrow()
    })
  })

  it('are not the same thing as settings beside a file the editor does not import', async () => {
    await withProject({ ...SAMPLE, 'assets/source/README.txt.meta': '{}' }, async (project) => {
      const report = await sweepProjectMetas(project.root)

      expect(report.removedOrphans).toEqual([])
      await expect(fs.access(project.file('assets/source/README.txt.meta'))).resolves.toBeUndefined()
    })
  })

  it('come back when the file is still there and the settings were deleted', async () => {
    await withProject(SAMPLE, async (project) => {
      await sweepProjectMetas(project.root)
      await fs.rm(project.file('assets/textures/knight.png.meta'))

      const outcome = await ensureMetaForDeletedSidecar(project.file('assets/textures/knight.png.meta'))

      expect(outcome).toBe('created')
      await expect(fs.access(project.file('assets/textures/knight.png.meta'))).resolves.toBeUndefined()
    })
  })

  it('do not come back when the file went with them', async () => {
    await withProject(SAMPLE, async (project) => {
      await sweepProjectMetas(project.root)
      await fs.rm(project.file('assets/textures/knight.png'))
      await fs.rm(project.file('assets/textures/knight.png.meta'))

      const outcome = await ensureMetaForDeletedSidecar(project.file('assets/textures/knight.png.meta'))

      expect(outcome).toBe('not-an-asset')
      await expect(fs.access(project.file('assets/textures/knight.png.meta'))).rejects.toThrow()
    })
  })
})

describe('the id minted for a new asset', () => {
  it('is short enough to read out and long enough not to collide', () => {
    const ids = new Set(Array.from({ length: 500 }, mintAssetId))

    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('a path arriving from a browser', () => {
  it('is accepted when it is an ordinary project-relative path', () => {
    const resolved = resolveInsideProject('C:\\games\\my-game', 'assets/textures/knight.png')

    expect(resolved.ok).toBe(true)
  })

  it.each([
    ['nothing at all', ''],
    ['a step upwards', '../secrets.txt'],
    ['a step upwards in the middle', 'assets/../../secrets.txt'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows absolute path', 'C:\\Windows\\System32\\config'],
    ['a folder the editor never reads', 'node_modules/thing/index.js'],
  ])('is refused when it is %s', (_description, requested) => {
    const resolved = resolveInsideProject('C:\\games\\my-game', requested)

    expect(resolved.ok).toBe(false)
  })
})

describe('answering what one file holds', () => {
  it('says so when there are no settings beside it', async () => {
    await withProject(SAMPLE, async (project) => {
      const view = await readMetaView(project.root, 'scenes/level-01.json')

      expect(view.status).toBe('none')
      expect(view.metaPath).toBeNull()
      expect(view.meta).toBeNull()
    })
  })

  it('hands back the settings when they are there', async () => {
    await withProject(SAMPLE, async (project) => {
      await sweepProjectMetas(project.root)

      const view = await readMetaView(project.root, 'assets/textures/knight.png')

      expect(view.status).toBe('ok')
      expect(view.metaPath).toBe('assets/textures/knight.png.meta')
      expect(view.meta?.type).toBe('texture')
    })
  })

  it('answers about a sidecar asked for by its own name, so an orphan can be looked at', async () => {
    await withProject({ 'assets/textures/gone.png.meta': '{}' }, async (project) => {
      const view = await readMetaView(project.root, 'assets/textures/gone.png.meta')

      expect(view.metaPath).toBe('assets/textures/gone.png.meta')
      expect(view.status).toBe('unreadable')
    })
  })

  it('shows what is in a file it cannot read, rather than only refusing it', async () => {
    await withProject({ 'assets/textures/knight.png.meta': '{ not json' }, async (project) => {
      const view = await readMetaView(project.root, 'assets/textures/knight.png')

      expect(view.status).toBe('unreadable')
      expect(view.problem).toContain('not valid JSON')
      expect(view.text).toBe('{ not json')
    })
  })

  it('says which part of a well-formed file it did not understand', async () => {
    const wrongVersion = JSON.stringify({ format: 'kernel2d.asset-meta', version: 99 })

    await withProject({ 'assets/textures/knight.png.meta': wrongVersion }, async (project) => {
      const view = await readMetaView(project.root, 'assets/textures/knight.png')

      expect(view.status).toBe('unreadable')
      expect(view.problem).toContain('version')
    })
  })

  it('refuses to answer about anything outside the project folder', async () => {
    await withProject(SAMPLE, async (project) => {
      await expect(readMetaView(project.root, '../../secrets.txt')).rejects.toBeInstanceOf(BadPathError)
    })
  })

  it('always answers with forward slashes, whatever the machine writes', async () => {
    await withProject(SAMPLE, async (project) => {
      await sweepProjectMetas(project.root)

      const view = await readMetaView(project.root, 'assets/textures/knight.png')

      expect(view.path).not.toContain('\\')
      expect(view.metaPath).not.toContain('\\')
    })
  })
})
