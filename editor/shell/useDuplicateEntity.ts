import { SCENE_FORMAT, copyEntity, type Entity } from '../../runtime/formats/scene-schema'
import { mintId } from '../store/ids'
import { editDocument } from '../store/open-documents'
import { freeName, namesIn, stemOfName } from './entity-names'
import { useOpenScene } from './open-scene'
import { useSelection } from './selection'

/**
 * A copy of one entity, in the same place, selected afterwards.
 *
 * Shared rather than owned by the Hierarchy that first had the button, for the
 * reason `usePlacePrefab` was shared: the gesture is reachable from two places
 * and they are the same gesture. The button is in the Hierarchy; `Shift-D` is in
 * the viewport, where the hand already is. One implementation, so the two can
 * never disagree about what a copy is.
 *
 * Three things about a copy that are decisions rather than details:
 *
 *   - **What survives is a fact about the format**, so `copyEntity` answers it.
 *     A copy that enumerated components here would go stale the day one is added.
 *   - **It gets a new id**, because two entities with one id is a scene the
 *     format rejects, and the failure would surface at the next save rather than
 *     at the press.
 *   - **It goes directly after the original**, not at the end of the list. List
 *     order is draw order, so appending would quietly bring the copy to the
 *     front of the level.
 *
 * It lands exactly on top of the original — the same transform, which is what
 * "duplicate" means everywhere else and what makes `Shift-D` then `G` the whole
 * of "another one, over there". Any offset would be a number this editor
 * invented.
 *
 * Selecting the copy happens outside the transaction, because what is selected
 * afterwards is not part of the edit (`editor-ui` U8) — otherwise Ctrl-Z would
 * restore a selection as well as a document.
 */
export function useDuplicateEntity(): {
  /** The level a copy would go into, or null when none is open. */
  scenePath: string | null
  /** A copy of this entity, selected afterwards. Does nothing if it has gone. */
  duplicate: (entityId: string) => void
} {
  const open = useOpenScene()
  const selection = useSelection()
  const scenePath = open.state === 'open' ? open.path : null

  return {
    scenePath,
    duplicate: (entityId) => {
      if (scenePath === null) return
      const copyId = mintId()

      editDocument(scenePath, { label: 'Duplicate entity' }, (document) => {
        if (document.format !== SCENE_FORMAT) return
        // Re-found by id inside the transaction rather than closed over as an
        // index: between the press and the recipe, a text editor may have
        // changed the file, and an index into a list that has moved on is how
        // the wrong thing gets copied.
        const at = document.entities.findIndex((entity) => entity.id === entityId)
        const source = document.entities[at]
        if (source === undefined) return
        document.entities.splice(at + 1, 0, copyEntity(source, copyId, nextCopyName(document.entities, source.name)))
      })

      selection.selectEntity(scenePath, copyId)
    },
  }
}

/**
 * What a copy is called: the original's name with a number after it.
 *
 * A duplicate that kept the name exactly would give the list two identical rows
 * — legal in the format, and useless to read. Counting up from the original's
 * stem rather than from the list's length keeps "Slime 2, Slime 3" in order
 * however much else is in the scene.
 */
function nextCopyName(entities: readonly Entity[], original: string): string {
  return freeName(namesIn(entities), stemOfName(original))
}
