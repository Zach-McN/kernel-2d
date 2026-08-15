import { useEffect, useRef, useState, type ReactElement } from 'react'

import { useLayout } from './layout-context'
import { PANELS, type PanelId } from './panels'
import type { SidecarConnection } from './useSidecarStatus'

/**
 * The one line that answers "what am I connected to?" — the project's short
 * name, the full folder it resolved to, and whether the sidecar is answering.
 * The full path is spelled out rather than abbreviated because two projects
 * with the same folder name is an ordinary situation.
 *
 * It also carries the Windows menu: every panel tab has a close button, and
 * until this menu existed a closed panel was gone until the page was reloaded
 * (`editor-ui` UG4). The strip is the right home because it is the one piece of
 * the window that is not itself a panel — the menu has to live somewhere that
 * cannot be closed.
 */
export function StatusStrip({ connection }: { connection: SidecarConnection }): ReactElement {
  const connected = connection.state === 'connected' ? connection.status : null

  return (
    <header className="status-strip" data-testid="status-strip" data-connection={connection.state}>
      <span className="status-strip__brand">kernel-2d</span>

      <span className="status-strip__project" data-testid="status-project">
        {connected?.projectName ?? 'no project'}
      </span>

      <span className="status-strip__path" data-testid="status-path" title={connected?.projectPath ?? ''}>
        {connected?.projectPath ?? ''}
      </span>

      <WindowsMenu />

      <span className="status-strip__connection">
        <span className="status-strip__dot" aria-hidden="true" />
        <span data-testid="status-connection">{describe(connection)}</span>
      </span>
    </header>
  )
}

/**
 * Every panel the editor has, each a press away from being on screen.
 *
 * The list is `PANELS` itself — the file where panels are declared is the only
 * list of them there is (`editor-ui` U1), so a panel added there appears here
 * without anyone remembering to. A tick marks the ones already in the layout;
 * picking one of those brings its tab forward, and picking an unticked one
 * opens it as a tab in the current group, from where it drags anywhere.
 *
 * The open/close mechanics mirror the Assets panel's cog: Escape is handled on
 * the menu's own subtree and stopped, because the viewport owns Escape for
 * calling off a grab (`editor-ui` U33) and whichever thing is open should be
 * the one that hears it.
 */
function WindowsMenu(): ReactElement {
  const layout = useLayout()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPressElsewhere = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && box.current?.contains(target) === true) return
      setOpen(false)
    }

    window.addEventListener('pointerdown', onPressElsewhere)
    return () => {
      window.removeEventListener('pointerdown', onPressElsewhere)
    }
  }, [open])

  return (
    <div
      className="status-strip__windows"
      ref={box}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }}
    >
      <button
        type="button"
        className="windows__button"
        ref={button}
        data-testid="windows-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="The editor's panels — pick one to bring it back or bring it forward"
        onClick={() => {
          setOpen((was) => !was)
        }}
      >
        Windows
      </button>

      {open && (
        <div className="windows__menu" role="menu" data-testid="windows-menu">
          {(Object.keys(PANELS) as PanelId[]).map((id) => {
            const panel = PANELS[id]
            const isOpen = layout.isOpen(id)
            return (
              <button
                key={panel.id}
                type="button"
                className="windows__item"
                role="menuitem"
                data-testid={`windows-open-${panel.id}`}
                data-panel-open={isOpen}
                onClick={() => {
                  layout.summon(id)
                  setOpen(false)
                }}
              >
                <span className="windows__tick" aria-hidden="true">
                  {isOpen ? '✓' : ''}
                </span>
                <span className="windows__words">
                  <span className="windows__label">{panel.title}</span>
                  <span className="windows__blurb">{panel.blurb}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function describe(connection: SidecarConnection): string {
  switch (connection.state) {
    case 'connecting':
      return 'Looking for the sidecar…'
    case 'connected':
      return 'Connected'
    case 'unavailable':
      return connection.reason
  }
}
