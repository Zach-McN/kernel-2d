import type { DockviewApi } from 'dockview-react'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react'

import { useAssetBrowsing } from './asset-browsing'
import { forgetLayout, lastProject, readLayout, rememberProject, writeLayout } from './layout-store'
import { spawnPanel, layOutPanels, PANELS, type PanelId } from './panels'
import { useProject } from './project-context'

/**
 * A handle on the docking layout, for the things that have to reach it from
 * outside a panel: bringing a tab to the front, giving back a panel the human
 * closed, and putting the arrangement back the way it was.
 *
 * Held in a ref rather than in state, and read rather than subscribed to. The
 * layout is not something anything renders from — nothing on screen depends on
 * *which* tab is in front except the layout itself — so putting it in state
 * would re-render every panel in the window when it arrived, for no one's
 * benefit. The Windows menu reads `isOpen` at the moment it opens, which is the
 * only moment its answer is looked at.
 *
 * `bringToFront` is deliberately forgiving: a panel that has been closed is not
 * there to focus, and quietly failing to focus it is better than an error. It
 * stays that way even now the Windows menu exists — a *selection* wanting a tab
 * is not the human asking for a closed panel back, and respawning one because
 * something was clicked would be the layout changing itself unasked.
 *
 * **The arrangement is remembered per project** (`layout-store.ts`). Every
 * change the library reports is written a moment later, and a reload starts
 * from the last project's saved shape rather than the default — then, if the
 * service names a different project, from that one's. A saved shape the library
 * cannot load falls back to the default, quietly. `reset` is the Windows menu's
 * *Reset layout*: the default arrangement, the Assets panel back to its own
 * defaults, and the record forgotten.
 */

interface Layout {
  attach: (api: DockviewApi) => void
  bringToFront: (panelId: string) => void
  /** Whether this panel is in the layout right now. */
  isOpen: (panelId: PanelId) => boolean
  /** The Windows menu's verb: focus the panel, reopening it first if it is gone. */
  summon: (panelId: PanelId) => void
  /** Back to the default arrangement, and forget the saved one. */
  reset: () => void
}

/** How long the layout sits still before it is written. A drag reports many changes. */
const SAVE_AFTER_MS = 300

const LayoutContext = createContext<Layout | null>(null)

export function LayoutProvider({ children }: { children: ReactNode }): ReactElement {
  const api = useRef<DockviewApi | null>(null)
  const project = useProject()
  const browsing = useAssetBrowsing()
  const projectPath = project.state === 'ready' ? project.tree.projectPath : null

  // Which project's layout the dock is currently showing. Starts as the last
  // one saved, which is what `attach` restores; corrected when the service
  // says which project this really is.
  const showing = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const projectRef = useRef<string | null>(null)
  projectRef.current = projectPath

  /** Puts a saved layout on the dock, or the default when there is none usable. */
  const restore = (attached: DockviewApi, forProject: string | null): void => {
    const saved = forProject === null ? null : readLayout(forProject)?.dock
    if (saved !== undefined && saved !== null) {
      try {
        attached.fromJSON(saved as Parameters<DockviewApi['fromJSON']>[0])
        showing.current = forProject
        return
      } catch {
        // A shape the library no longer understands: not an error, a default.
        attached.clear()
      }
    }
    if (attached.panels.length > 0) attached.clear()
    layOutPanels(attached)
    // The default is showing, and it belongs to nobody in particular: null, so
    // the project arriving with nothing saved does not lay it out again.
    showing.current = null
  }

  const save = (): void => {
    const attached = api.current
    const forProject = projectRef.current
    if (attached === null || forProject === null) return
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      writeLayout(forProject, { dock: attached.toJSON() })
    }, SAVE_AFTER_MS)
  }

  // The service has said which project this is: if the dock is showing some
  // other project's shape (or the default because nothing was known), swap to
  // this project's. Same project — the common case after a reload — changes
  // nothing.
  useEffect(() => {
    const attached = api.current
    if (projectPath === null || attached === null) return
    rememberProject(projectPath)
    if (showing.current === projectPath) return
    // Nothing saved for this project and the default already on screen: leave
    // it — laying the default out a second time unmounts every panel for a
    // frame, which reads as a flash and measures as a panel that is not there.
    const saved = readLayout(projectPath)?.dock
    if (showing.current === null && (saved === undefined || saved === null)) {
      showing.current = projectPath
      return
    }
    restore(attached, projectPath)
  }, [projectPath])

  const value = useMemo<Layout>(
    () => ({
      attach: (attached) => {
        api.current = attached
        restore(attached, projectRef.current ?? lastProject())
        attached.onDidLayoutChange(save)
      },
      bringToFront: (panelId) => {
        const panel = api.current?.getPanel(panelId)
        if (panel === undefined) return
        // Already in front: focusing again would steal the cursor out of
        // whatever the human is typing in.
        if (panel.api.isActive) return
        panel.api.setActive()
      },
      isOpen: (panelId) => api.current?.getPanel(PANELS[panelId].id) !== undefined,
      summon: (panelId) => {
        const attached = api.current
        if (attached === null) return
        const existing = attached.getPanel(PANELS[panelId].id)
        if (existing !== undefined) {
          // Asked for by name, so focusing is the point — unlike bringToFront,
          // where it could steal the cursor from a field mid-word.
          existing.api.setActive()
          return
        }
        spawnPanel(attached, panelId)
      },
      reset: () => {
        const attached = api.current
        const forProject = projectRef.current
        if (forProject !== null) forgetLayout(forProject)
        if (attached !== null) {
          attached.clear()
          layOutPanels(attached)
        }
        browsing.resetBrowsing()
      },
    }),
    // `browsing.resetBrowsing` is stable; the rest reads refs.
    [browsing.resetBrowsing],
  )

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

export function useLayout(): Layout {
  const layout = useContext(LayoutContext)
  if (layout === null) throw new Error('useLayout was called outside the editor shell')
  return layout
}
