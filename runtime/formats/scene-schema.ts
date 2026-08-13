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
 * runtime is what loads a scene (editor-kernel D20, text-formats T10).
 *
 * **The component registry lives here**, with the entity that carries a
 * component map — including `prefab`, which is a reference an entity holds. The
 * prefab *document* is `prefab-schema.ts` next door, and the arrow runs one way:
 * that file imports this one, and this one never imports it. Two formats, two
 * files, and nothing about a scene depending on a prefab existing.
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
 * other file, and it is said out loud rather than drawn silently.
 *
 * **A file moved from inside the editor keeps its id**, because its `.meta` moves
 * with it, so the fixup that follows a rename rewrites `path` and never touches
 * `id`. That is the whole shape of the repair, and it is why the pair was worth
 * carrying: an id that changed on every move would make a rename a re-write of
 * every reference's identity rather than of its address. Where the references
 * are is `COMPONENT_REFERENCE_FIELDS` below.
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

/** Draws a texture. */
export interface SpriteComponent {
  texture: AssetRef
}

/**
 * Makes this entity an instance of a prefab.
 *
 * **What it is comes from the prefab; where it stands is its own.** The
 * transform stays entirely with the entity — position, rotation and scale — so
 * one slime can be tilted without tilting the other forty-nine. Everything else
 * arrives from the file this points at, and changing that file changes every
 * instance of it at once.
 *
 * A reference like any other (D5): the path resolves it and the id witnesses
 * that the file at that path is still the one the level was written against.
 */
export interface PrefabComponent {
  source: AssetRef
}

/**
 * Turns this entity as time passes, at a rate the level sets.
 *
 * **The first component in this registry that is about behaviour rather than
 * appearance, and the only one the kernel ships.** It exists because the update
 * loop needed a real consumer before any game existed to provide one: machinery
 * with no consumer is machinery nobody has exercised, and a seam shaped against
 * an imagined consumer is the failure `genre-spinup` S1 is about. So one
 * behaviour, chosen to be the smallest thing that is unmistakably moving.
 *
 * It is scaffolding and is expected to leave. When a game folder's own code can
 * supply systems, this and `runtime/game/systems/spin.ts` come out together and
 * nothing else in the kernel changes — which is the check that the seam was
 * drawn in the right place.
 *
 * Degrees per second, counter-clockwise, matching `Transform.rotation` exactly:
 * a rate expressed in the same unit and the same direction as the thing it
 * changes is a rate nobody has to convert.
 */
