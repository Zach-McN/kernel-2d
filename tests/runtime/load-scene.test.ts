import { describe, expect, it } from 'vitest'

import { defaultMeta, defaultTextureImportSettings, type AssetMeta } from '../../runtime/formats/meta-schema'
import { defaultPrefab } from '../../runtime/formats/prefab-schema'
import { defaultTransform, type Entity, type Scene } from '../../runtime/formats/scene-schema'
import { describeLoadProblem, loadScene, type ProjectReader } from '../../runtime/scene/load-scene'

/**
 * The runtime opening a level for itself.
 *
 * Everything here goes through a fake `ProjectReader`, which is the point of the
 * seam: the loader is exercised with no browser, no service, no folder and no
 * renderer, and the *same* loader is what the editor's Play button drives.
 *
 * These tests also cover the half the browser never reaches. In the editor the
 * development service parses documents before the runtime sees them, so the
 * runtime's own validation only ever runs against something already known-good.
 * A shipped game has no such service, so a file broken by hand hits these
 * schemas first — which makes the garbage cases below the only place that path
 * is tested at all.
 */

const KNIGHT_META_ID = 'a3f90011deadbeef'
const SLIME_PREFAB_ID = 'bb17c0de00000001'

const knightTexture = 'assets/textures/knight.png'

function textureMeta(id: string): AssetMeta {
  return defaultMeta('texture', id)
}

function sprite(path: string, id: string): Record<string, unknown> {
  return { sprite: { texture: { id, path } } }
}

function entity(id: string, name: string, components: Record<string, unknown> = {}): Entity {
  return { id, name, transform: defaultTransform(), components }
}

function scene(...entities: Entity[]): Scene {
  return { format: 'kernel2d.scene', version: 1, entities }
}

/**
 * A project as a plain map of path to parsed JSON.
 *
 * `asked` records every path the loader looked at, which is how the
 * deduplication tests can assert a shape rather than a count of side effects.
 */
function readerOver(files: Record<string, unknown>, versions: Record<string, number> = {}): ProjectReader & {
  asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    readJson: (path) => {
      asked.push(path)
      const file = files[path]
      if (file instanceof Error) return Promise.reject(file)
      return Promise.resolve(file ?? null)
    },
    assetVersion: (path) => versions[path] ?? 0,
  }
}

describe('loading a level', () => {
  it('reads the level, its textures and their import settings', async () => {
    const reader = readerOver(
      {
        'scenes/one.json': scene(entity('e1', 'Knight', sprite(knightTexture, KNIGHT_META_ID))),
        [`${knightTexture}.meta`]: textureMeta(KNIGHT_META_ID),
      },
      { [knightTexture]: 1712,
      },
    )

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([])
    expect(result.request.path).toBe('scenes/one.json')
    expect(result.request.scene.entities.map((one) => one.id)).toEqual(['e1'])
    // The settings are the `.meta`'s own object, `type` and all — handed
    // through rather than rebuilt, which is what keeps a key somebody added by
    // hand alive all the way to the renderer.
    expect(result.request.textures).toEqual({
      [knightTexture]: { version: 1712, settings: { type: 'texture', ...defaultTextureImportSettings() } },
    })
  })

  it('loads a texture named inside a component it has no schema for', async () => {
    // A game's systems can spawn entities mid-run — a projectile, a monster a
    // wave calls in — and nothing can fetch once a level is moving. So any
    // `texture`-named reference in any component is part of what the level
    // draws, and it has to be in the request before anything starts.
    const arrowTexture = 'assets/textures/projectiles/arrow.png'
    const tower = entity('e1', 'Archer post', {
      ...sprite(knightTexture, KNIGHT_META_ID),
      tower: { damage: 1, projectile: { texture: { id: 'feedbead00112233', path: arrowTexture } } },
    })

    const reader = readerOver({
      'scenes/one.json': scene(tower),
      [`${knightTexture}.meta`]: textureMeta(KNIGHT_META_ID),
      [`${arrowTexture}.meta`]: textureMeta('feedbead00112233'),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([])
    expect(Object.keys(result.request.textures).sort()).toEqual([knightTexture, arrowTexture].sort())
  })

  it('carries the pivot and the slicing through untouched', async () => {
    const meta: AssetMeta = {
      ...textureMeta(KNIGHT_META_ID),
      importSettings: {
        type: 'texture',
        filter: 'linear',
        pivot: { x: 0.5, y: 1 },
        slice: { mode: 'grid', frameWidth: 16, frameHeight: 24, margin: 1, spacing: 2 },
      },
    }

    const reader = readerOver({
      'scenes/one.json': scene(entity('e1', 'Knight', sprite(knightTexture, KNIGHT_META_ID))),
      [`${knightTexture}.meta`]: meta,
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    // The renderer applies these; the loader must not have an opinion about
    // them. A pivot invented here would put every sprite somewhere the editor
    // does not.
    expect(result.request.textures[knightTexture]?.settings).toEqual(meta.importSettings)
  })

  it('asks about a shared texture once', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(
        entity('e1', 'One', sprite(knightTexture, KNIGHT_META_ID)),
        entity('e2', 'Two', sprite(knightTexture, KNIGHT_META_ID)),
        entity('e3', 'Three', sprite(knightTexture, KNIGHT_META_ID)),
      ),
      [`${knightTexture}.meta`]: textureMeta(KNIGHT_META_ID),
    })

    await loadScene(reader, 'scenes/one.json')

    expect(reader.asked.filter((path) => path === `${knightTexture}.meta`)).toHaveLength(1)
  })

  it('keeps the level in draw order', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(entity('back', 'Back'), entity('middle', 'Middle'), entity('front', 'Front')),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.request.scene.entities.map((one) => one.id)).toEqual(['back', 'middle', 'front'])
  })
})

