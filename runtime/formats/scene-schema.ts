import { z } from 'zod'

/**
 * The scene format: a level, as text.
 *
 * A scene is a flat, ordered list of entities. Each carries a transform, a name,
 * and a map of components keyed by type. That is the whole of it — the shape is
 * deliberately small, because everything a genre layer will want to add goes in
 * the component map rather than into this file.
 *
 * It lives in `runtime/` because the runtime is the layer that ships and the
 * runtime is what loads a scene (editor-kernel D20, text-formats T10). Like the
 * `.meta` schema beside it, it is compiled by two TypeScript projects with
 * different resolution rules, so **it imports nothing but `zod` and must never
 * gain a relative import** (editor-ui U4). That is why the component registry
 * sits in this file rather than in one of its own.
 *
 * Three decisions worth knowing before changing anything here:
 *
 *   1. **The list is flat and its order is the draw order.** Position in
 *      `entities` decides what is drawn in front; there is no second field
 *      saying so. A separate field would mean two answers to one question that
 *      have to be kept in agreement forever, which is the failure `editor-ui`
 *      U5 and U9 are both about. When an override is genuinely wanted it
 *      arrives as a `z` *within* the sprite component, sorted inside list order,
 *      and nothing existing has to start writing it.
 *
 *      Nesting is not here either. Flat is the shape parenting can be added to
 *      later — a `parent` field defaulting to null, no migration — where nested
 *      is not a shape parenting can be taken out of. The field lands with the
 *      feature that can set it, not before.
 *
 *   2. **The transform is a field, not a component.** Every entity in a 2D
 *      scene has a position; making it removable would mean every tool forever
 *      handling its absence in exchange for nothing.
 *
 *   3. **There is no pivot anywhere in this file, on purpose.** Where a sprite
 *      sits relative to its position is decided by the pivot in the texture's
 *      `.meta`, which the runtime already reads. A scene carrying its own pivot
 *      would be a second opinion about the same thing.
 */

export const SCENE_FORMAT = 'kernel2d.scene'
export const SCENE_VERSION = 1

/**
 * A reference to a file in the project, carrying a stable id *and* a readable
 * path (editor-kernel D5).
 *
 * The two are irreconcilable in one field: an id survives a rename but makes the
 * document unreadable, a path stays greppable but breaks the moment a file
 * moves. Carrying both costs a few bytes and removes the tradeoff.
 *
 * How they are used is worth stating, because it is the part a reader cannot
 * guess: **the path is what resolves the reference, and the id is the witness.**
 * The editor looks the file up by path, then compares the id it finds against
 * the one recorded here — a mismatch means the reference now points at some
 * other file, and it is said out loud rather than drawn silently. Reconciling
 * the pair after a move is a fixup tool's job and does not exist yet.
 */
export interface AssetRef {
  id: string
  path: string
}

/**
 * Where an entity is, in scene coordinates.
 *
 * **Scene space is y-up.** The origin is the bottom-left of the view and y
 * increases upward, which is what makes a sprite pivoted at its feet stand *on*
 * its y position rather than needing a sign flipped somewhere. The renderer
 * converts to its own y-down screen space in one place
 * (`runtime/scene/coordinates.ts`) and nothing else does the arithmetic.
 *
 * `rotation` is **degrees, counter-clockwise**, to match that axis. Degrees
 * because a human types this number; counter-clockwise because that is what
 * positive means in a y-up world. The renderer negates it converting to Phaser
 * radians, since Phaser's screen space is y-down.
 */
