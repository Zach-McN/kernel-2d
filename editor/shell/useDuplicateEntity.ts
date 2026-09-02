import { SCENE_FORMAT, copyEntity } from '../../runtime/formats/scene-schema'
import { mintId } from '../store/ids'
import { editDocument } from '../store/open-documents'
import { freeName, namesIn, stemOfName } from './entity-names'
import { useOpenScene } from './open-scene'
import { blockOf } from './reparent'
import { useSelection } from './selection'

/**
 * A copy of one entity, in the same place, selected afterwards.
 *
 * Shared rather than owned by the Outliner that first had the button, for the
 * reason `usePlacePrefab` was shared: the gesture is reachable from two places
 * and they are the same gesture. The button is in the Outliner; `Shift-D` is in
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
 * **A copy brings everything attached to the original.** The whole block — the
 * entity and its descendants, in list order — is copied under fresh ids, every
 * `parent` inside the block is pointed at the corresponding copy, and the copy
 * of the root keeps the original's own parent, so a duplicated child is a child
 * of the same thing. A copy that left the children behind would be a duplicate
 * of half an entity.
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
        const block = blockOf(document.entities, entityId)
        const last = block[block.length - 1]
        if (last === undefined) return

        // Fresh ids for the whole block, minted here so the parents inside it
        // can be pointed at the copies before anything is written.
        const ids = new Map(block.map((entity) => [entity.id, entity.id === entityId ? copyId : mintId()]))
        // Names are claimed as they are minted: two children both called
        // "Fire" must not both become "Fire 2".
        const taken = new Set(namesIn(document.entities))
        const copies = block.map((original) => {
          const name = freeName(taken, stemOfName(original.name))
          taken.add(name)
          const copy = copyEntity(original, ids.get(original.id) as string, name)
          const parent = copy.parent
          if (parent !== undefined && ids.has(parent)) copy.parent = ids.get(parent) as string
          return copy
        })

        // Directly after the original's block, so the copy sits just in front of
        // it and the children keep their order among themselves.
        const at = document.entities.findIndex((entity) => entity.id === last.id)
        document.entities.splice(at + 1, 0, ...copies)
      })

      selection.selectEntity(scenePath, copyId)
    },
  }
}

