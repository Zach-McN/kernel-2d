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
  /**
   * Files in the Assets panel — one or many — or one folder.
   *
   * The same two invariants as the entity case, for the same reasons: **never
   * empty**, and the list is in the order things were added. `anchor` is the
   * last path that was plainly clicked or Ctrl-clicked — what a Shift-click
   * measures its range from — and it need not still be in `paths`.
   *
   * **A folder is always alone.** The verbs that act on many are file verbs
   * (delete, drag into a level), and a folder joining a group would be a group
   * nothing could act on. So a folder replaces whatever was selected, and a
   * range skips folders — this file, and the panel that builds the range, agree
   * on that rather than each reader deciding what a mixed list means.
   */
  | { kind: 'file'; paths: readonly string[]; anchor: string }
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

  /** Replaces whatever was selected with this one file or folder. A plain click. */
  selectFile: (path: string) => void
  /**
   * Adds a file to the selection or takes it out — Ctrl-click. Taking the last
   * one out lands on nothing selected. A folder cannot join: it replaces
   * (`isFolder` says which this path is, because the selection cannot know).
   */
  toggleFile: (path: string, isFolder: boolean) => void
  /**
   * Replaces the selected files with these, keeping the anchor — Shift-click.
   * The panel hands in the range in the order of the view that was clicked,
   * files only, because which rows lie between two others is a fact about what
   * is on screen and this layer cannot see the screen. An empty range selects
   * nothing.
   */
  selectFileRange: (paths: readonly string[]) => void
  /**
   * The folder listing changed: files that are gone leave the selection. Only
   * when several are selected — a single file that has gone stays selected so
   * the Inspector can say it has gone, which is a sentence worth keeping.
   */
  dropMissingFiles: (exists: (path: string) => boolean) => void
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
   * The selected file's path when **exactly one** file or folder is selected,
   * or null otherwise — including when several are.
   *
   * Null for several on purpose. Every singular reader — the Inspector's file
   * body, the Texture tab, the import settings, the level that opens when a
   * scene is selected, the rename that follows the selection — asks this, and
   * "the file being looked at" has no honest answer when three are; naming one
   * of them would have the Texture tab show a picture nobody chose. So the
   * plural readers ask `selectedFiles`, and this stays what it always was.
   */
  selectedFilePath: string | null

  /** Every selected file, in the order they were added, or empty. */
  selectedFiles: readonly string[]

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
      selectFile: (path) => setSelected({ kind: 'file', paths: [path], anchor: path }),

      toggleFile: (path, isFolder) =>
        setSelected((was) => {
          // A folder is always alone, and a folder in the selection means it is
          // the only thing there — so any Ctrl-click that involves one replaces.
          if (isFolder || was.kind !== 'file') return { kind: 'file', paths: [path], anchor: path }
          if (was.paths.includes(path)) {
            const rest = was.paths.filter((one) => one !== path)
            // The never-empty invariant. The anchor stays where it was: what a
            // Shift-click measures from is the last thing *pointed at*, and
            // taking a file out is pointing at it.
            return rest.length === 0 ? { kind: 'none' } : { kind: 'file', paths: rest, anchor: path }
          }
          return { kind: 'file', paths: [...was.paths, path], anchor: path }
        }),

      selectFileRange: (paths) =>
        setSelected((was) => {
          if (paths.length === 0) return { kind: 'none' }
          const anchor = was.kind === 'file' ? was.anchor : (paths[0] ?? '')
          return { kind: 'file', paths: [...paths], anchor }
        }),

      dropMissingFiles: (exists) =>
        setSelected((was) => {
          if (was.kind !== 'file' || was.paths.length < 2) return was
          const kept = was.paths.filter(exists)
          if (kept.length === was.paths.length) return was
          return kept.length === 0 ? { kind: 'none' } : { kind: 'file', paths: kept, anchor: was.anchor }
        }),

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
      selectedFilePath: selected.kind === 'file' && selected.paths.length === 1 ? (selected.paths[0] ?? null) : null,
      selectedFiles: selected.kind === 'file' ? selected.paths : [],
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
