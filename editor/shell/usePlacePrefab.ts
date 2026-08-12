import { SCENE_FORMAT, instanceOfPrefab, type Entity } from '../../runtime/formats/scene-schema'
import { mintId } from '../store/ids'
import { editDocument, usePrefabDocument } from '../store/open-documents'
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
 *   - **It writes a reference and nothing else.** Copying the prefab's
 *     components in at placement time would look identical on the day it was
 *     placed and stop following the prefab the day after, which is the one thing
 *     placing by reference is for.
 *   - **It lands in the middle of what the Viewport is showing**, snapped to
 *     whole units the same way a drag is. The level's origin is frequently
 *     nowhere near the screen once there is a camera, so placing there would be
 *     correct and invisible.
 *
 * Selection happens outside the transaction, because what is selected afterwards
 * is not part of the edit (`editor-ui` U8).
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
  place: () => void
} {
  const resolved = useResolvedScene()
  const view = useSceneView()
  const selection = useSelection()
  const prefab = usePrefabDocument(prefabPath)

  const place = (): void => {
    const scenePath = resolved.path
    if (scenePath === null || prefab === null || prefabPath === null) return

    const focus = view.state === 'ready' && view.shown !== null ? view.shown.camera.focus : { x: 0, y: 0 }
    const id = mintId()

    editDocument(scenePath, { label: 'Place prefab' }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      const entity = instanceOfPrefab(id, nextInstanceName(document.entities, prefab.name), {
        id: prefab.id,
        path: prefabPath,
      })
      entity.transform.x = Math.round(focus.x)
      entity.transform.y = Math.round(focus.y)
      document.entities.push(entity)
    })

    selection.selectEntity(scenePath, id)
  }

  return { scenePath: resolved.path, canPlace: resolved.path !== null && prefab !== null, place }
}

/**
 * What a placed instance is called: the prefab's name, then a number.
 *
 * Counting within the level rather than across the project, because "Slime 2"
 * should mean the second one here and not the second one ever placed. Names are
 * not identifiers — the id is what anything refers to — but fifty rows all
 * reading "Slime" is a list nobody can use.
 */
function nextInstanceName(entities: readonly Entity[], prefabName: string): string {
  const stem = prefabName.trim() === '' ? 'Instance' : prefabName.trim()
  const taken = new Set(entities.map((entity) => entity.name))
  if (!taken.has(stem)) return stem
  for (let n = 2; ; n += 1) {
    const name = `${stem} ${n}`
    if (!taken.has(name)) return name
  }
}
