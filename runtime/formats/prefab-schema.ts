import { z } from 'zod'

import {
  checkKnownComponents,
  componentOf,
  defaultTransform,
  prefabRefOf,
  type AssetRef,
  type Entity,
  type Transform,
} from './scene-schema.js'

/**
 * The prefab format: a reusable entity template, as text.
 *
 * Define an enemy once, place it fifty times by reference, and editing this file
 * changes every one of them.
 *
 * **It depends on the scene, and the scene does not depend on it.** A prefab
 * holds a component map, and what a component *is* is defined by the scene's
 * registry — so this file imports from `scene-schema.ts` and never the other way
 * round. The only thing pointing back is a scene entity's `prefab` component,
 * which lives with the registry because that is where components live. Keeping
 * the arrow one-way is what lets these be two files at all.
 *
 * That relative import is written with a `.js` extension on purpose. Both this
 * file and the scene's are compiled by the browser project *and* by the service's
 * — and `./scene-schema.js` is the one spelling both resolution modes accept
 * (`editor-ui` U4). Extensionless would break the service's typecheck.
 *
 * Three decisions worth knowing before changing anything here:
 *
 *   1. **A prefab carries its own id.** A texture's stable id lives in the
 *      `.meta` beside it because nothing can be written inside a PNG. A document
 *      has no such problem — it is its own annotation — so this holds the id
 *      that references to it record, and never grows a sidecar
 *      (`editor-kernel` D24).
 *
 *   2. **There is no transform.** A prefab says what a thing *is*; where it
 *      stands, how big it is and how far it is turned belong to each placement.
 *      A transform sitting here that instances ignored would be a field that
 *      looked authoritative and did nothing, which is worse than not having one.
 *      A *part* of a prefab (below) does carry one, and it means something
 *      different: an offset from whatever the part rides, which is the
 *      prefab's business exactly as the part's picture is.
 *
 *   3. **A prefab may not contain a `prefab` component.** Refused by the schema
 *      rather than guarded against at every reader, which is what makes a cycle
 *      unwritable instead of merely unlikely. The same refusal covers every
 *      part, and every override a placement gives a part.
 *
 *   4. **A prefab may hold parts, and a placement is still one entity.** The
 *      `children` list (optional, absent on a prefab with none — text-formats
 *      T21) names the entities that come *attached* to every instance: an arm
 *      that turns, and the fire that rides the arm. They are not written into
 *      the level. `resolveEntities` brings them into being beside their
 *      placement with derived ids and `parent` links (`partsOf`), so the level
 *      holds one reference per placement, a placement moves, copies and deletes
 *      as one thing with no code knowing about parts, and editing the prefab
 *      changes every placed group at once (editor-kernel D25, D37).
 */

export const PREFAB_FORMAT = 'kernel2d.prefab'
export const PREFAB_VERSION = 1

/**
 * One thing that comes attached to every instance of a prefab.
 *
 * The shape of a scene entity minus what a placement decides (its place in the
 * level, its own id): an id stable *within the prefab*, which is what a
 * placement's override names and what a derived id is built from; a transform
 * that is an offset from what it rides; an optional `parent` naming another
 * part, absent for one attached to the placement itself; and components.
 */
export interface PrefabPart {
  id: string
  name: string
  /** Where it sits relative to its parent — the prefab's own entity, or another part. */
  transform: Transform
  /** Another part's id. Absent means attached to the placement itself. */
  parent?: string | undefined
  components: Record<string, unknown>
}

export interface Prefab {
  format: typeof PREFAB_FORMAT
  version: typeof PREFAB_VERSION
  /** Stable, minted once, never changed. What a reference to this records. */
  id: string
  /** What it is called — and the name an instance of it starts with. */
  name: string
  /** What every instance of it draws. Same shape as an entity's. */
  components: Record<string, unknown>
  /**
   * What comes attached to every instance, in draw order after the placement
   * itself. Optional and absent for a prefab that is one entity, so every
   * prefab written before parts existed is byte-for-byte what it was.
   */
  children?: PrefabPart[] | undefined
  /** Present only on prefabs an AI produced. Read, preserved, never invented. */
  generatedBy?: string | undefined
  /** `YYYY-MM-DD`, alongside `generatedBy`. */
  generatedAt?: string | undefined
}

