import { describe, expect, it } from 'vitest'

import {
  PrefabSchema,
  defaultPrefab,
  instanceOfPrefab,
  resolveEntities,
  resolveEntity,
  serializePrefab,
  type Prefab,
} from '../../runtime/formats/prefab-schema'
import {
  SceneSchema,
  defaultTransform,
  prefabRefOf,
  serializeScene,
  spriteOf,
  type Entity,
  type Scene,
} from '../../runtime/formats/scene-schema'

/**
 * The prefab format, and what a reference to one means.
 *
 * Two things are being held here and they are different promises. The schema
 * block is the ordinary round-trip tripwire every format gets (editor-kernel G1).
 * The resolution block is the whole of "editing the prefab updates every
 * instance", written as arithmetic — and its load-bearing tests are the two
 * negatives: the transform is never touched, and the entity handed in is never
 * modified. Those are what let a resolved copy be drawn from while the file
 * keeps only its reference.
 */

/** A scene entity that draws its own sprite, for the cases that need one. */
const knight: Entity = {
  id: '9c1f4a2b7e0d5638',
  name: 'Knight',
  transform: { x: 120, y: 24, rotation: 0, scaleX: 1, scaleY: 1 },
  components: {
    sprite: { texture: { id: 'a3f90011deadbeef', path: 'assets/textures/characters/knight-idle.png' } },
  },
}

const scene: Scene = { format: 'kernel2d.scene', version: 1, entities: [knight] }

// --- prefabs ---------------------------------------------------------------

const SLIME_PREFAB_PATH = 'prefabs/enemy-slime.json'

const slimePrefab: Prefab = {
  format: 'kernel2d.prefab',
  version: 1,
  id: 'aabbccddeeff0011',
  name: 'Slime',
  components: {
    sprite: { texture: { id: 'beef0011a3f9dead', path: 'assets/textures/characters/slime.png' } },
  },
}

/** An entity that is an instance: a reference and a transform, nothing else. */
const placedSlime: Entity = {
  id: '00ff00ff00ff00ff',
  name: 'Tilted slime',
  transform: { x: 176, y: 16, rotation: 20, scaleX: 1, scaleY: 1 },
  components: { prefab: { source: { id: slimePrefab.id, path: SLIME_PREFAB_PATH } } },
}

describe('a prefab survives a round trip', () => {
  const generated: Prefab = { ...slimePrefab, generatedBy: 'claude-opus-5', generatedAt: '2026-08-12' }

  it.each([
    ['one with a sprite in it', slimePrefab],
    ['an empty one', defaultPrefab('abc123', 'New prefab')],
    ['one an AI produced', generated],
  ])('reads back identical for %s', (_description, value) => {
    expect(PrefabSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value)
  })

  it('survives the trip through the text that is actually written to disk', () => {
    expect(PrefabSchema.parse(JSON.parse(serializePrefab(generated)))).toEqual(generated)
  })

  it('keeps a key a human put in by hand, and a component the kernel has never heard of', () => {
    const handEdited = {
      ...slimePrefab,
      myOwnNote: 'the boss version of this is a separate prefab',
      components: { ...slimePrefab.components, patrolRoute: { waypoints: [{ x: 10, y: 0 }], loop: true } },
    }

    expect(PrefabSchema.parse(JSON.parse(serializePrefab(handEdited as Prefab)))).toEqual(handEdited)
  })
})

describe('a prefab rejects what it should', () => {
  it('refuses a version it does not know', () => {
    expect(() => PrefabSchema.parse({ ...slimePrefab, version: 2 })).toThrow()
  })

  it('refuses one with no id, because a reference to it would have nothing to record', () => {
    expect(() => PrefabSchema.parse({ ...slimePrefab, id: '' })).toThrow()
  })

  it('refuses a sprite component it cannot read, the same as an entity does', () => {
    expect(() =>
      PrefabSchema.parse({ ...slimePrefab, components: { sprite: { texture: 'assets/a.png' } } }),
    ).toThrow()
  })

  /**
   * The rule that makes a cycle unwritable rather than merely unlikely. Without
   * it, two prefabs pointing at each other is a file the format accepts and a
   * resolver has to defend against for ever.
   */
  it('refuses a prefab that is an instance of another prefab', () => {
    expect(() =>
      PrefabSchema.parse({
        ...slimePrefab,
        components: { prefab: { source: { id: 'aabb', path: 'prefabs/other.json' } } },
      }),
    ).toThrow()
  })

  it('refuses a document that is not a prefab at all', () => {
    expect(() => PrefabSchema.parse(scene)).toThrow()
  })
})

