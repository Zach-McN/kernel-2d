import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'

/**
 * What is selected in the editor, shared by every panel that cares.
 *
 * Deliberately not part of the document. Selection is never serialized, never
 * appears in a saved file, and must never be undoable: pressing undo after
 * clicking a different file should reverse the last thing that was *changed*,
 * not the last thing that was *looked at*. Keeping it out of the document
 * store is what makes that true by construction rather than by remembering.
 *
 * A plain context rather than a store, because that is all a single path needs
 * and there is no document state yet for a store to hold.
 */

export interface Selection {
  /** Project-relative, forward-slashed path, or null when nothing is selected. */
  path: string | null
  select: (path: string | null) => void
}

const SelectionContext = createContext<Selection | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }): ReactElement {
  const [path, setPath] = useState<string | null>(null)
  const value = useMemo<Selection>(() => ({ path, select: setPath }), [path])

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext)
  if (selection === null) throw new Error('useSelection was called outside the editor shell')
  return selection
}