describe("a level's music", () => {
  const theme = 'assets/audio/music/theme.mp3'
  const THEME_META_ID = 'cafe0123beefbead'

  function withMusic(id: string): Scene {
    return { ...scene(entity('e1', 'Knight')), music: { id, path: theme } }
  }

  it('is resolved into the request, with the file version the host answers', async () => {
    const reader = readerOver(
      {
        'scenes/one.json': withMusic(THEME_META_ID),
        [`${theme}.meta`]: defaultMeta('audio', THEME_META_ID),
      },
      { [theme]: 41 },
    )

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([])
    expect(result.request.music).toEqual({ path: theme, version: 41 })
  })

  it('a level with no music asks for nothing and plays nothing', async () => {
    const reader = readerOver({ 'scenes/one.json': scene(entity('e1', 'Knight')) })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.request.music).toBeUndefined()
    expect(reader.asked).toEqual(['scenes/one.json'])
  })

  it('music with no import settings beside it is named, and the level runs silent', async () => {
    const reader = readerOver({ 'scenes/one.json': withMusic(THEME_META_ID) })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.request.music).toBeUndefined()
    expect(result.problems).toEqual([{ kind: 'music-unannotated', path: theme }])
    expect(describeLoadProblem(result.problems[0]!)).toContain('runs silent')
  })

  it('a file whose settings say it is not audio is refused as music, by name', async () => {
    const reader = readerOver({
      'scenes/one.json': withMusic(THEME_META_ID),
      [`${theme}.meta`]: defaultMeta('texture', THEME_META_ID),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.request.music).toBeUndefined()
    expect(result.problems).toEqual([{ kind: 'music-not-audio', path: theme, type: 'texture' }])
  })

  it('a different file at the path is played anyway, and said out loud', async () => {
    // Witnessed, not vetoed (D5): the file at the path is what the level
    // points at, and refusing to play it would say less than playing it and
    // naming the disagreement.
    const reader = readerOver({
      'scenes/one.json': withMusic('theme00expected0'),
      [`${theme}.meta`]: defaultMeta('audio', THEME_META_ID),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.request.music).toEqual({ path: theme, version: 0 })
    expect(result.problems).toEqual([
      { kind: 'music-different-file', path: theme, expected: 'theme00expected0', found: THEME_META_ID },
    ])
  })
})

describe('a level that cannot be opened at all', () => {
  it('says so when there is no file there', async () => {
    const result = await loadScene(readerOver({}), 'scenes/gone.json')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem).toBe('There is no file at scenes/gone.json.')
  })

  it('says what is wrong with a level broken by hand', async () => {
    const reader = readerOver({
      // A transform with a string in it: the shape a text editor produces.
      'scenes/one.json': {
        format: 'kernel2d.scene',
        version: 1,
        entities: [{ id: 'e1', name: 'Knight', transform: { x: 'over there' }, components: {} }],
      },
    })

    const result = await loadScene(reader, 'scenes/one.json')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem).toContain('one.json could not be loaded')
    // Points at the field rather than dumping a validator's output.
    expect(result.problem).toContain('entities.0.transform.x')
  })

  it('names the format when the file is a different kind of document', async () => {
    const reader = readerOver({ 'scenes/one.json': defaultPrefab('p1', 'Slime') })

    const result = await loadScene(reader, 'scenes/one.json')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem).toBe('one.json could not be loaded: that file is a kernel2d.prefab, not a level.')
  })

  it('passes on the reason when the file could not be fetched', async () => {
    const reader = readerOver({ 'scenes/one.json': new Error('the editor service would not answer') })

    const result = await loadScene(reader, 'scenes/one.json')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem).toBe('one.json could not be loaded: the editor service would not answer.')
  })

  it('refuses a level whose entities share an id', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(entity('same', 'One'), entity('same', 'Two')),
    })

    const result = await loadScene(reader, 'scenes/one.json')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem).toContain('two entities share the id same')
  })
})

