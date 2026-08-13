import { describe, expect, it } from 'vitest'

import {
  COMPONENT_REFERENCE_FIELDS,
  SceneSchema,
  assetRefsOf,
  componentOf,
  copyEntity,
  defaultEntity,
  defaultScene,
  defaultTransform,
  isKnownComponentType,
  serializeScene,
  spriteOf,
  unknownComponentTypesOf,
  type Entity,
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

/**
 * Where a reference lives is a fact about the format, and this is the assertion
 * that keeps `COMPONENT_REFERENCE_FIELDS` honest with the registry beside it.
 *
 * The fixup that follows a rename reads its list of places-to-look from that
 * map. A component type added to the registry and forgotten here is a component
 * whose reference silently stops being repaired when a file moves — which looks
 * exactly like working until somebody renames the wrong texture.
 */
describe('every file a document points at', () => {
  it('finds the texture an entity draws', () => {
    expect(assetRefsOf(knight)).toEqual([
      { id: 'a3f90011deadbeef', path: 'assets/textures/characters/knight-idle.png' },
    ])
  })

  it('finds the prefab an instance is placed from', () => {
    const instance: Entity = {
      ...defaultEntity('aa11bb22cc33dd44', 'Slime'),
      components: { prefab: { source: { id: 'slime-doc-id', path: 'prefabs/slime.json' } } },
    }

    expect(assetRefsOf(instance)).toEqual([{ id: 'slime-doc-id', path: 'prefabs/slime.json' }])
  })

  it('reads a prefab the same way it reads an entity, because both hold components', () => {
    expect(assetRefsOf({ components: knight.components })).toEqual(assetRefsOf(knight))
  })

  it('finds nothing on an entity that draws nothing', () => {
    expect(assetRefsOf(defaultEntity('abc123', 'Empty'))).toEqual([])
  })

  it('says nothing about a component type this kernel has never heard of', () => {
    // The honest answer: the kernel cannot know that somebody else's component
    // holds a path. It is reported as unknown elsewhere and left alone here.
    const patrolling: Entity = {
      ...defaultEntity('abc123', 'Guard'),
      components: { patrol: { route: { id: 'route-id', path: 'data/routes/wall.json' } } },
    }

    expect(assetRefsOf(patrolling)).toEqual([])
  })

  it('names every component the fixup knows how to follow', () => {
    // Fails the day a reference-bearing component is added to the registry
    // without being added here, which is the drift this map exists to prevent.
    for (const type of Object.keys(COMPONENT_REFERENCE_FIELDS)) {
      expect(isKnownComponentType(type)).toBe(true)
    }
    expect(Object.keys(COMPONENT_REFERENCE_FIELDS).sort()).toEqual(['prefab', 'sprite'])
  })
})
