import { partsOf, type Prefab } from '../../runtime/formats/prefab-schema'
import { SCENE_FORMAT, componentOf, type Entity } from '../../runtime/formats/scene-schema'
import type { EditIntent } from '../store/documents'
import { editDocument } from '../store/open-documents'

/**
 * A placement's say over the parts of its prefab — reading it, and the one
 * writer that changes it.
 *
 * A placed prefab is one entity carrying a reference (`editor-kernel` D25); its
 * parts are brought into being when the prefab is resolved and are never in
 * the level file. So "this fire bar's arm turns at 180" cannot be written on
 * the arm — there is no arm to write on. It is written on the placement,
 * inside the reference, as `prefab.parts[partId][type]`, and resolution lets
 * it win whole over the prefab's (`runtime/formats/prefab-schema.ts`).
 *
 * **The tidying lives here and nowhere else.** An override record emptied by
 * Remove is deleted, and an emptied `parts` map is deleted after it, so a
 * placement that has stopped overriding anything carries a reference and
 * nothing else again — the same absent-not-empty rule every optional field in
 * these formats keeps (text-formats T21). Two writers each remembering to tidy
 * would be one forgetting.
 */

type Components = Record<string, unknown>

/** What this placement gives one of its parts, or an empty map when it gives nothing. */
export function overridesOf(placement: Entity, partId: string): Components {
  return componentOf(placement, 'prefab')?.parts?.[partId] ?? {}
}

/** The parts this placement draws, resolved, in the prefab's order. */
export function resolvedPartsOf(placement: Entity, prefab: Prefab): Entity[] {
  return partsOf(placement, prefab)
}

/**
 * One edit to what a placement gives one part. The recipe is handed the
 * override record for that part, created if it was not there, and may add,
 * change or delete component entries on it.
 */
export function editPartOverride(
  scenePath: string,
  placementId: string,
  partId: string,
  intent: EditIntent,
  recipe: (components: Components) => void,
): void {
  editDocument(scenePath, intent, (document) => {
    if (document.format !== SCENE_FORMAT) return
    // Re-found by id inside the transaction, never closed over (`editor-ui` U23).
    const placement = document.entities.find((candidate) => candidate.id === placementId)
    if (placement === undefined) return
    const reference = placement.components['prefab']
    if (typeof reference !== 'object' || reference === null) return
    const holder = reference as { parts?: Record<string, Components> }

    const parts = holder.parts ?? {}
    const record = parts[partId] ?? {}
    recipe(record)

    if (Object.keys(record).length === 0) delete parts[partId]
    else parts[partId] = record

    if (Object.keys(parts).length === 0) delete holder.parts
    else holder.parts = parts
  })
}
