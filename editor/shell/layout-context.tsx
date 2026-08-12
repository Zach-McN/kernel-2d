import type { DockviewApi } from 'dockview-react'
import { createContext, useContext, useMemo, useRef, type ReactElement, type ReactNode } from 'react'

/**
 * A handle on the docking layout, for the one thing that has to reach it from
 * outside a panel: bringing a tab to the front.
 *
 * Held in a ref rather than in state, and read rather than subscribed to. The
 * layout is not something anything renders from — nothing on screen depends on
 * *which* tab is in front except the layout itself — so putting it in state
 * would re-render every panel in the window when it arrived, for no one's
 * benefit.
 *
 * `bringToFront` is deliberately forgiving: a panel that has been closed is not
 * there to focus, and there is nowhere to reopen it from yet (`editor-ui` UG4).
 * Doing nothing is the right answer until the panel menu lands — quietly failing
 * to focus a tab the human closed is far better than an error about it.
 */

interface Layout {
  attach: (api: DockviewApi) => void
  bringToFront: (panelId: string) => void
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
