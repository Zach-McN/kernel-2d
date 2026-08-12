import fs from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { serializeScene, type Scene } from '../../runtime/formats/scene-schema.js'
import { SIDECAR_HOST } from '../../sidecar/config.js'
import { DocumentViewSchema, type DocumentView } from '../../sidecar/document-view-schema.js'
import { startServer, type ServerHandle } from '../../sidecar/server.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * Documents over the wire: what the editor can open, what it can put back, and
 * everything it is refused.
 *
 * This is where the write privilege (editor-kernel D17) is held to its edges.
 *
 * **Creating and replacing are two requests, and the tests are written to prove
 * neither can do the other's job.** A create refuses when anything is at the
 * path; a replace refuses when nothing is. That pair is what stands between
 * "make a new level" and "erase this level" when the caller is confused about
 * which one it wanted, and it is asserted from both sides.
 *
 * The other guard with a block of its own: a replace only ever puts a document
 * where one of that format already is. Without it, a valid scene sent at the
 * path of somebody's PNG would overwrite their art and pass every other check.
 *
 * Every refusal is checked against the file's bytes *and* its timestamp, because
 * contents alone pass for a file that was rewritten identically — a different
 * promise from "did not write" (editor-verification V12).
 */

const KNIGHT = {
  id: '9c1f4a2b7e0d5638',
  name: 'Knight',
  transform: { x: 120, y: 24, rotation: 0, scaleX: 1, scaleY: 1 },
  components: {
    sprite: { texture: { id: 'a3f90011deadbeef', path: 'assets/textures/knight.png' } },
  },
}

const LEVEL: Scene = { format: 'kernel2d.scene', version: 1, entities: [KNIGHT] }

const SAMPLE: Record<string, string> = {
  // An empty folder, so a prefab can be made in one. The service never creates a
  // folder on the way to a file, which is a guard with its own test below — so
  // without this the prefab tests would fail for the right reason in the wrong
  // place.
  'prefabs/': '',
  'scenes/level-01.json': serializeScene(LEVEL),
  'scenes/broken.json': '{ half a file',
  'scenes/from-the-future.json': '{ "format": "kernel2d.starfield", "version": 9 }\n',
  'assets/textures/knight.png': 'pretend-png',
  'assets/textures/knight.png.meta':
    '{ "format": "kernel2d.asset-meta", "version": 1, "id": "a3f90011deadbeef", "type": "texture",' +
    ' "importSettings": { "type": "texture", "filter": "nearest", "pivot": { "x": 0.5, "y": 1 },' +
    ' "slice": { "mode": "single" } } }\n',
}

interface Harness {
  project: TempProject
  url: string
  read: (path: string) => Promise<DocumentView>
  write: (path: string, document: unknown) => Promise<Response>
  writeRaw: (path: string, body: string) => Promise<Response>
  /** The other half of the privilege: make one where there is nothing. */
  create: (path: string, document: unknown) => Promise<Response>
  /** The scene on disk, parsed from the file rather than from any answer. */
  onDisk: (path: string) => Promise<Record<string, unknown>>
}

