import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { findNode } from './asset-kinds'
import { readLayout, writeLayout } from './layout-store'
import { useProject } from './project-context'

import { movedPath } from './references'

/**
 * How the human is *browsing* the project folder: which of the three views the
 * Assets panel is wearing, which folder the icon grid is inside, and which
 * folders the tree has open.
 *
 * **None of it is in the document.** It sits beside selection, the camera and
 * the placing settings (`editor-ui` U8, U19, U31): held for the life of the
 * window, never serialized, never in a transaction, invisible to Ctrl-Z. A
 * reload puts it back to the icon view, at the top of the project, with the
 * tree shut.
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
 *
 * **Where the grid is, is a trail rather than a folder.** The mouse's back and
 * forward buttons hop along it, so it has to answer the same questions a
 * browser's does: where you have been, where you were before you came back, and
 * — the one that decides the shape — what happens when you go somewhere new
 * after stepping back. Everything ahead of you is dropped, because a trail that
 * kept it would offer a *forward* into a folder you have since changed your mind
 * about, which is not a place you were on the way to.
 *
 * A parent is not a step back. Going up from `assets/textures` lands on
 * `assets`, and stepping back from it lands wherever you were before — which is
 * frequently somewhere else entirely, and is the whole reason the trail exists
 * rather than a call to `parentOf`.
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

  /** Whether there is anywhere to step back to, or forward to. */
  canGoBack: boolean
  canGoForward: boolean
  /** One step along the trail. Both do nothing at the end they are at. */
  goBack: () => void
  goForward: () => void

  /**
   * How much of the split view's width the tree gets, as a fraction.
   *
   * Kept as a fraction rather than as pixels, so dragging the panel wider keeps
   * the proportion the human chose rather than leaving the tree at whatever
   * number of pixels it happened to be.
   */
  splitFraction: number
  setSplitFraction: (fraction: number) => void

  /** Which folders the tree has open. */
  expanded: ReadonlySet<string>
  toggleFolder: (path: string) => void
  /** Open this folder in the tree, whatever state it was in. */
  expandFolder: (path: string) => void
  /** Open every folder on the way down to this path, but not the path itself. */
  revealParents: (path: string) => void

  /**
   * What is typed in the search box. While it says anything, the panel lists
   * every file in the project whose name matches instead of the folder view —
   * whichever view is chosen, because a search is a question about the whole
   * project and no one folder can answer it. Held here rather than in the
   * panel for the reason everything else here is: dragging the panel to a new
   * spot must not lose what was typed.
   */
  search: string
  setSearch: (query: string) => void

  /** Reset layout: the icon view, at the top of the project, with no search. */
  resetBrowsing: () => void

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

/** Where the tree's edge sits when nobody has moved it, and how far it may go. */
export const SPLIT_DEFAULT = 0.4
const SPLIT_NARROWEST = 0.12
const SPLIT_WIDEST = 0.8

/** Every folder visited, and which of them is on screen. */
interface Trail {
  folders: readonly string[]
  at: number
}

