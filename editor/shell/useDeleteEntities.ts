import { SCENE_FORMAT } from '../../runtime/formats/scene-schema'
import { editDocument } from '../store/open-documents'
import { entitiesLabel } from './entity-count'
import { useOpenScene } from './open-scene'
import { useSelection } from './selection'

/**
 * Removing the selected entities from the open scene, however many there are.
 *
 * Shared rather than owned by the Outliner that first had the button, for the
 * reason `useDuplicateEntity` is shared: the gesture is reachable from two
 * places — the Delete button in the Outliner and the `Delete`/`Backspace` keys
 * over the picture — and they are the same gesture. One implementation, so the two can
 * never disagree about what a delete is.
 *
 * **One transaction, whatever the count, and that is the whole of the undo
 * behaviour.** Six entities removed in six edits would be six presses of Ctrl-Z
 * to get them back, with the level passing through five states nobody asked
 * for on the way. Six removed in one recipe is one step, and no undo code is
 * written here — the transaction API already recorded the patches
 * (`editor-kernel` D7).
 *
 * Each entity is re-found by id **inside** the recipe rather than closed over as
 * an index, the rule every writer of this document keeps (`editor-ui` U23):
 * between the press and the recipe a text editor may have changed the file, and
 * an index into a list that has moved on is how the wrong thing gets deleted.
 * Splicing from the back is the second half of that — removing by ascending
 * index would shift every later entity out from under its own index mid-loop.
 *
 * What is selected afterwards is decided out here, where undo cannot see it
 * (`editor-ui` U8) — the same placement `useDuplicateEntity` uses for selecting
 * its copy. It lands on the scene file rather than on nothing, so the Inspector
 * still has something to describe and the level stays open.
 */
export function useDeleteEntities(): {
  /** The entities a delete key and the Delete button would remove, in order. */
  entities: readonly string[]
  /** True when there is anything to delete, for a button's disabled state. */
  canDelete: boolean
  /** Removes the selected entities. Does nothing when there are none. */
  deleteSelected: () => void
} {
  const open = useOpenScene()
  const selection = useSelection()

  const scenePath = open.state === 'open' ? open.path : null
  // Only entities belonging to the level actually on screen. The selection
  // names its own scene, so a stale selection left over from a level that has
  // since been closed cannot delete out of the one that is open now.
  const entities =
    scenePath !== null && selection.selected.kind === 'entity' && selection.selected.scene === scenePath
      ? selection.selectedEntities
      : []

  return {
    entities,
    canDelete: entities.length > 0,
    deleteSelected: () => {
      if (scenePath === null || entities.length === 0) return
      const going = new Set(entities)

      editDocument(scenePath, { label: entitiesLabel('Delete', entities.length) }, (document) => {
        if (document.format !== SCENE_FORMAT) return
        for (let at = document.entities.length - 1; at >= 0; at -= 1) {
          const entity = document.entities[at]
          if (entity !== undefined && going.has(entity.id)) document.entities.splice(at, 1)
        }
      })

      selection.selectFile(scenePath)
    },
  }
}

