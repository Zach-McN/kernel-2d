import type { Point } from '../../runtime/scene/coordinates'
import { usePrefabDocument } from '../store/open-documents'
import { placePrefabInstance } from './place-into-scene'
import { usePlacing } from './placing'
import { useResolvedScene } from './scene-prefabs'
import { useSceneView } from './scene-view-context'
import { useSelection } from './selection'

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
 *   - **It lands where it is asked to, snapped the same way a drag is** — in the
 *     middle of what the Viewport is showing when nowhere is named. The level's
 *     origin is frequently nowhere near the screen once there is a camera, so
 *     placing there would be correct and invisible.
 *   - **The prefab comes from the document store**, which is what this hook is
 *     for. The recipe that writes the instance is not: a prefab dropped on the
 *     picture was read off disk a moment earlier and has never been in the
 *     store, so what an instance *is* lives in `place-into-scene.ts` and both
 *     callers use it.
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

    // The recipe itself is shared with the drop, which has read its prefab off
    // disk rather than from the store (`place-into-scene.ts`).
    return placePrefabInstance({ scenePath, prefabPath, prefab, at, snap: placing.snap }).entity
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