describe('prefabs', () => {
  const slime = { ...defaultPrefab(SLIME_PREFAB_ID, 'Slime'), components: sprite(knightTexture, KNIGHT_META_ID) }
  const instance = entity('i1', 'Slime', {
    prefab: { source: { id: SLIME_PREFAB_ID, path: 'prefabs/slime.json' } },
  })

  it('fills in what an instance inherits, and its texture with it', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(instance),
      'prefabs/slime.json': slime,
      [`${knightTexture}.meta`]: textureMeta(KNIGHT_META_ID),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([])
    // Which texture a level needs cannot be known from the level alone — this is
    // why prefabs are resolved before textures are collected.
    expect(Object.keys(result.request.textures)).toEqual([knightTexture])
    expect(result.request.scene.entities[0]?.components['sprite']).toEqual({
      texture: { id: KNIGHT_META_ID, path: knightTexture },
    })
  })

  it('leaves the instance where it stands', async () => {
    const placed: Entity = { ...instance, transform: { ...defaultTransform(), x: 96, y: 32, rotation: 45 } }
    const reader = readerOver({
      'scenes/one.json': scene(placed),
      'prefabs/slime.json': slime,
      [`${knightTexture}.meta`]: textureMeta(KNIGHT_META_ID),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.request.scene.entities[0]?.transform).toEqual(placed.transform)
  })

  it('runs the level anyway when a prefab has gone, and names it', async () => {
    const reader = readerOver({ 'scenes/one.json': scene(instance) })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([{ kind: 'prefab-missing', path: 'prefabs/slime.json' }])
    // Still in the level, still somewhere, simply drawing nothing.
    expect(result.request.scene.entities).toHaveLength(1)
    expect(result.request.textures).toEqual({})
  })

  it('names a file that is not a prefab', async () => {
    const reader = readerOver({ 'scenes/one.json': scene(instance), 'prefabs/slime.json': scene() })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([
      { kind: 'prefab-unreadable', path: 'prefabs/slime.json', detail: 'that file is a kernel2d.scene, not a prefab' },
    ])
  })

  it('reports a prefab that is not the one the level was written against, and uses it anyway', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(instance),
      'prefabs/slime.json': { ...slime, id: 'something-else' },
      [`${knightTexture}.meta`]: textureMeta(KNIGHT_META_ID),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([
      {
        kind: 'prefab-different-file',
        path: 'prefabs/slime.json',
        expected: SLIME_PREFAB_ID,
        found: 'something-else',
      },
    ])
    // The witness does not veto: the file at that path is what the level points
    // at, so it is drawn and the disagreement is said out loud.
    expect(result.request.scene.entities[0]?.components['sprite']).toBeDefined()
  })
})