async function withServer<T>(body: (harness: Harness) => Promise<T>): Promise<T> {
  const project = await makeTempProject(SAMPLE)

  let server: ServerHandle | null = null
  try {
    server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })
    const url = server.url
    const at = (path: string): string => `${url}/document?path=${encodeURIComponent(path)}`

    const send = (method: 'PUT' | 'POST', path: string, raw: string): Promise<Response> =>
      fetch(at(path), { method, headers: { 'Content-Type': 'application/json' }, body: raw })

    const put = (path: string, raw: string): Promise<Response> => send('PUT', path, raw)

    return await body({
      project,
      url,
      read: async (path) => DocumentViewSchema.parse(await (await fetch(at(path))).json()),
      write: (path, document) => put(path, JSON.stringify(document)),
      writeRaw: put,
      create: (path, document) => send('POST', path, JSON.stringify(document)),
      onDisk: async (path) =>
        JSON.parse(await fs.readFile(project.file(path), 'utf8')) as Record<string, unknown>,
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

describe('opening a document', () => {
  it('hands back the scene that is there', async () => {
    await withServer(async ({ read }) => {
      const view = await read('scenes/level-01.json')

      expect(view.status).toBe('ok')
      expect(view.document).toEqual(LEVEL)
    })
  })

  it('says there is nothing there, rather than failing, for a path with no file', async () => {
    await withServer(async ({ read }) => {
      const view = await read('scenes/level-99.json')

      expect(view.status).toBe('none')
      expect(view.document).toBeNull()
    })
  })

  it('says what is wrong with a file it cannot read, and shows it', async () => {
    await withServer(async ({ read }) => {
      const view = await read('scenes/broken.json')

      expect(view.status).toBe('unreadable')
      expect(view.problem ?? '').toMatch(/^[A-Z].*\.$/)
      // Being told a file is unreadable without being shown it forces the human
      // out of the editor to find out why.
      expect(view.text).toBe('{ half a file')
    })
  })

  it('names a format it does not know, rather than calling the file invalid', async () => {
    await withServer(async ({ read }) => {
      const view = await read('scenes/from-the-future.json')

      expect(view.status).toBe('unreadable')
      expect(view.problem ?? '').toContain('kernel2d.starfield')
    })
  })

  it.each([
    ['a step out of the project folder', '../../secrets.txt'],
    ['an absolute path', '/etc/passwd'],
    ['a folder it never reads', 'node_modules/thing/index.js'],
    ['no path at all', ''],
  ])('refuses to read %s, with a reason rather than a stack trace', async (_description, path) => {
    await withServer(async ({ url }) => {
      const response = await fetch(`${url}/document?path=${encodeURIComponent(path)}`)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
    })
  })
})

describe('putting a document back', () => {
  const moved: Scene = {
    ...LEVEL,
    entities: [{ ...KNIGHT, transform: { ...KNIGHT.transform, x: 200 } }],
  }

  it('writes what it was given, and the file on disk says so', async () => {
    await withServer(async ({ write, onDisk }) => {
      const response = await write('scenes/level-01.json', moved)

      expect(response.status).toBe(200)
      expect(await onDisk('scenes/level-01.json')).toEqual(moved)
    })
  })

  it('answers with what is now on disk, so one round trip settles the truth', async () => {
    await withServer(async ({ write }) => {
      const answer = DocumentViewSchema.parse(await (await write('scenes/level-01.json', moved)).json())

      expect(answer.status).toBe('ok')
      expect(answer.document).toEqual(moved)
    })
  })

  /**
   * The write/watch/re-read cycle terminates because this is true: what comes
   * back is what went out, so adopting it changes nothing and nothing is written
   * a second time. Asserted rather than only argued in a comment.
   */
  it('reads back exactly what was written, which is what stops the write cycle feeding itself', async () => {
    await withServer(async ({ read, write }) => {
      await write('scenes/level-01.json', moved)

      expect((await read('scenes/level-01.json')).document).toEqual(moved)
    })
  })

  it('writes it as readable, line-at-a-time text a human can edit', async () => {
    await withServer(async ({ project, write }) => {
      await write('scenes/level-01.json', moved)
      const text = await fs.readFile(project.file('scenes/level-01.json'), 'utf8')

      expect(text.split('\n').length).toBeGreaterThan(5)
      expect(text.endsWith('\n')).toBe(true)
    })
  })
})

/**
 * The tripwire that has to exist before the second writer of a format does.
 *
 * The editor rewrites a scene wholesale from the object it parsed, so a key the
 * schema does not model is a key deleted out of a file a human wrote — and the
 * ordinary round-trip test cannot catch it, because it only ever compares fields
 * the schema knows about (text-formats F1). This is the version that can: the
 * document goes out through the real service, comes back, and goes out again.
 */
describe('making a document where there is nothing', () => {
  const EMPTY: Scene = { format: 'kernel2d.scene', version: 1, entities: [] }

  it('makes the file, and what is on disk is what was asked for', async () => {
    await withServer(async ({ create, onDisk }) => {
      const response = await create('scenes/level-03.json', EMPTY)

      expect(response.status).toBe(201)
      expect(await onDisk('scenes/level-03.json')).toEqual(EMPTY)
    })
  })

  it('answers with what is now there, so one round trip settles the truth', async () => {
    await withServer(async ({ create }) => {
      const view = DocumentViewSchema.parse(await (await create('scenes/level-03.json', EMPTY)).json())

      expect(view.status).toBe('ok')
      expect(view.path).toBe('scenes/level-03.json')
      expect(view.document).toEqual(EMPTY)
    })
  })

  it('writes it as readable, line-at-a-time text a human can edit', async () => {
    await withServer(async ({ project, create }) => {
      await create('scenes/level-03.json', EMPTY)
      const raw = await fs.readFile(project.file('scenes/level-03.json'), 'utf8')

      expect(raw.split('\n').length).toBeGreaterThan(3)
      expect(raw.endsWith('\n')).toBe(true)
    })
  })

  it('makes one the editor can immediately open and put back', async () => {
    await withServer(async ({ create, read, write, onDisk }) => {
      await create('scenes/level-03.json', EMPTY)

      expect((await read('scenes/level-03.json')).status).toBe('ok')

      const response = await write('scenes/level-03.json', { ...EMPTY, entities: [KNIGHT] })
      expect(response.status).toBe(200)
      expect((await onDisk('scenes/level-03.json'))['entities']).toHaveLength(1)
    })
  })
})

/**
 * The half of the privilege that keeps the other half from being dangerous.
 *
 * A create that quietly replaced would be indistinguishable from working right
 * up until the day it destroyed a level, so every one of these checks the file's
 * bytes *and* its timestamp (V12) — identical contents alone would also pass for
 * a file that had been rewritten with the same text.
 */
describe('making a document is refused, and leaves the folder exactly as it was', () => {
  const EMPTY: Scene = { format: 'kernel2d.scene', version: 1, entities: [] }

  it('never writes over a scene that is already there', async () => {
    await withServer(async ({ project, create }) => {
      const before = await fingerprint(project.file('scenes/level-01.json'))

      const response = await create('scenes/level-01.json', EMPTY)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
      expect(await fingerprint(project.file('scenes/level-01.json'))).toEqual(before)
    })
  })

  it('never writes over somebody’s art, which is the same guard one step further', async () => {
    await withServer(async ({ project, create }) => {
      const before = await fingerprint(project.file('assets/textures/knight.png'))

      const response = await create('assets/textures/knight.png', EMPTY)

      expect(response.status).toBe(400)
      expect(await fingerprint(project.file('assets/textures/knight.png'))).toEqual(before)
    })
  })

  it('never writes over a file it cannot even read', async () => {
    await withServer(async ({ project, create }) => {
      const before = await fingerprint(project.file('scenes/broken.json'))

      const response = await create('scenes/broken.json', EMPTY)

      expect(response.status).toBe(400)
      expect(await fingerprint(project.file('scenes/broken.json'))).toEqual(before)
    })
  })

  it('never makes a folder on the way, and says so', async () => {
    await withServer(async ({ project, create }) => {
      const response = await create('levels/chapter-two/level-03.json', EMPTY)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
      // Neither the file nor either folder on the way to it.
      await expect(fs.access(project.file('levels'))).rejects.toThrow()
    })
  })

  it('refuses a document that is not one this editor writes', async () => {
    await withServer(async ({ project, create }) => {
      const response = await create('scenes/level-03.json', { format: 'kernel2d.starfield', version: 1 })

      expect(response.status).toBe(400)
      await expect(fs.access(project.file('scenes/level-03.json'))).rejects.toThrow()
    })
  })

  it('refuses a scene that is malformed, rather than making a file nobody can open', async () => {
    await withServer(async ({ project, create }) => {
      const response = await create('scenes/level-03.json', {
        format: 'kernel2d.scene',
        version: 1,
        entities: [{ id: 'a', name: 'One' }],
      })

      expect(response.status).toBe(400)
      await expect(fs.access(project.file('scenes/level-03.json'))).rejects.toThrow()
    })
  })

  it.each([
    ['a step out of the project folder', '../../secrets.txt'],
    ['a step out in the middle of one', 'scenes/../../secrets.txt'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows absolute path', 'C:\\Windows\\System32\\config'],
    ['a folder it never reads', 'node_modules/thing/index.js'],
    ['no path at all', ''],
  ])('refuses to make one at %s, with a reason rather than a stack trace', async (_description, path) => {
    await withServer(async ({ create }) => {
      const response = await create(path, EMPTY)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
    })
  })
})

/**
 * A second document format, over the same wire.
 *
 * The point of these is not that prefabs work — that is the format's own tests'
 * job. It is that teaching this service a second format cost one line in the
 * registry and widened nothing: the same create, the same replace, the same
 * refusals, and in particular the same guard against turning one kind of
 * document into another at a path that already holds something.
 */
describe('the service knows more than one kind of document', () => {
  const PREFAB = {
    format: 'kernel2d.prefab',
    version: 1,
    id: 'aabbccddeeff0011',
    name: 'Slime',
    components: {
      sprite: { texture: { id: 'a3f90011deadbeef', path: 'assets/textures/knight.png' } },
    },
  }

  it('makes a prefab, and what is on disk is what was asked for', async () => {
    await withServer(async ({ create, onDisk }) => {
      const response = await create('prefabs/enemy-slime.json', PREFAB)

      expect(response.status).toBe(201)
      expect(await onDisk('prefabs/enemy-slime.json')).toEqual(PREFAB)
    })
  })

  it('opens one it made, and puts it back changed', async () => {
    await withServer(async ({ create, read, write, onDisk }) => {
      await create('prefabs/enemy-slime.json', PREFAB)
      expect((await read('prefabs/enemy-slime.json')).status).toBe('ok')

      const response = await write('prefabs/enemy-slime.json', { ...PREFAB, name: 'Cave slime' })

      expect(response.status).toBe(200)
      expect((await onDisk('prefabs/enemy-slime.json'))['name']).toBe('Cave slime')
    })
  })

  it('refuses a prefab that is an instance of another prefab', async () => {
    await withServer(async ({ project, create }) => {
      const response = await create('prefabs/enemy-slime.json', {
        ...PREFAB,
        components: { prefab: { source: { id: 'aabb', path: 'prefabs/other.json' } } },
      })

      expect(response.status).toBe(400)
      await expect(fs.access(project.file('prefabs/enemy-slime.json'))).rejects.toThrow()
    })
  })

  /**
   * The guard that matters once there is more than one format: a document is
   * only ever replaced by one of the format already at that path. A prefab
   * written over a level would be a valid document, at a path inside the
   * project, passing every other check — and somebody's level would be gone.
   */
  it('never turns a level into a prefab, however valid the prefab is', async () => {
    await withServer(async ({ project, write }) => {
      const before = await fingerprint(project.file('scenes/level-01.json'))

      const response = await write('scenes/level-01.json', PREFAB)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
      expect(await fingerprint(project.file('scenes/level-01.json'))).toEqual(before)
    })
  })

  it('never turns a prefab into a level either, which is the same rule the other way', async () => {
    await withServer(async ({ project, create, write }) => {
      await create('prefabs/enemy-slime.json', PREFAB)
      const before = await fingerprint(project.file('prefabs/enemy-slime.json'))

      const response = await write('prefabs/enemy-slime.json', {
        format: 'kernel2d.scene',
        version: 1,
        entities: [],
      })

      expect(response.status).toBe(400)
      expect(await fingerprint(project.file('prefabs/enemy-slime.json'))).toEqual(before)
    })
  })

  it('names both formats when refusing something it has never heard of', async () => {
    await withServer(async ({ create }) => {
      const response = await create('prefabs/x.json', { format: 'kernel2d.starfield', version: 1 })
      const body = (await response.json()) as { error?: string }

      expect(body.error ?? '').toContain('kernel2d.scene')
      expect(body.error ?? '').toContain('kernel2d.prefab')
    })
  })
})

describe('a key a human added by hand survives the editor writing the file', () => {
  it('keeps one at the top level', async () => {
    await withServer(async ({ project, read, write, onDisk }) => {
      const scenePath = project.file('scenes/level-01.json')
      await fs.writeFile(scenePath, `${JSON.stringify({ ...LEVEL, myOwnNote: 'boss spawns here' }, null, 2)}\n`)

      const view = await read('scenes/level-01.json')
      await write('scenes/level-01.json', {
        ...(view.document as Scene),
        entities: [{ ...KNIGHT, transform: { ...KNIGHT.transform, x: 200 } }],
      })

      expect((await onDisk('scenes/level-01.json'))['myOwnNote']).toBe('boss spawns here')
    })
  })

  it('keeps ones nested inside an entity, its transform and its components', async () => {
    await withServer(async ({ project, read, write, onDisk }) => {
      const handEdited = {
        ...LEVEL,
        entities: [
          {
            ...KNIGHT,
            designerNote: 'faces right on purpose',
            transform: { ...KNIGHT.transform, snapToGrid: true },
            components: {
              sprite: { texture: KNIGHT.components.sprite.texture, tint: '#ffddaa' },
              patrolRoute: { waypoints: [{ x: 10, y: 0 }], loop: true },
            },
          },
        ],
      }
      await fs.writeFile(project.file('scenes/level-01.json'), `${JSON.stringify(handEdited, null, 2)}\n`)

      // The editor opens it, moves the entity, and writes the whole document
      // back — exactly the moment an unmodelled key would disappear.
      const view = await read('scenes/level-01.json')
      const document = view.document as Scene
      const entity = document.entities[0]
      await write('scenes/level-01.json', {
        ...document,
        entities: [{ ...entity, transform: { ...entity?.transform, x: 200 } }],
      })

      const after = (await onDisk('scenes/level-01.json')) as unknown as typeof handEdited
      const survivor = after.entities[0]

      expect(survivor?.designerNote).toBe('faces right on purpose')
      expect(survivor?.transform.snapToGrid).toBe(true)
      expect(survivor?.transform.x).toBe(200)
      expect(survivor?.components.sprite.tint).toBe('#ffddaa')
      expect(survivor?.components.patrolRoute).toEqual({ waypoints: [{ x: 10, y: 0 }], loop: true })
    })
  })
})

describe('the editor service refuses a write, and leaves the file exactly as it was', () => {
  it('refuses a document that is not one this editor writes', async () => {
    await withServer(async ({ project, write }) => {
      const before = await fingerprint(project.file('scenes/level-01.json'))

      const response = await write('scenes/level-01.json', { hello: 'world' })
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
      expect(await fingerprint(project.file('scenes/level-01.json'))).toEqual(before)
    })
  })

  it('refuses a scene version it does not know, rather than writing it on a hope', async () => {
    await withServer(async ({ project, write }) => {
      const before = await fingerprint(project.file('scenes/level-01.json'))

      const response = await write('scenes/level-01.json', { ...LEVEL, version: 2 })

      expect(response.status).toBe(400)
      expect(await fingerprint(project.file('scenes/level-01.json'))).toEqual(before)
    })
  })

  it('refuses a scene with two entities sharing an id', async () => {
    await withServer(async ({ project, write }) => {
      const before = await fingerprint(project.file('scenes/level-01.json'))

      const response = await write('scenes/level-01.json', { ...LEVEL, entities: [KNIGHT, KNIGHT] })

      expect(response.status).toBe(400)
      expect(await fingerprint(project.file('scenes/level-01.json'))).toEqual(before)
    })
  })

  it('refuses a document that did not arrive as readable JSON', async () => {
    await withServer(async ({ project, writeRaw }) => {
      const before = await fingerprint(project.file('scenes/level-01.json'))

      const response = await writeRaw('scenes/level-01.json', '{ half a file')

      expect(response.status).toBe(400)
      expect(await fingerprint(project.file('scenes/level-01.json'))).toEqual(before)
    })
  })

  /**
   * A replace is a replace. Making a new scene has its own request, and a
   * caller that reached for the wrong one gets a sentence — not a file.
   */
  it('never creates a file that is not already there', async () => {
    await withServer(async ({ project, write }) => {
      const response = await write('scenes/level-99.json', LEVEL)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toContain('never creates')
      await expect(fs.access(project.file('scenes/level-99.json'))).rejects.toThrow()
    })
  })

  /**
   * Guard 2, and the one worth having a test named after it: without it, a
   * perfectly valid scene document sent at a texture's path passes every other
   * check and overwrites somebody's art.
   */
  it('refuses to write a scene over a file that is not a document at all', async () => {
    await withServer(async ({ project, write }) => {
      const before = await fingerprint(project.file('assets/textures/knight.png'))

      const response = await write('assets/textures/knight.png', LEVEL)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
      expect(await fingerprint(project.file('assets/textures/knight.png'))).toEqual(before)
    })
  })

  it('refuses to write a scene over a .meta, which has its own endpoint and its own rules', async () => {
    await withServer(async ({ project, write }) => {
      const before = await fingerprint(project.file('assets/textures/knight.png.meta'))

      const response = await write('assets/textures/knight.png.meta', LEVEL)

      expect(response.status).toBe(400)
      expect(await fingerprint(project.file('assets/textures/knight.png.meta'))).toEqual(before)
    })
  })

  it('refuses to repair a file it cannot read, because it is more likely mid-edit than rubbish', async () => {
    await withServer(async ({ project, write }) => {
      const before = await fingerprint(project.file('scenes/broken.json'))

      const response = await write('scenes/broken.json', LEVEL)

      expect(response.status).toBe(400)
      expect(await fingerprint(project.file('scenes/broken.json'))).toEqual(before)
    })
  })

  it.each([
    ['a step out of the project folder', '../../secrets.txt'],
    ['a step out in the middle of one', 'scenes/../../secrets.txt'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows absolute path', 'C:\\Windows\\System32\\config'],
    ['a folder it never reads', 'node_modules/thing/index.js'],
    ['no path at all', ''],
  ])('refuses to write to %s, with a reason rather than a stack trace', async (_description, path) => {
    await withServer(async ({ write }) => {
      const response = await write(path, LEVEL)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
    })
  })

  /**
   * The widened privilege is two methods on two routes and nothing else. This is
   * the negative half of that claim — the half a later session breaks by
   * accident while making the positive half more helpful (V13).
   */
  it('still refuses every other method, on every other route', async () => {
    await withServer(async ({ url }) => {
      for (const [method, path] of [
        ['PUT', '/tree'],
        ['PUT', '/asset'],
        ['POST', '/meta'],
        ['POST', '/tree'],
        ['DELETE', '/document'],
      ] as const) {
        const response = await fetch(`${url}${path}`, { method, body: '{}' })

        expect(`${method} ${path} → ${response.status}`).toBe(`${method} ${path} → 405`)
      }
    })
  })
})