describe('a scene holding instances', () => {
  const withInstance: Scene = { ...scene, entities: [knight, placedSlime] }

  it('accepts an entity that is an instance, and reads it back identical', () => {
    expect(SceneSchema.parse(JSON.parse(serializeScene(withInstance)))).toEqual(withInstance)
  })

  it('refuses a reference carrying a path but no id, which is half of D5', () => {
    expect(() =>
      SceneSchema.parse({
        ...scene,
        entities: [{ ...placedSlime, components: { prefab: { source: { path: SLIME_PREFAB_PATH } } } }],
      }),
    ).toThrow()
  })

  it('says which prefab an entity is an instance of, and null for one that is not', () => {
    expect(prefabRefOf(placedSlime)?.path).toBe(SLIME_PREFAB_PATH)
    expect(prefabRefOf(knight)).toBeNull()
  })

  it('makes one placed, ready to go in a scene', () => {
    const placed = instanceOfPrefab('ffff0000ffff0000', 'Slime', {
      id: slimePrefab.id,
      path: SLIME_PREFAB_PATH,
    })

    expect(prefabRefOf(placed)?.path).toBe(SLIME_PREFAB_PATH)
    expect(placed.transform).toEqual(defaultTransform())
    // Nothing else: what it draws comes from the prefab, and a copy written
    // here would stop following it the first time the prefab changed.
    expect(Object.keys(placed.components)).toEqual(['prefab'])
    expect(SceneSchema.safeParse({ ...scene, entities: [placed] }).success).toBe(true)
  })
})

/**
 * Resolution: the whole of what "editing the prefab updates every instance"
 * means, as arithmetic.
 *
 * The last two tests are the load-bearing ones. That the transform survives
 * untouched is the decision that the prefab says what a thing *is* and the level
 * says where it stands; that the entity handed in is never modified is what lets
 * a resolved copy be drawn from while the file keeps only its reference.
 */
describe('resolving an instance against its prefab', () => {
  it('draws what the prefab says', () => {
    expect(spriteOf(resolveEntity(placedSlime, slimePrefab))?.texture.path).toBe(
      'assets/textures/characters/slime.png',
    )
  })

  it('leaves the instance drawing nothing when the prefab is not there', () => {
    expect(spriteOf(resolveEntity(placedSlime, null))).toBeNull()
    expect(resolveEntity(placedSlime, null)).toBe(placedSlime)
  })

  it('keeps the instance an instance, so a panel can still say where it came from', () => {
    expect(prefabRefOf(resolveEntity(placedSlime, slimePrefab))?.path).toBe(SLIME_PREFAB_PATH)
  })

  it('brings a component the kernel has no schema for', () => {
    const withExtra: Prefab = {
      ...slimePrefab,
      components: { ...slimePrefab.components, patrol: { from: 10, to: 90 } },
    }

    expect(resolveEntity(placedSlime, withExtra).components['patrol']).toEqual({ from: 10, to: 90 })
  })

  it('lets what the entity carries itself win, per component type', () => {
    const overriding: Entity = {
      ...placedSlime,
      components: {
        ...placedSlime.components,
        sprite: { texture: { id: 'a3f90011deadbeef', path: 'assets/textures/characters/knight-idle.png' } },
      },
    }

    expect(spriteOf(resolveEntity(overriding, slimePrefab))?.texture.path).toBe(
      'assets/textures/characters/knight-idle.png',
    )
  })

  it('never touches the transform, so one instance can be tilted and the rest not', () => {
    expect(resolveEntity(placedSlime, slimePrefab).transform).toEqual(placedSlime.transform)
  })

  it('leaves the entity it was given exactly as it was', () => {
    resolveEntity(placedSlime, slimePrefab)

    expect(Object.keys(placedSlime.components)).toEqual(['prefab'])
    expect(spriteOf(placedSlime)).toBeNull()
  })

  it('resolves a whole scene by path, and leaves ordinary entities alone', () => {
    const resolved = resolveEntities([knight, placedSlime], { [SLIME_PREFAB_PATH]: slimePrefab })

    expect(resolved[0]).toBe(knight)
    expect(spriteOf(resolved[1] as Entity)?.texture.path).toBe('assets/textures/characters/slime.png')
  })

  it('leaves an instance whose prefab is not in the set exactly as the file has it', () => {
    const resolved = resolveEntities([placedSlime], {})

    expect(resolved[0]).toBe(placedSlime)
  })
})

describe('what a fresh prefab looks like', () => {
  it('is named, has an id, and draws nothing yet', () => {
    const fresh = defaultPrefab('abc123', 'Enemy bat')

    expect(fresh.id).toBe('abc123')
    expect(fresh.name).toBe('Enemy bat')
    expect(fresh.components).toEqual({})
    expect(() => PrefabSchema.parse(fresh)).not.toThrow()
  })
})
