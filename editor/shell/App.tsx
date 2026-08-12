import { DockviewReact, themeAbyss } from 'dockview-react'
import { useEffect } from 'react'
import type { ReactElement } from 'react'

import { StatusStrip } from './StatusStrip'
import { PANEL_COMPONENTS, layOutPanels } from './panels'
import { ProjectProvider } from './project-context'
import { SelectionProvider } from './selection'
import { useSidecarStatus } from './useSidecarStatus'
import { useUndoShortcuts } from './useUndoShortcuts'

/**
 * The editor shell: a status strip that names the connected project, and the
 * docking layout everything else will be built inside.
 */
export function App(): ReactElement {
  const connection = useSidecarStatus()

  // Undo belongs to the window, not to any panel: one stack for the whole
  // project means Ctrl-Z has to mean the same thing wherever the cursor is.
  useUndoShortcuts()

  // The window title is the other place the human looks to tell two open
  // projects apart.
  useEffect(() => {
    document.title =
      connection.state === 'connected' ? `${connection.status.projectName} — kernel-2d` : 'kernel-2d editor'
  }, [connection])

  // Both providers sit outside the docking layout, because dockview mounts and
  // unmounts panel bodies as tabs move: state held inside a panel would be lost
  // the first time the human dragged it somewhere else.
  return (
    <ProjectProvider>
      <SelectionProvider>
        <div className="editor-shell">
          <StatusStrip connection={connection} />
          <main className="editor-shell__panels">
            <DockviewReact
              components={PANEL_COMPONENTS}
              theme={themeAbyss}
              onReady={(event) => layOutPanels(event.api)}
            />
          </main>
        </div>
      </SelectionProvider>
    </ProjectProvider>
  )
}
