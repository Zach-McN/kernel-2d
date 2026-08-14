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
 */

export type Selected =
  | { kind: 'none' }
  /** A file or folder in the Assets panel. */
  | { kind: 'file'; path: string }
  /** An entity in a scene. The scene is named so this can never be orphaned. */
  | { kind: 'entity'; scene: string; entity: string }

export interface Selection {
  selected: Selected
  /** Which scene the Viewport and Outliner are showing, or null. */
  openScene: string | null

  selectFile: (path: string) => void
  selectEntity: (scene: string, entity: string) => void
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
}

const SelectionContext = createContext<Selection | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }): ReactElement {
  const [selected, setSelected] = useState<Selected>({ kind: 'none' })
  const [openScene, setOpenScene] = useState<string | null>(null)

  const value = useMemo<Selection>(
    () => ({
      selected,
      openScene,
      selectFile: (path) => setSelected({ kind: 'file', path }),
      selectEntity: (scene, entity) => setSelected({ kind: 'entity', scene, entity }),
      selectNothing: () => setSelected({ kind: 'none' }),
      setOpenScene,
      selectedFilePath: selected.kind === 'file' ? selected.path : null,
    }),
    [selected, openScene],
  )

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext)
  if (selection === null) throw new Error('useSelection was called outside the editor shell')
  return selection
}