/**
 * Loose at every level, like every other format here: the editor rewrites this
 * file from the object it parsed, so a key the parse drops is a key deleted out
 * of a file a human wrote (text-formats T9).
 */
const PrefabPartSchema: z.ZodType<PrefabPart> = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  transform: z.looseObject({
    x: z.number().finite(),
    y: z.number().finite(),
    rotation: z.number().finite(),
    scaleX: z.number().finite(),
    scaleY: z.number().finite(),
  }),
  parent: z.string().min(1).optional(),
  components: z.record(z.string(), z.unknown()),
})

export const PrefabSchema: z.ZodType<Prefab> = z
  .looseObject({
    format: z.literal(PREFAB_FORMAT),
    version: z.literal(PREFAB_VERSION),
    id: z.string().min(1),
    name: z.string(),
    components: z.record(z.string(), z.unknown()),
    children: z.array(PrefabPartSchema).optional(),
    generatedBy: z.string().min(1).optional(),
    generatedAt: z.string().min(1).optional(),
  })
  .superRefine((prefab, ctx) => {
    // Caught here rather than at every reader: a prefab made of a prefab is a
    // cycle waiting to be written, and refusing the shape is what makes one
    // impossible instead of merely unlikely.
    if (Object.hasOwn(prefab.components, 'prefab')) {
      ctx.addIssue({
        code: 'custom',
        message: 'a prefab cannot be an instance of another prefab',
        path: ['components', 'prefab'],
        input: prefab.components['prefab'],
      })
      return
    }

    // The same check an entity's components get, from the same registry. Shared
    // rather than written twice, or a prefab would start accepting something a
    // scene rejects — which reads as the file being fine until it is placed.
    checkKnownComponents(prefab, ctx)

    // Every part is held to the same two rules, and to one more: its id is
    // what a placement's override names, so two parts sharing one would make
    // an override mean two things.
    const seen = new Set<string>()
    prefab.children?.forEach((part, index) => {
      if (Object.hasOwn(part.components, 'prefab')) {
        ctx.addIssue({
          code: 'custom',
          message: 'a part of a prefab cannot be an instance of another prefab',
          path: ['children', index, 'components', 'prefab'],
          input: part.components['prefab'],
        })
        return
      }
      if (seen.has(part.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `two parts share the id ${part.id}`,
          path: ['children', index, 'id'],
          input: part.id,
        })
      }
      seen.add(part.id)
      checkKnownComponents(part, ctx)
    })
  })

// --- resolving an instance ------------------------------------------------

/**
 * An entity with its prefab's components filled in.
 *
 * It lives with the format, because this is what a scene *means* rather than
 * something the editor does to one: the runtime's scene loader will need exactly
 * this arithmetic when it boots a level, and two derivations of it would be the
 * editor and the game disagreeing about what a level contains (editor-kernel D2,
 * D20, D25).
 *
 * **The transform is never touched.** Where an instance stands is its own, which
 * is decision 2 above.
 *
 * **What the entity carries itself wins, per component type.** Written first
 * for hand-edited files, which have to mean something, and "the one written
 * here beats the one it inherits" is the least surprising thing they can mean.
 * The editor now writes such an override on purpose — Add, on a described
 * component a placement inherits — and because the win is *whole*, that Add
 * copies the inherited component whole rather than writing the description's
 * defaults: a partial override would silently drop every key the description
 * does not name. (Named no more precisely than that on purpose: this file
 * ships inside the game, and the export refuses a bundle that so much as
 * mentions an editor file.)
 *
 * The result is **for drawing and describing, never for writing back**: it
 * carries a copy of the prefab's components, and saving it would bake them into
 * the level and quietly sever the link. Every writer in this kernel re-finds its
 * entity by id inside a transaction, which is what keeps that true by
 * construction rather than by remembering.
 */
export function resolveEntity(entity: Entity, prefab: Prefab | null): Entity {
  // The same object back when there is nothing to merge, so a scene with no
  // instances in it costs nothing and stays stable to compare against.
  if (prefab === null) return entity
  return { ...entity, components: { ...prefab.components, ...entity.components } }
}

