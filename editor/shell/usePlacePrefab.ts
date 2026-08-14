import { instanceOfPrefab } from '../../runtime/formats/prefab-schema'
import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import type { Point } from '../../runtime/scene/coordinates'
import { mintId } from '../store/ids'
import { editDocument, usePrefabDocument } from '../store/open-documents'
import { freeName, namesIn } from './entity-names'
import { usePlacing } from './placing'
import { useResolvedScene } from './scene-prefabs'
import { useSceneView } from './scene-view-context'
import { useSelection } from './selection'
import { snapPoint } from './snap'

/**
 * Putting one instance of a prefab into the open level.
 *
 * Shared rather than owned by the panel that first needed it, because placing
 * has to be reachable from **two** places and they are the same gesture. The
 * Inspector holds one thing at a time, so placing from a prefab — which selects
 * what it just placed — moves the panel off the prefab, and a second press would
 * have nothing to press. So the entity that was just placed offers it too, and
 * "place it fifty times" is fifty presses of whatever is in front of you rather
 * than fifty round trips back to the Assets panel.
 *
 * Two decisions live in here:
 *
 *   - **It writes a reference and nothing else.** Copying the prefab's
 *     components in at placement time would look identical on the day it was
 *     placed and stop following the prefab the day after, which is the one thing
 *     placing by reference is for.
 *   - **It lands where it is asked to, snapped the same way a drag is** — in the
 *     middle of what the Viewport is showing when nowhere is named. The level's
 *     origin is frequently nowhere near the screen once there is a camera, so
 *     placing there would be correct and invisible.
 *
 * **Two doors rather than one function taking an optional point**, because the
 * caller that has no point is a button: `onClick={place}` hands a React event to
 * whatever the first argument is, and an optional position would take it,
 * silently, as a place to put a prefab. The names also say which is which at the
 * call site, which an `undefined` does not.
 *
 * Selection happens outside the transaction, because what is selected afterwards
 * is not part of the edit (`editor-ui` U8). `placeAt` deliberately does *not*
 * select: it is the one used twenty times in a row, and moving the Inspector off
 * the prefab on the first press is exactly the problem repeat-placing exists to
 * solve (`editor/shell/placing.tsx`).
 *
 * **The prefab comes from the document store, not from what the level already
 * references.** Reading the resolved level's set would be a neat symmetry and a
 * chicken-and-egg: a prefab nothing has placed yet is in no level's set, so a
 * brand-new one could never be placed for the first time. The store holds both
 * cases — the one the Inspector is showing, because selecting it is what read
 * it, and the ones the level points at, because resolving them put them there.
 */
export function usePlacePrefab(prefabPath: string | null): {
  /** The level a prefab would go into, or null when none is open. */
  scenePath: string | null
  /** Whether this prefab could be placed right now. */
  canPlace: boolean
  /** What this prefab is called, for anything that has to say so. */
  prefabName: string | null
  /** One, in the middle of the view, selected afterwards. */
  place: () => void
  /** One, at a point in the level's own units, changing nothing else. */
  placeAt: (at: Point) => void
} {
  const resolved = useResolvedScene()
  const view = useSceneView()
  const selection = useSelection()
  const placing = usePlacing()
  const prefab = usePrefabDocument(prefabPath)

  /** Answers the id it minted, or null when there was nothing to place into. */
  const put = (at: Point): string | null => {
    const scenePath = resolved.path
    if (scenePath === null || prefab === null || prefabPath === null) return null

    const landing = snapPoint(at, placing.snap)
    const id = mintId()

    editDocument(scenePath, { label: 'Place prefab' }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      const entity = instanceOfPrefab(id, nextInstanceName(document.entities, prefab.name), {
        id: prefab.id,
        path: prefabPath,
      })
      entity.transform.x = landing.x
      entity.transform.y = landing.y
      document.entities.push(entity)
    })

    return id
  }

  const place = (): void => {
    const focus = view.state === 'ready' && view.shown !== null ? view.shown.camera.focus : { x: 0, y: 0 }
    const id = put(focus)
    if (id !== null && resolved.path !== null) selection.selectEntity(resolved.path, id)
  }

  return {
    scenePath: resolved.path,
    canPlace: resolved.path !== null && prefab !== null,
    prefabName: prefab?.name ?? null,
    place,
    placeAt: (at) => {
      put(at)
    },
  }
}

/**
 * What a placed instance is called: the prefab's name, then a number.
 *
 * Counting within the level rather than across the project, because "Slime 2"
 * should mean the second one here and not the second one ever placed. The bare
 * name is offered first, so the only slime in a level is just "Slime".
 */
function nextInstanceName(entities: readonly Entity[], prefabName: string): string {
  const stem = prefabName.trim() === '' ? 'Instance' : prefabName.trim()
  return freeName(namesIn(entities), stem, { bare: true })
}
