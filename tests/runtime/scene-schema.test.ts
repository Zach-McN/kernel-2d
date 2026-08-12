import { describe, expect, it } from 'vitest'

import {
  PrefabSchema,
  SceneSchema,
  componentOf,
  copyEntity,
  defaultEntity,
  defaultPrefab,
  defaultScene,
  defaultTransform,
  instanceOfPrefab,
  isKnownComponentType,
  prefabRefOf,
  resolveEntities,
  resolveEntity,
  serializePrefab,
  serializeScene,
  spriteOf,
  unknownComponentTypesOf,
  type Entity,
  type Prefab,
  type Scene,
} from '../../runtime/formats/scene-schema'

/**
 * The round-trip tripwire (editor-kernel G1, editor-verification V7) for the
 * scene format, in place before the second writer of it exists.
 *
 * The scene has two writers almost immediately — the editor and the sample
 * generator — and it is the first format the editor *rewrites wholesale* from
 * the object it parsed. That makes the second block below the load-bearing one:
 * anything the parse drops is deleted out of a file a human wrote, and the
 * ordinary round-trip test cannot see it happen (text-formats F1).
 */

const knight: Entity = {
  id: '9c1f4a2b7e0d5638',
  name: 'Knight',
  transform: { x: 120, y: 24, rotation: 0, scaleX: 1, scaleY: 1 },
  components: {
    sprite: { texture: { id: 'a3f90011deadbeef', path: 'assets/textures/characters/knight-idle.png' } },
  },
}

const slime: Entity = {
  id: '55aa66bb77cc88dd',
  name: 'Slime',
  transform: { x: 220, y: 24, rotation: -15, scaleX: 2, scaleY: 2 },
  components: {
    sprite: { texture: { id: 'beef0011a3f9dead', path: 'assets/textures/characters/slime.png' } },
  },
}

const scene: Scene = {
  format: 'kernel2d.scene',
  version: 1,
  entities: [knight, slime],
}

const generated: Scene = { ...scene, generatedBy: 'claude-opus-5', generatedAt: '2026-08-11' }

describe('a scene survives a round trip', () => {
  it.each([
    ['a scene with entities in it', scene],
    ['an empty scene', defaultScene()],
    ['one an AI produced', generated],
    ['an entity with no components at all', { ...scene, entities: [defaultEntity('abc123', 'Empty')] }],
  ])('reads back identical for %s', (_description, value) => {
    expect(SceneSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value)
  })

  it('survives the trip through the text that is actually written to disk', () => {
    expect(SceneSchema.parse(JSON.parse(serializeScene(generated)))).toEqual(generated)
  })

  it('keeps the generated marking, because dropping it destroys provenance', () => {
    const roundTripped = SceneSchema.parse(JSON.parse(serializeScene(generated)))

    expect(roundTripped.generatedBy).toBe('claude-opus-5')
    expect(roundTripped.generatedAt).toBe('2026-08-11')
  })

  it('is written as readable, line-at-a-time text', () => {
    const written = serializeScene(generated)

    expect(written.split('\n').length).toBeGreaterThan(5)
    expect(written.endsWith('\n')).toBe(true)
  })
})

describe('a scene keeps what a human put in it by hand', () => {
  /**
   * The editor rewrites a scene from the object it parsed, so a key the parse
   * drops is a key deleted out of somebody's file. Every comparison here is
   * against the original object, extra keys and all — the comparison that fails
   * the day somebody makes this schema strict for tidiness.
   */
  const handEdited = {
    ...scene,
    myOwnNote: 'the boss fight starts once the slime is dead',
    entities: [
      {
        ...knight,
        designerNote: 'faces right on purpose',
        transform: { ...knight.transform, snapToGrid: true },
        components: {
          sprite: {
            texture: { ...(knight.components['sprite'] as { texture: object }).texture, note: 'placeholder art' },
            tint: '#ffddaa',
          },
          patrolRoute: { waypoints: [{ x: 10, y: 0 }], loop: true },
        },
      },
    ],
  }

  it('keeps a key at the top level', () => {
    expect(SceneSchema.parse(JSON.parse(JSON.stringify(handEdited)))).toEqual(handEdited)
  })

  it('keeps ones nested inside an entity, its transform and its components', () => {
    expect(SceneSchema.parse(JSON.parse(serializeScene(handEdited as Scene)))).toEqual(handEdited)
  })

  it('keeps a component type the kernel has never heard of, untouched', () => {
    const parsed = SceneSchema.parse(JSON.parse(serializeScene(handEdited as Scene)))
    const entity = parsed.entities[0]

    expect(entity?.components['patrolRoute']).toEqual({ waypoints: [{ x: 10, y: 0 }], loop: true })
    expect(unknownComponentTypesOf(entity as Entity)).toEqual(['patrolRoute'])
  })

  it('survives being written, read, and written again unchanged', () => {
    const once = serializeScene(SceneSchema.parse(JSON.parse(serializeScene(handEdited as Scene))))
    const twice = serializeScene(SceneSchema.parse(JSON.parse(once)))

    // The same property that stops serialization drift is what stops the
    // editor's write/watch/re-read cycle feeding itself: the round trip is
    // identity, so writing back what came back changes nothing.
    expect(twice).toBe(once)
  })
})