export interface Transform {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

/** Draws a texture. The only component the kernel itself knows about. */
export interface SpriteComponent {
  texture: AssetRef
}

export interface Entity {
  /** Unique within the scene; generated once and never changed. */
  id: string
  /** What the human calls it. Not unique, not an identifier. */
  name: string
  transform: Transform
  /**
   * Components keyed by type. Values are `unknown` here because the schema is
   * open: a type in the registry below is validated against its own schema, and
   * a type that is not is carried through untouched. Read a known one with
   * `spriteOf` (or `componentOf`), which validates at the point of use.
   */
  components: Record<string, unknown>
}

export interface Scene {
  format: typeof SCENE_FORMAT
  version: typeof SCENE_VERSION
  /** In draw order: the first is furthest back. */
  entities: Entity[]
  /** Present only on scenes an AI produced. Read, preserved, never invented. */
  generatedBy?: string | undefined
  /** `YYYY-MM-DD`, alongside `generatedBy`. */
  generatedAt?: string | undefined
}

// --- the schema -----------------------------------------------------------

/**
 * Every object here is loose, at every level, for the same reason the `.meta`
 * schema is: the editor rewrites this file from the object it parsed, so a key
 * the parse drops is a key deleted out of a file a human wrote. Nothing is ever
 * merged back at write time, because nothing ever left. See text-formats T9,
 * and the test that fails the day somebody makes this strict for tidiness.
 */
export const AssetRefSchema: z.ZodType<AssetRef> = z.looseObject({
  // A non-empty string rather than a pattern, on the same grounds as an asset
  // id: every writer goes through a minting function anyway, and a pattern only
  // turns an id somebody typed by hand into a parse failure (text-formats T6).
  id: z.string().min(1),
  path: z.string().min(1),
})

export const TransformSchema: z.ZodType<Transform> = z.looseObject({
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite(),
  scaleX: z.number().finite(),
  scaleY: z.number().finite(),
})

export const SpriteComponentSchema: z.ZodType<SpriteComponent> = z.looseObject({
  texture: AssetRefSchema,
})

/**
 * The component types this kernel understands, and the schema for each.
 *
 * This registry is what stands in for D6 now that the component map is open.
 * The document schema is no longer the whole truth about a scene — a genre
 * layer's component can appear in a file this kernel has never heard of — so
 * the honest statement of "what does the editor understand?" has to live
 * somewhere, and this is it. One place, typechecked, and the same list the
 * validator reads.
 *
 * The bargain, stated plainly so a later session can judge whether it still
 * holds: a **known** type whose contents are wrong fails the parse, loudly, at
 * the boundary. An **unknown** type is kept byte-for-byte and reported to the
 * Inspector as something this editor does not know. Registering a type is what
 * buys validation and an inspector for it; not registering one costs nothing
 * but those.
 */
export const COMPONENT_SCHEMAS = {
  sprite: SpriteComponentSchema,
} as const

export type KnownComponentType = keyof typeof COMPONENT_SCHEMAS

export function isKnownComponentType(type: string): type is KnownComponentType {
  return Object.hasOwn(COMPONENT_SCHEMAS, type)
}

export const EntitySchema: z.ZodType<Entity> = z
  .looseObject({
    id: z.string().min(1),
    name: z.string(),
    transform: TransformSchema,
    components: z.record(z.string(), z.unknown()),
  })
  // Known components are *checked*, never replaced. Replacing them would run
  // each value back through its own schema and hand back the result, which is
  // exactly the key-stripping the loose objects above exist to prevent.
  .superRefine((entity, ctx) => {
    for (const [type, value] of Object.entries(entity.components)) {
      if (!isKnownComponentType(type)) continue
      const result = COMPONENT_SCHEMAS[type].safeParse(value)
      if (result.success) continue

      const issue = result.error.issues[0]
      ctx.addIssue({
        code: 'custom',
        message: `this ${type} component is not one this editor can read${issue === undefined ? '' : `: ${issue.message}`}`,
        path: ['components', type, ...(issue?.path ?? [])],
        input: value,
      })
    }
  })

export const SceneSchema: z.ZodType<Scene> = z
  .looseObject({
    format: z.literal(SCENE_FORMAT),
    version: z.literal(SCENE_VERSION),
    entities: z.array(EntitySchema),
    generatedBy: z.string().min(1).optional(),
    generatedAt: z.string().min(1).optional(),
  })
  // Two entities with one id is not a scene with a cosmetic flaw in it: it is a
  // scene where selecting one selects both and the renderer keeps whichever it
  // saw last. Caught at the boundary, where it can still be pointed at.
  .superRefine((scene, ctx) => {
    const seen = new Set<string>()
    scene.entities.forEach((entity, index) => {
      if (!seen.has(entity.id)) {
        seen.add(entity.id)
        return
      }
      ctx.addIssue({
        code: 'custom',
        message: `two entities share the id ${entity.id}`,
        path: ['entities', index, 'id'],
        input: entity.id,
      })
    })
  })

// --- reading a component --------------------------------------------------

/**
 * One component off an entity, validated at the point of use, or null.
 *
 * Validated here rather than at parse time because the parse deliberately does
 * not rewrite the value (see `EntitySchema`). A scene that got through the
 * schema has already had its known components checked, so this returning null
 * means the component is simply absent.
 */
export function componentOf<K extends KnownComponentType>(
  entity: Entity,
  type: K,
): z.infer<(typeof COMPONENT_SCHEMAS)[K]> | null {
  const value = entity.components[type]
  if (value === undefined) return null
  const result = COMPONENT_SCHEMAS[type].safeParse(value)
  return result.success ? result.data : null
}

export function spriteOf(entity: Entity): SpriteComponent | null {
  return componentOf(entity, 'sprite')
}

/** The component types on this entity that the kernel has no schema for. */
export function unknownComponentTypesOf(entity: Entity): string[] {
  return Object.keys(entity.components)
    .filter((type) => !isKnownComponentType(type))
    .sort()
}

// --- what a fresh one looks like ------------------------------------------

/**
 * The defaults every writer of this format builds from, so "what a new scene
 * looks like" is defined once rather than twice (text-formats T5). Ids are
 * passed in because minting differs by writer: the editor wants a random one,
 * the sample generator wants one derived from the path so re-running produces
 * identical bytes. Ids are opaque, so both are fine.
 */
export function defaultTransform(): Transform {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
}

export function defaultEntity(id: string, name: string): Entity {
  return { id, name, transform: defaultTransform(), components: {} }
}

export function defaultScene(): Scene {
  return { format: SCENE_FORMAT, version: SCENE_VERSION, entities: [] }
}

/**
 * How a scene is written to disk, everywhere. Two spaces and a trailing
 * newline, the same as a `.meta`, so the file reads well in a text editor and
 * diffs a line at a time.
 */
export function serializeScene(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`
}