export function AssetBrowsingProvider({ children }: { children: ReactNode }): ReactElement {
  // Icons rather than the tree: the tiles are the view a human parses fastest,
  // and the tree is one cog press away for whoever wants the whole shape.
  const [view, setView] = useState<AssetView>('icons')
  const [trail, setTrail] = useState<Trail>({ folders: [''], at: 0 })
  const [splitFraction, setSplit] = useState(SPLIT_DEFAULT)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  // Not remembered per project (`layout-store.ts`): a search is what somebody
  // is doing right now, not how they like to see the folder.
  const [search, setSearch] = useState('')

  const folder = trail.folders[trail.at] ?? ''

  const project = useProject()
  const projectPath = project.state === 'ready' ? project.tree.projectPath : null
  const tree = project.state === 'ready' ? project.tree : null
  // Which project's remembered view and folder are on screen — restored once
  // per project, and written back whenever either changes after that. The
  // view and the folder only: the split, the open tree folders and the trail
  // are not remembered (`layout-store.ts`).
  const [restoredFor, setRestoredFor] = useState<string | null>(null)

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
      setTrail((previous) => {
        // Going where you already are is not a step, and recording it would put
        // a stutter in the trail that takes two presses of Back to get out of.
        if ((previous.folders[previous.at] ?? '') === path) return previous
        // Everything ahead is dropped: it was the way to somewhere you have
        // since changed your mind about, and offering Forward into it would be
        // offering a place you were never on the way to.
        const folders = [...previous.folders.slice(0, previous.at + 1), path]
        return { folders, at: folders.length - 1 }
      })
      revealParents(path)
    },
    [revealParents],
  )

  /**
   * One step along the trail, opening the way down to wherever it lands.
   *
   * Reads the trail rather than taking it from an updater, because it has a
   * second thing to do with the answer. A `setState` updater runs during a
   * render, so setting the open folders from inside one would be changing state
   * while rendering — legal-looking, and the shape React warns about.
   */
  const step = useCallback(
    (by: 1 | -1) => {
      const at = trail.at + by
      if (at < 0 || at >= trail.folders.length) return
      setTrail({ ...trail, at })
      revealParents(trail.folders[at] ?? '')
    },
    [trail, revealParents],
  )

  const goBack = useCallback(() => step(-1), [step])
  const goForward = useCallback(() => step(1), [step])

  const setSplitFraction = useCallback((fraction: number) => {
    // Clamped here rather than at the handle, so no caller can leave a pane the
    // human cannot get hold of again.
    setSplit(Math.min(SPLIT_WIDEST, Math.max(SPLIT_NARROWEST, fraction)))
  }, [])

  // The project is known: put back what this browser remembered for it. The
  // folder is only entered if it is still there — a folder deleted since is
  // the top of the project, not an empty grid claiming to be somewhere.
  useEffect(() => {
    if (projectPath === null || tree === null || restoredFor === projectPath) return
    // State rather than a ref, so the writer below only starts once the
    // restored values have been rendered — never over them.
    setRestoredFor(projectPath)
    const remembered = readLayout(projectPath)?.assets
    if (remembered === undefined) return
    setView(remembered.view)
    const there = remembered.folder === '' || findNode(tree, remembered.folder)?.kind === 'directory'
    if (there) openFolder(remembered.folder)
  }, [projectPath, tree, openFolder, restoredFor])

  // Written after the restore, and only for the project it was restored for —
  // so a reload cannot write the defaults over what it was about to read.
  useEffect(() => {
    if (projectPath === null || restoredFor !== projectPath) return
    writeLayout(projectPath, { assets: { view, folder } })
  }, [projectPath, restoredFor, view, folder])

  const resetBrowsing = useCallback(() => {
    setView('icons')
    setTrail({ folders: [''], at: 0 })
    setSearch('')
  }, [])

  const pathMoved = useCallback((from: string, to: string) => {
    // Every folder on the trail, not only the one on screen: stepping back into
    // a folder under its old name would land on nothing.
    setTrail((previous) => ({
      ...previous,
      folders: previous.folders.map((path) => movedPath(path, from, to) ?? path),
    }))
    setExpanded((previous) => new Set([...previous].map((path) => movedPath(path, from, to) ?? path)))
  }, [])

  const value = useMemo<AssetBrowsing>(
    () => ({
      view,
      setView,
      folder,
      openFolder,
      canGoBack: trail.at > 0,
      canGoForward: trail.at < trail.folders.length - 1,
      goBack,
      goForward,
      splitFraction,
      setSplitFraction,
      expanded,
      toggleFolder,
      expandFolder,
      revealParents,
      search,
      setSearch,
      resetBrowsing,
      pathMoved,
    }),
    [
      view,
      folder,
      openFolder,
      trail,
      goBack,
      goForward,
      splitFraction,
      setSplitFraction,
      expanded,
      toggleFolder,
      expandFolder,
      revealParents,
      search,
      resetBrowsing,
      pathMoved,
    ],
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