/**
 * Every entity in a scene, resolved against the prefabs found by path — and,
 * for a placement of a prefab with parts, the parts right behind it.
 *
 * The list can therefore be longer than the file's. Everything that reads it
 * (the renderer, the loader's texture walk, the play comparison) wants every
 * drawn thing; everything that *writes* re-finds its entity in the file by id,
 * and a part's id is never in the file. Between the two, the parts are drawn
 * and never saved, which is what "placed by reference" continues to mean.
 */
export function resolveEntities(
  entities: readonly Entity[],
  prefabs: Readonly<Record<string, Prefab>>,
): Entity[] {
  return entities.flatMap((entity) => {
    const source = prefabRefOf(entity)
    if (source === null) return [entity]
    // Resolved by path, per D5. A prefab that is missing leaves the entity
    // exactly as the file has it, which is what lets a panel say so.
    const prefab = prefabs[source.path] ?? null
    if (prefab === null) return [entity]
    return [resolveEntity(entity, prefab), ...partsOf(entity, prefab)]
  })
}

// --- parts ------------------------------------------------------------------

/** Between a placement's id and a part's id in a derived id. Neither half can hold one. */
export const PART_SEPARATOR = ':'

/** The id a part is drawn under when this placement is resolved. */
export function partIdOf(placementId: string, partId: string): string {
  return `${placementId}${PART_SEPARATOR}${partId}`
}

/**
 * Which placement a drawn entity belongs to, and which part it is — or null
 * for an entity that is in the level in its own right.
 *
 * The derived id is not a format id: it is never written to a file and no
 * schema validates it. It exists so the viewport, the overlay and the play
 * comparison can agree about a part without a side table.
 */
export function partOf(id: string): { placement: string; part: string } | null {
  const at = id.indexOf(PART_SEPARATOR)
  if (at <= 0 || at === id.length - 1) return null
  return { placement: id.slice(0, at), part: id.slice(at + 1) }
}

/**
 * The parts of a prefab, as the entities that come attached to this placement.
 *
 * Each is an ordinary entity: a derived id, a name that says whose part it is,
 * the part's transform as its offset, a `parent` that is the placement (or the
 * derived id of the part it rides), and the part's components with this
 * placement's overrides winning whole per type. A part whose `parent` names
 * nothing in the prefab is attached to the placement rather than lost.
 *
 * Fresh objects every time, deliberately: nothing may write to these, and
 * nothing may keep them — the next resolution answers again.
 */
export function partsOf(placement: Entity, prefab: Prefab): Entity[] {
  const children = prefab.children ?? []
  if (children.length === 0) return []

  const ids = new Set(children.map((part) => part.id))
  const overrides = componentOf(placement, 'prefab')?.parts ?? {}

  return children.map((part) => {
    const rides = part.parent !== undefined && part.parent !== part.id && ids.has(part.parent)
    return {
      id: partIdOf(placement.id, part.id),
      name: `${placement.name} › ${part.name}`,
      transform: { ...part.transform },
      parent: rides ? partIdOf(placement.id, part.parent as string) : placement.id,
      components: { ...part.components, ...(overrides[part.id] ?? {}) },
    }
  })
}

/** A new part: named, at the placement's own spot, drawing nothing yet. */
export function defaultPart(id: string, name: string): PrefabPart {
  return { id, name, transform: defaultTransform(), components: {} }
}

// --- what a fresh one looks like ------------------------------------------

/**
 * A new prefab: named, with an id, and drawing nothing yet.
 *
 * Empty rather than pre-filled with a sprite that points nowhere — a reference
 * to no file is a broken reference, and a format should not ship one as its
 * starting state.
 */
export function defaultPrefab(id: string, name: string): Prefab {
  return { format: PREFAB_FORMAT, version: PREFAB_VERSION, id, name, components: {} }
}

/** An entity that is an instance of a prefab, placed and named. */
export function instanceOfPrefab(id: string, name: string, source: AssetRef): Entity {
  return { id, name, transform: defaultTransform(), components: { prefab: { source } } }
}

/** How a prefab is written to disk: two spaces and a trailing newline, like a scene. */
export function serializePrefab(prefab: Prefab): string {
  return `${JSON.stringify(prefab, null, 2)}\n`
}
