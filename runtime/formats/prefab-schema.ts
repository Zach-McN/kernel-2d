import { z } from 'zod'

import {
  checkKnownComponents,
  defaultTransform,
  prefabRefOf,
  type AssetRef,
  type Entity,
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
 *
 *   3. **A prefab may not contain a `prefab` component.** Refused by the schema
 *      rather than guarded against at every reader, which is what makes a cycle
 *      unwritable instead of merely unlikely.
 */

export const PREFAB_FORMAT = 'kernel2d.prefab'
export const PREFAB_VERSION = 1

export interface Prefab {
  format: typeof PREFAB_FORMAT
  version: typeof PREFAB_VERSION
  /** Stable, minted once, never changed. What a reference to this records. */
  id: string
  /** What it is called — and the name an instance of it starts with. */
  name: string
  /** What every instance of it draws. Same shape as an entity's. */
  components: Record<string, unknown>
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
export const PrefabSchema: z.ZodType<Prefab> = z
  .looseObject({
    format: z.literal(PREFAB_FORMAT),
    version: z.literal(PREFAB_VERSION),
    id: z.string().min(1),
    name: z.string(),
    components: z.record(z.string(), z.unknown()),
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
 * **What the entity carries itself wins, per component type.** The editor offers
 * no way to write such an override today, but a hand-edited file has to mean
 * something, and "the one written here beats the one it inherits" is the least
 * surprising thing it can mean. It is also the shape overrides will need when
 * they arrive, so nothing has to change format to get them.
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

/** Every entity in a scene, resolved against the prefabs found by path. */
export function resolveEntities(
  entities: readonly Entity[],
  prefabs: Readonly<Record<string, Prefab>>,
): Entity[] {
  return entities.map((entity) => {
    const source = prefabRefOf(entity)
    // Resolved by path, per D5. A prefab that is missing leaves the entity
    // exactly as the file has it, which is what lets a panel say so.
    return source === null ? entity : resolveEntity(entity, prefabs[source.path] ?? null)
  })
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