describe('textures', () => {
  const withSprite = scene(entity('e1', 'Knight', sprite(knightTexture, KNIGHT_META_ID)))

  it('draws nothing for a texture with no import settings beside it', async () => {
    const result = await loadScene(readerOver({ 'scenes/one.json': withSprite }), 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([{ kind: 'texture-unannotated', path: knightTexture }])
    // Deliberately not filled in with defaults: a sprite drawn on the wrong
    // pivot with the wrong frame is worse than one that is missing and named.
    expect(result.request.textures).toEqual({})
  })

  it('names import settings that will not parse', async () => {
    const reader = readerOver({
      'scenes/one.json': withSprite,
      [`${knightTexture}.meta`]: { format: 'kernel2d.asset-meta', version: 1, id: 'x' },
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems[0]?.kind).toBe('texture-unreadable')
    expect(result.request.textures).toEqual({})
  })

  it('names a file whose import settings say it is not a texture', async () => {
    const reader = readerOver({
      'scenes/one.json': withSprite,
      [`${knightTexture}.meta`]: defaultMeta('audio', KNIGHT_META_ID),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([
      { kind: 'texture-not-a-texture', path: knightTexture, type: 'audio' },
    ])
  })

  it('reports a texture that is not the one the level was written against, and draws it anyway', async () => {
    const reader = readerOver({
      'scenes/one.json': withSprite,
      [`${knightTexture}.meta`]: textureMeta('a-different-file'),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([
      {
        kind: 'texture-different-file',
        path: knightTexture,
        expected: KNIGHT_META_ID,
        found: 'a-different-file',
      },
    ])
    expect(Object.keys(result.request.textures)).toEqual([knightTexture])
  })
})

describe('what it says out loud', () => {
  it('names the prefab before the texture, because the prefab is the cause', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(
        entity('e1', 'Knight', sprite(knightTexture, KNIGHT_META_ID)),
        entity('i1', 'Slime', { prefab: { source: { id: SLIME_PREFAB_ID, path: 'prefabs/slime.json' } } }),
      ),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems.map((problem) => problem.kind)).toEqual(['prefab-missing', 'texture-unannotated'])
  })

  it('gives every problem a sentence naming the file', () => {
    const problems = [
      { kind: 'prefab-missing', path: 'prefabs/slime.json' },
      { kind: 'prefab-unreadable', path: 'prefabs/slime.json', detail: 'it is empty' },
      { kind: 'prefab-different-file', path: 'prefabs/slime.json', expected: 'a', found: 'b' },
      { kind: 'texture-unannotated', path: knightTexture },
      { kind: 'texture-unreadable', path: knightTexture, detail: 'it is empty' },
      { kind: 'texture-not-a-texture', path: knightTexture, type: 'audio' },
      { kind: 'texture-different-file', path: knightTexture, expected: 'a', found: 'b' },
    ] as const

    for (const problem of problems) {
      const sentence = describeLoadProblem(problem)
      expect(sentence).toContain(problem.path.split('/').at(-1))
      expect(sentence.endsWith('.')).toBe(true)
    }
  })

  it('gives a parent problem a sentence naming the entity, since there is no file to name', () => {
    const missing = describeLoadProblem({ kind: 'parent-missing', entity: 'Fire', id: 'f1', parent: 'abc123' })
    expect(missing).toContain('Fire')
    expect(missing).toContain('abc123')
    expect(missing.endsWith('.')).toBe(true)

    const loop = describeLoadProblem({ kind: 'parent-cycle', entity: 'Arm', id: 'a1' })
    expect(loop).toContain('Arm')
    expect(loop.endsWith('.')).toBe(true)
  })
})

/**
 * An entity attached to another (editor-kernel D37). The loader carries the
 * field through, and a parent that cannot be followed is reported the way a
 * missing texture is — named, never a reason to refuse the level.
 */
describe('an entity attached to another', () => {
  it('carries the parent through to the request', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(entity('block', 'Block'), { ...entity('fire', 'Fire'), parent: 'block' }),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([])
    expect(result.request.scene.entities[1]?.parent).toBe('block')
  })

  it('opens a level whose parent is not in it, and names the entity', async () => {
    const reader = readerOver({
      'scenes/one.json': scene({ ...entity('fire', 'Fire'), parent: 'nobody' }),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems).toEqual([{ kind: 'parent-missing', entity: 'Fire', id: 'fire', parent: 'nobody' }])
    expect(result.request.scene.entities).toHaveLength(1)
  })

  it('opens a level whose parents loop, and names every entity in the loop', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(
        { ...entity('a', 'Arm'), parent: 'b' },
        { ...entity('b', 'Block'), parent: 'a' },
        { ...entity('c', 'Fire'), parent: 'a' },
      ),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems.map((problem) => problem.kind)).toEqual(['parent-cycle', 'parent-cycle', 'parent-cycle'])
  })

  it('names a missing prefab before a missing parent, and a missing texture between them', async () => {
    const reader = readerOver({
      'scenes/one.json': scene(
        { ...entity('e1', 'Knight', sprite(knightTexture, KNIGHT_META_ID)), parent: 'nobody' },
        entity('i1', 'Slime', { prefab: { source: { id: SLIME_PREFAB_ID, path: 'prefabs/slime.json' } } }),
      ),
    })

    const result = await loadScene(reader, 'scenes/one.json')
    if (!result.ok) throw new Error(result.problem)

    expect(result.problems.map((problem) => problem.kind)).toEqual([
      'prefab-missing',
      'texture-unannotated',
      'parent-missing',
    ])
  })
})
