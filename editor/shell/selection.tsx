import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'

/**
 * What is selected in the editor, and which scene is open — two different
 * things, shared by every panel that cares about either.
 *
 * Neither is part of the document. Neither is ever serialized, neither appears
 * in a saved file, and neither must ever be undoable: pressing undo after
 * clicking around should reverse the last thing that was *changed*, not the
 * last thing that was *looked at*. Keeping both out of the document store is
 * what makes that true by construction rather than by remembering.
 *
 * **Why they are two things.** Opening a scene and selecting a texture are both
 * "looking at something", and they happen at the same time: with a level open,
 * clicking a PNG in the Assets panel means two things are being looked at, and
 * only one of them is selected. Folding the open scene into selection would mean
 * clicking that PNG either closed the level or left a scene path sitting in a
 * field that also means "what is selected", which is one field with two
 * meanings — and every reader would decide for itself which one applied.
 *
 * **Why selection is a union rather than a path plus an entity id.** A pair can
 * spell states that are not real: an entity id belonging to a scene that is not
 * the selected file, or an entity id while a texture is selected. Four
 * combinations, three of them meaningful, and every reader has to know which
 * one to ignore. A union cannot write those down.
 *
 * **Why the entity case holds a list, and what the list guarantees.** Selecting
 * several entities and deleting them together is one gesture, so the plural
 * lives here rather than beside here — a second "and also these" field would be
 * a second answer to "what is selected", which is the pair problem again.
 *
 * Two invariants make the list safe to read anywhere, and both are the same
 * argument as the union itself — a state that cannot be written down is a state
 * nobody has to check for:
 *
 *   1. **It is never empty.** An empty entity-selection and `{ kind: 'none' }`
 *      would be two spellings of one state. Taking the last entity out of the
 *      selection therefore lands on `none`.
 *   2. **The last one is the primary one** — the most recently touched. It is
 *      what the Inspector describes, what `F` frames, what `G` grabs and what
 *      the reorder arrows move. Everything singular in the editor reads
 *      `selectedEntity` and gets that one, which is why adding the plural did
 *      not make any of those panels grow a new thought.
 *
 * Going plural did **not** make selection undoable. It is still UI state, still
 * outside the document, and Ctrl-Z still reverses the last thing that was
 * changed rather than the last thing that was looked at (`editor-ui` U8). What
 * the plural buys the undo stack is on the other side: deleting six entities is
 * one transaction, so it is one press of Ctrl-Z that brings all six back.
 */

export type Selected =
  | { kind: 'none' }
  /** A file or folder in the Assets panel. */
  | { kind: 'file'; path: string }
  /**
   * Entities in a scene — one or many. The scene is named so this can never be
   * orphaned, and it is one scene rather than one per entity: a selection
   * spanning two levels is not a thing the editor can act on, so it is not a
   * thing this type can spell.
   *
   * Never empty, and the last element is the primary one. See above.
   */
  | { kind: 'entity'; scene: string; entities: readonly string[] }

export interface Selection {
  selected: Selected
  /** Which scene the Viewport and Outliner are showing, or null. */
  openScene: string | null

  selectFile: (path: string) => void
  /** Replaces whatever was selected with this one entity. */
  selectEntity: (scene: string, entity: string) => void
  /**
   * Adds an entity to the selection and makes it the primary one — Shift.
   *
   * An entity from a *different* scene replaces rather than joins, because the
   * type above cannot hold two scenes and pretending otherwise would mean
   * picking one of them to silently drop.
   */
  addToSelection: (scene: string, entity: string) => void
  /**
   * Takes an entity out of the selection — Ctrl. Taking the last one out lands
   * on nothing selected, per the never-empty invariant. Harmless when the
   * entity was not selected in the first place.
   */
  removeFromSelection: (entity: string) => void
  selectNothing: () => void
  /**
   * Changes which scene is open.
   *
   * Called by the provider that reads documents rather than by the panel that
   * was clicked, and that is deliberate: whether a file is a scene is decided by
   * what the file *says it is*, not by where it sits or what it is called
   * (`editor-ui` U11). Nothing here guesses from a path.
   */
  setOpenScene: (path: string | null) => void

  /**
   * The selected file's path, or null when what is selected is not a file.
   *
   * A convenience for the panels that only ever ask about files — the Assets
   * tree, the import settings — so the union stays in the places that need to
   * tell the cases apart.
   */
  selectedFilePath: string | null

  /**
   * Every selected entity, in the order they were added, or empty when what is
   * selected is not an entity. The mirror of `selectedFilePath`, for the same
   * reason: the union stays in the places that need to tell the cases apart.
   */
  selectedEntities: readonly string[]

  /**
   * The primary selected entity — the last one touched — or null.
   *
   * What everything singular reads: the Inspector, `F`, `G`, Frame selected,
   * the reorder arrows. A panel that wants "the entity being worked on" wants
   * this one, and a panel that wants "everything the next delete would remove"
   * wants `selectedEntities`.
   */
  selectedEntity: string | null
}

const SelectionContext = createContext<Selection | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }): ReactElement {
  const [selected, setSelected] = useState<Selected>({ kind: 'none' })
  const [openScene, setOpenScene] = useState<string | null>(null)

  const value = useMemo<Selection>(() => {
    const entities = selected.kind === 'entity' ? selected.entities : []

    return {
      selected,
      openScene,
      selectFile: (path) => setSelected({ kind: 'file', path }),
      selectEntity: (scene, entity) => setSelected({ kind: 'entity', scene, entities: [entity] }),

      addToSelection: (scene, entity) =>
        setSelected((was) => {
          // A different scene — or nothing selected, or a file — starts a fresh
          // selection rather than joining one that is about somewhere else.
          if (was.kind !== 'entity' || was.scene !== scene) {
            return { kind: 'entity', scene, entities: [entity] }
          }
          // Already in it: moved to the end rather than added twice, because
          // the end is what "primary" means and Shift-clicking something is a
          // way of saying you meant that one.
          const rest = was.entities.filter((one) => one !== entity)
          return { kind: 'entity', scene, entities: [...rest, entity] }
        }),

      removeFromSelection: (entity) =>
        setSelected((was) => {
          if (was.kind !== 'entity') return was
          const rest = was.entities.filter((one) => one !== entity)
          if (rest.length === was.entities.length) return was
          // The never-empty invariant, in the one place that could break it.
          return rest.length === 0 ? { kind: 'none' } : { kind: 'entity', scene: was.scene, entities: rest }
        }),

      selectNothing: () => setSelected({ kind: 'none' }),
      setOpenScene,
      selectedFilePath: selected.kind === 'file' ? selected.path : null,
      selectedEntities: entities,
      selectedEntity: entities.at(-1) ?? null,
    }
  }, [selected, openScene])

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext)
  if (selection === null) throw new Error('useSelection was called outside the editor shell')
  return selection
}
