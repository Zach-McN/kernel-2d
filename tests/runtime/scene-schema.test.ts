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
  screenOf,
  serializeScene,
  spinOf,
  spriteOf,
  sceneRefsOf,
  textureRefsOf,
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

const heart: Entity = {
  id: '0011223344556677',
  name: 'Health icon',
  transform: { x: 28, y: 180, rotation: 0, scaleX: 1, scaleY: 1 },
  components: {
    sprite: { texture: { id: 'cafe0011babe2233', path: 'assets/textures/ui/icon-heart.png' } },
    spin: { degreesPerSecond: 90 },
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
    ['an entity that turns while the level runs', { ...scene, entities: [heart] }],
    [
      'an entity pinned to the screen',
      {
        ...scene,
        entities: [{ ...defaultEntity('abc123', 'Counter'), components: { screen: { anchor: { x: 1, y: 1 } } } }],
      },
    ],
    [
      'a level with music',
      { ...scene, music: { id: 'theme00deadbeef0', path: 'assets/audio/music/theme.mp3' } },
    ],
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

  it('keeps an opacity through a round trip, and lets a level not mention one', () => {
    const faint = {
      ...knight,
      components: { sprite: { ...(knight.components['sprite'] as object), opacity: 0.25 } },
    }
    const parsed = SceneSchema.parse(JSON.parse(serializeScene({ ...scene, entities: [faint, heart] })))
    expect(spriteOf(parsed.entities[0] as Entity)?.opacity).toBe(0.25)
    // The heart never said anything about being faint, and still does not: the
    // field is optional rather than defaulted, so a level written before it
    // existed is byte-for-byte the level it was.
    expect(spriteOf(parsed.entities[1] as Entity)?.opacity).toBeUndefined()
    expect(JSON.stringify(parsed.entities[1])).not.toContain('opacity')
  })

  it.each([Infinity, -Infinity, NaN])('refuses an opacity of %p', (value) => {
    // A range check is deliberately *not* here — 2 and −1 are clamped by the
    // renderer, because losing a whole sprite is a bad answer to a typo. NaN is
    // different: it makes the sprite vanish with nothing naming the field.
    expect(() =>
      SceneSchema.parse({
        ...scene,
        entities: [{ ...knight, components: { sprite: { texture: { id: 'a1', path: 'a.png' }, opacity: value } } }],
      }),
    ).toThrow()
  })

  it('takes an opacity outside the range, and leaves the clamping to the renderer', () => {
    expect(() =>
      SceneSchema.parse({
        ...scene,
        entities: [{ ...knight, components: { sprite: { texture: { id: 'a1', path: 'a.png' }, opacity: 2 } } }],
      }),
    ).not.toThrow()
  })

  it('refuses a turn rate that is not a number, because a system would run it sixty times a second', () => {
    expect(() =>
      SceneSchema.parse({ ...scene, entities: [{ ...heart, components: { spin: { degreesPerSecond: '90' } } }] }),
    ).toThrow()
  })

  it.each([Infinity, -Infinity, NaN])('refuses a turn rate of %p', (rate) => {
    // Not pedantry: any of these reaches the transform on the first step and
    // leaves a sprite the renderer cannot place, with nothing on screen naming
    // the field that did it.
    expect(() =>
      SceneSchema.parse({
        ...scene,
        entities: [{ ...heart, components: { spin: { degreesPerSecond: rate } } }],
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
    expect(isKnownComponentType('spin')).toBe(true)
    expect(isKnownComponentType('patrolRoute')).toBe(false)
  })

  it('hands back a turn rate, and null for an entity that does not turn', () => {
    expect(spinOf(heart)?.degreesPerSecond).toBe(90)
    expect(spinOf(knight)).toBeNull()
  })

  it('hands back where an entity is pinned, and null for one standing in the world', () => {
    const counter = { ...defaultEntity('abc123', 'Counter'), components: { screen: { anchor: { x: 1, y: 1 } } } }
    expect(screenOf(counter)?.anchor).toEqual({ x: 1, y: 1 })
    expect(screenOf(knight)).toBeNull()
    expect(isKnownComponentType('screen')).toBe(true)
  })

  it('treats a mangled pin as absent rather than throwing', () => {
    const mangled = { ...defaultEntity('abc123', 'Counter'), components: { screen: { anchor: 'top-right' } } }
    expect(screenOf(mangled)).toBeNull()
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

describe('every texture a document names', () => {
  it('finds the sprite texture, exactly as the sprite reader does', () => {
    expect(textureRefsOf(knight)).toEqual([
      { id: 'a3f90011deadbeef', path: 'assets/textures/characters/knight-idle.png' },
    ])
  })

  it('finds a texture named inside a component the kernel has no schema for', () => {
    // The case this walk exists for: a game's own component declaring the art
    // for something its systems will spawn mid-run. The kernel knows nothing
    // about towers; it knows what the word `texture` means.
    const tower: Entity = {
      ...defaultEntity('abc123', 'Archer post'),
      components: {
        tower: {
          damage: 1,
          projectile: { texture: { id: 'arrow-meta-id', path: 'assets/textures/projectiles/arrow.png' }, unitsPerSecond: 160 },
        },
      },
    }

    expect(textureRefsOf(tower)).toEqual([
      { id: 'arrow-meta-id', path: 'assets/textures/projectiles/arrow.png' },
    ])
  })

  it('finds a texture inside an array, because authored lists are ordinary data', () => {
    const spawner: Entity = {
      ...defaultEntity('abc123', 'Spawner'),
      components: {
        waves: {
          list: [
            { texture: { id: 'runner-id', path: 'assets/textures/monsters/runner.png' }, count: 5 },
            { texture: { id: 'brute-id', path: 'assets/textures/monsters/brute.png' }, count: 2 },
          ],
        },
      },
    }

    expect(textureRefsOf(spawner).map((ref) => ref.id)).toEqual(['runner-id', 'brute-id'])
  })

  it('skips a texture field that does not hold a reference', () => {
    const broken: Entity = {
      ...defaultEntity('abc123', 'Broken'),
      components: {
        tower: { projectile: { texture: 'arrow.png' } },
        other: { texture: { path: 'no-id.png' } },
      },
    }

    expect(textureRefsOf(broken)).toEqual([])
  })

  it('finds nothing on an entity that names none', () => {
    expect(textureRefsOf(defaultEntity('abc123', 'Empty'))).toEqual([])
  })

  it('reads a prefab the same way it reads an entity, because both hold components', () => {
    expect(textureRefsOf({ components: knight.components })).toEqual(textureRefsOf(knight))
  })
})

describe('every scene an entity names', () => {
  it('finds a scene named at any depth, in any component', () => {
    const banner: Entity = {
      ...defaultEntity('abc123', 'Banner'),
      components: {
        portal: { scene: 'scenes/level-01.json', done: { texture: { id: 'x', path: 'check.png' } } },
        home: { scene: 'scenes/select.json' },
        nested: { deep: [{ scene: 'scenes/level-02.json' }] },
      },
    }

    expect(sceneRefsOf(banner)).toEqual([
      'scenes/level-01.json',
      'scenes/select.json',
      'scenes/level-02.json',
    ])
  })

  it('skips a scene field that is not a path', () => {
    const broken: Entity = {
      ...defaultEntity('abc123', 'Broken'),
      components: { portal: { scene: 7 }, other: { scene: '' }, next: { scene: null } },
    }

    expect(sceneRefsOf(broken)).toEqual([])
  })

  it('finds nothing on an entity that names none', () => {
    expect(sceneRefsOf(defaultEntity('abc123', 'Empty'))).toEqual([])
  })
})

/**
 * The value shapes a *described* component's fields write (`component-schema.ts`),
 * carried by a level the runtime reads: a text, a tick, a choice, a file as the
 * `{ id, path }` pair, a level as its path, and `null` for a file or a level not
 * chosen yet. The level format never learns what a door is; this asserts it does
 * not have to — every shape survives the round trip byte-for-byte, and the two
 * walks the runtime and the export rely on see the described `texture` and
 * `scene` the same as any other.
 */
describe('a level carrying every kind of described value', () => {
  const door: Entity = {
    ...defaultEntity('d00r0001', 'Door'),
    components: {
      door: {
        scene: 'scenes/level-02.json',
        locked: false,
        sign: 'Exit',
        side: 'right',
        texture: { id: 'door-id', path: 'assets/textures/door.png' },
        sound: null,
        delay: 0.5,
      },
      hatch: { scene: null, texture: null },
    },
  }

  it('is carried through a round trip exactly, nulls included', () => {
    const scene: Scene = { ...defaultScene(), entities: [door] }
    expect(SceneSchema.parse(JSON.parse(serializeScene(scene)))).toEqual(scene)
  })

  it('is seen by the texture and scene walks, and a null is simply not there', () => {
    expect(textureRefsOf(door)).toEqual([{ id: 'door-id', path: 'assets/textures/door.png' }])
    expect(sceneRefsOf(door)).toEqual(['scenes/level-02.json'])
  })

  it('is not one of the kernel’s own components, and is not reported broken', () => {
    expect(unknownComponentTypesOf(door)).toEqual(['door', 'hatch'])
  })
})