export interface SpinComponent {
  degreesPerSecond: number
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

export const PrefabComponentSchema: z.ZodType<PrefabComponent> = z.looseObject({
  source: AssetRefSchema,
})

export const SpinComponentSchema: z.ZodType<SpinComponent> = z.looseObject({
  // Finite rather than merely a number: a rate of `Infinity` or `NaN` reaches
  // the transform on the first step and turns a sprite into something the
  // renderer cannot place, with nothing on screen saying which field did it.
  degreesPerSecond: z.number().finite(),
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
  prefab: PrefabComponentSchema,
  spin: SpinComponentSchema,
} as const

export type KnownComponentType = keyof typeof COMPONENT_SCHEMAS

export function isKnownComponentType(type: string): type is KnownComponentType {
  return Object.hasOwn(COMPONENT_SCHEMAS, type)
}

/**
 * Which field of each known component holds a reference to a file.
 *
 * **Where a reference lives is a fact about the format, so it is written down
 * beside the registry rather than inside the tool that follows one.** The editor
 * fixes up every reference when a file is renamed or moved, and it needs to know
 * where they are; deriving that by hand in the editor would be a second list that
 * silently stops matching this one the first time a component type is added. Here,
 * a genre layer whose component points at a file gets the fixup by adding a line
 * to this object — the same one line the registry above already costs it.
 *
 * A component with no reference in it simply has no entry, which is why this is
 * partial rather than a full record.
 */
export const COMPONENT_REFERENCE_FIELDS: Partial<Record<KnownComponentType, string>> = {
  sprite: 'texture',
  prefab: 'source',
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
  .superRefine(checkKnownComponents)

/**
 * The half of the entity check a prefab needs too: every component whose type
 * is in the registry has to be one this editor can read.
 *
 * Exported for `prefab-schema.ts` and for nothing else. Shared rather than
 * written twice, because the two would drift the first time a component type was
 * added — and the symptom would be a prefab accepting something a scene rejects,
 * which reads as the file being fine until it is placed.
 */
export function checkKnownComponents(holder: ComponentHolder, ctx: z.RefinementCtx): void {
  for (const [type, value] of Object.entries(holder.components)) {
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
}

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
 * Anything carrying a component map: an entity in a scene, or a prefab.
 *
 * The readers below take this rather than `Entity`, because what a component
 * *is* does not depend on which of the two is holding it — and a second set of
 * readers for prefabs would be a second place for the answer to drift.
 */
export interface ComponentHolder {
  components: Record<string, unknown>
}

/**
 * One component off an entity or a prefab, validated at the point of use, or
 * null.
 *
 * Validated here rather than at parse time because the parse deliberately does
 * not rewrite the value (see `EntitySchema`). A document that got through the
 * schema has already had its known components checked, so this returning null
 * means the component is simply absent.
 */
export function componentOf<K extends KnownComponentType>(
  holder: ComponentHolder,
  type: K,
): z.infer<(typeof COMPONENT_SCHEMAS)[K]> | null {
  const value = holder.components[type]
  if (value === undefined) return null
  // Looked up by a type parameter, so the registry access widens to the union of
  // every component schema there is. Narrowed back here, once, rather than at
  // every call site — which is where the type is genuinely known.
  const schema = COMPONENT_SCHEMAS[type] as z.ZodType<z.infer<(typeof COMPONENT_SCHEMAS)[K]>>
  const result = schema.safeParse(value)
  return result.success ? result.data : null
}

export function spriteOf(holder: ComponentHolder): SpriteComponent | null {
  return componentOf(holder, 'sprite')
}

/**
 * How fast this entity turns, or null if it does not.
 *
 * Read at the point of use like every other component, so a rate somebody typed
 * into a text editor as a string is *absent* rather than a crash inside a system
 * running sixty times a second — which is the one place a thrown error is
 * genuinely hard to trace back to the file that caused it.
 */
export function spinOf(holder: ComponentHolder): SpinComponent | null {
  return componentOf(holder, 'spin')
}

/** Which prefab this entity is an instance of, or null if it is not one. */
export function prefabRefOf(entity: Entity): AssetRef | null {
  return componentOf(entity, 'prefab')?.source ?? null
}

/**
 * Every file this entity or prefab points at, in registry order.
 *
 * Read straight off the raw component map through `COMPONENT_REFERENCE_FIELDS`
 * rather than through the typed readers above, so that adding a
 * reference-bearing component type means editing that map and nothing else.
 * Anything at a reference field that is not an `AssetRef` is skipped rather than
 * reported: this answers "what does this point at", and a component the schema
 * has already accepted cannot be malformed there.
 */
export function assetRefsOf(holder: ComponentHolder): AssetRef[] {
  const refs: AssetRef[] = []

  for (const [type, field] of Object.entries(COMPONENT_REFERENCE_FIELDS)) {
    if (field === undefined) continue

    const component = holder.components[type]
    if (component === null || typeof component !== 'object') continue

    const parsed = AssetRefSchema.safeParse((component as Record<string, unknown>)[field])
    if (parsed.success) refs.push(parsed.data)
  }

  return refs
}

/** The component types on this entity or prefab that the kernel has no schema for. */
export function unknownComponentTypesOf(holder: ComponentHolder): string[] {
  return Object.keys(holder.components)
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
 * A copy of an entity, under a new id and name.
 *
 * It belongs here rather than in the panel that offers the button, because what
 * has to survive a copy is a fact about the *format*: everything, including
 * component types this kernel has no schema for. A copy that quietly dropped one
 * would look exactly like working, and the loss would be found much later by
 * somebody with no reason to suspect the Duplicate button.
 *
 * Deep, and through JSON rather than `structuredClone`, for two reasons that
 * both matter. An entity is a JSON document by definition, so a round trip is
 * faithful by construction. And `structuredClone` throws on the immer draft the
 * editor is holding mid-transaction, which is exactly where a copy gets made —
 * a failure that does not appear until the button is pressed.
 */
export function copyEntity(entity: Entity, id: string, name: string): Entity {
  return { ...(JSON.parse(JSON.stringify(entity)) as Entity), id, name }
}

/**
 * How a scene is written to disk, everywhere. Two spaces and a trailing
 * newline, the same as a `.meta`, so the file reads well in a text editor and
 * diffs a line at a time.
 */
export function serializeScene(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`
}
