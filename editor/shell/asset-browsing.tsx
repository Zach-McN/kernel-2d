import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'

import { movedPath } from './references'

/**
 * How the human is *browsing* the project folder: which of the three views the
 * Assets panel is wearing, which folder the icon grid is inside, and which
 * folders the tree has open.
 *
 * **None of it is in the document.** It sits beside selection, the camera and
 * the placing settings (`editor-ui` U8, U19, U31): held for the life of the
 * window, never serialized, never in a transaction, invisible to Ctrl-Z. A
 * reload puts it back to the tree with everything shut, which is exactly how the
 * panel behaved before any of this existed.
 *
 * **Above the docking layout rather than inside the panel**, for the reason
 * every other piece of window state is (`editor-ui` U9): dockview unmounts a
 * panel's body when its tab is dragged, so a view the human chose — and the
 * folder they had navigated three levels into — would be thrown away by moving
 * the panel. It is also what lets `useFileMoves` reach in and follow a rename.
 *
 * **Which folder the grid is in and which folders the tree has open are two
 * pieces of state, not one.** The tree can have six folders open at once; the
 * grid is inside exactly one. Deriving either from the other would mean walking
 * into a folder in the grid closed five others in the tree, or that opening a
 * second folder in the tree moved the grid somewhere nobody asked it to go. What
 * they do share is a direction: entering a folder in the grid opens the way to
 * it in the tree, so the two halves of the split view agree about where you are.
 */

export type AssetView = 'list' | 'icons' | 'split'

export interface AssetBrowsing {
  /** Which view the panel is wearing. */
  view: AssetView
  setView: (view: AssetView) => void

  /**
   * The folder the icon grid is showing. `''` is the top of the project — the
   * same spelling `parentOf` uses, and deliberately not the tree root's own `.`.
   */
  folder: string
  /** Show this folder in the grid, and open the way down to it in the tree. */
  openFolder: (path: string) => void

  /** Which folders the tree has open. */
  expanded: ReadonlySet<string>
  toggleFolder: (path: string) => void
  /** Open this folder in the tree, whatever state it was in. */
  expandFolder: (path: string) => void
  /** Open every folder on the way down to this path, but not the path itself. */
  revealParents: (path: string) => void

  /**
   * Something was renamed or moved: carry the browsing state with it.
   *
   * `editor-ui` U30 — the folder the grid is in is state keyed on a path, and so
   * is every entry in the open set. Without this, renaming the folder you are
   * standing in leaves the grid looking at somewhere that is not there any more.
   */
  pathMoved: (from: string, to: string) => void
}

const AssetBrowsingContext = createContext<AssetBrowsing | null>(null)

export function AssetBrowsingProvider({ children }: { children: ReactNode }): ReactElement {
  const [view, setView] = useState<AssetView>('list')
  const [folder, setFolder] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const revealParents = useCallback((path: string) => {
    // Every folder on the way, so something reached inside a shut folder is not
    // reached somewhere the human cannot see it.
    const parts = path.split('/').slice(0, -1)
    setExpanded((previous) => {
      const next = new Set(previous)
      let at = ''
      for (const part of parts) {
        at = at === '' ? part : `${at}/${part}`
        next.add(at)
      }
      return next
    })
  }, [])

  const expandFolder = useCallback((path: string) => {
    setExpanded((previous) => new Set(previous).add(path))
  }, [])

  const toggleFolder = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }, [])

  const openFolder = useCallback(
    (path: string) => {
      setFolder(path)
      revealParents(path)
    },
    [revealParents],
  )

  const pathMoved = useCallback((from: string, to: string) => {
    setFolder((previous) => movedPath(previous, from, to) ?? previous)
    setExpanded((previous) => new Set([...previous].map((path) => movedPath(path, from, to) ?? path)))
  }, [])

  const value = useMemo<AssetBrowsing>(
    () => ({
      view,
      setView,
      folder,
      openFolder,
      expanded,
      toggleFolder,
      expandFolder,
      revealParents,
      pathMoved,
    }),
    [view, folder, openFolder, expanded, toggleFolder, expandFolder, revealParents, pathMoved],
  )

  return <AssetBrowsingContext.Provider value={value}>{children}</AssetBrowsingContext.Provider>
}

export function useAssetBrowsing(): AssetBrowsing {
  const browsing = useContext(AssetBrowsingContext)
  if (browsing === null) throw new Error('useAssetBrowsing was called outside the editor shell')
  return browsing
}

/** Whether this view puts the tree on screen. */
export function showsTree(view: AssetView): boolean {
  return view !== 'icons'
}

/** Whether this view puts the icon grid on screen. */
export function showsGrid(view: AssetView): boolean {
  return view !== 'list'
}