describe('a scene rejects what it should', () => {
  it('refuses a version it does not know, rather than reading it on a hope', () => {
    expect(() => SceneSchema.parse({ ...scene, version: 2 })).toThrow()
  })

  it('refuses a document that is not a scene at all', () => {
    expect(() => SceneSchema.parse({ format: 'kernel2d.asset-meta', version: 1 })).toThrow()
  })

  it('refuses an entity with no id', () => {
    expect(() => SceneSchema.parse({ ...scene, entities: [{ ...knight, id: '' }] })).toThrow()
  })

  it('refuses two entities sharing an id, because selecting one would select both', () => {
    expect(() => SceneSchema.parse({ ...scene, entities: [knight, { ...slime, id: knight.id }] })).toThrow()
  })

  it('refuses a transform that is missing a number', () => {
    expect(() =>
      SceneSchema.parse({ ...scene, entities: [{ ...knight, transform: { x: 1, y: 2 } }] }),
    ).toThrow()
  })

  it('refuses a sprite component the editor cannot read, because it does know that one', () => {
    expect(() =>
      SceneSchema.parse({
        ...scene,
        entities: [{ ...knight, components: { sprite: { texture: 'assets/textures/knight.png' } } }],
      }),
    ).toThrow()
  })

  it('refuses a texture reference carrying a path but no id, which is half of D5', () => {
    expect(() =>
      SceneSchema.parse({
        ...scene,
        entities: [{ ...knight, components: { sprite: { texture: { path: 'assets/a.png' } } } }],
      }),
    ).toThrow()
  })
})

describe('reading a component', () => {
  it('hands back a sprite the kernel knows', () => {
    expect(spriteOf(knight)?.texture.path).toBe('assets/textures/characters/knight-idle.png')
  })

  it('hands back null for an entity that has none', () => {
    expect(spriteOf(defaultEntity('abc123', 'Empty'))).toBeNull()
    expect(componentOf(defaultEntity('abc123', 'Empty'), 'sprite')).toBeNull()
  })

  it('knows which types it has a schema for', () => {
    expect(isKnownComponentType('sprite')).toBe(true)
    expect(isKnownComponentType('patrolRoute')).toBe(false)
  })
})

/**
 * Copying an entity, held to the promise that makes it safe to offer as a
 * button: everything comes with it.
 *
 * The failure this guards against is the quietest kind. A copy that dropped a
 * component the kernel has no schema for would look exactly like working, and
 * the loss would be found weeks later by somebody with no reason to suspect the
 * Duplicate button — the same shape as the parse-drops-a-key failure the block
 * above exists for, arriving through a different door.
 */
describe('copying an entity', () => {
  it('takes the new id and name it is given', () => {
    const copy = copyEntity(knight, 'ffff0000ffff0000', 'Knight 2')

    expect(copy.id).toBe('ffff0000ffff0000')
    expect(copy.name).toBe('Knight 2')
  })

  it('brings everything else exactly as it was', () => {
    const copy = copyEntity(slime, 'ffff0000ffff0000', 'Slime 2')

    expect(copy.transform).toEqual(slime.transform)
    expect(copy.components).toEqual(slime.components)
  })

  it('brings components this kernel has no schema for', () => {
    const withExtras: Entity = {
      ...knight,
      components: { ...knight.components, patrol: { from: 10, to: 90, waypoints: [{ x: 1, y: 2 }] } },
      designerNote: 'faces right on purpose',
    } as Entity

    const copy = copyEntity(withExtras, 'ffff0000ffff0000', 'Knight 2')

    expect(copy.components['patrol']).toEqual({ from: 10, to: 90, waypoints: [{ x: 1, y: 2 }] })
    expect((copy as unknown as Record<string, unknown>)['designerNote']).toBe('faces right on purpose')
  })

  it('shares nothing with the original, so moving one does not move the other', () => {
    const copy = copyEntity(slime, 'ffff0000ffff0000', 'Slime 2')
    copy.transform.x = 999

    expect(slime.transform.x).toBe(220)
  })

  it('makes a scene the format still accepts, with both entities in it', () => {
    const copy = copyEntity(slime, 'ffff0000ffff0000', 'Slime 2')
    const parsed = SceneSchema.safeParse({ ...scene, entities: [...scene.entities, copy] })

    expect(parsed.success).toBe(true)
  })

  it('is rejected if it keeps the original’s id, which is why one is minted', () => {
    // Two entities with one id is not a scene with a cosmetic flaw in it, and
    // this is the assertion that says so about a copy in particular.
    const same = copyEntity(slime, slime.id, 'Slime 2')
    const parsed = SceneSchema.safeParse({ ...scene, entities: [...scene.entities, same] })

    expect(parsed.success).toBe(false)
  })
})

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

describe('what a fresh scene looks like', () => {
  it('is an empty scene the schema accepts', () => {
    expect(defaultScene().entities).toEqual([])
    expect(() => SceneSchema.parse(defaultScene())).not.toThrow()
  })

  it('starts an entity at the origin, unrotated and unscaled', () => {
    expect(defaultTransform()).toEqual({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it('produces an entity the schema accepts', () => {
    expect(() =>
      SceneSchema.parse({ ...defaultScene(), entities: [defaultEntity('abc123', 'New entity')] }),
    ).not.toThrow()
  })
})
