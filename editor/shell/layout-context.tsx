import type { DockviewApi } from 'dockview-react'
import { createContext, useContext, useMemo, useRef, type ReactElement, type ReactNode } from 'react'

import { spawnPanel, PANELS, type PanelId } from './panels'

/**
 * A handle on the docking layout, for the things that have to reach it from
 * outside a panel: bringing a tab to the front, and giving back a panel the
 * human closed.
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
 */

interface Layout {
  attach: (api: DockviewApi) => void
  bringToFront: (panelId: string) => void
  /** Whether this panel is in the layout right now. */
  isOpen: (panelId: PanelId) => boolean
  /** The Windows menu's verb: focus the panel, reopening it first if it is gone. */
  summon: (panelId: PanelId) => void
}

const LayoutContext = createContext<Layout | null>(null)

export function LayoutProvider({ children }: { children: ReactNode }): ReactElement {
  const api = useRef<DockviewApi | null>(null)

  const value = useMemo<Layout>(
    () => ({
      attach: (attached) => {
        api.current = attached
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
    }),
    [],
  )

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

export function useLayout(): Layout {
  const layout = useContext(LayoutContext)
  if (layout === null) throw new Error('useLayout was called outside the editor shell')
  return layout
}
