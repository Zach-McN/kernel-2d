import { DockviewReact, themeAbyss } from 'dockview-react'
import { useEffect } from 'react'
import type { ReactElement } from 'react'

import { StatusStrip } from './StatusStrip'
import { AssetMetaProvider } from './asset-meta-context'
import { PANEL_COMPONENTS, layOutPanels } from './panels'
import { ProjectProvider } from './project-context'
import { SelectionProvider } from './selection'
import { useSidecarStatus } from './useSidecarStatus'
import { useUndoShortcuts } from './useUndoShortcuts'
import { ViewportProvider } from './viewport-context'

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

  // Every provider sits outside the docking layout, because dockview mounts and
  // unmounts panel bodies as tabs move: anything held inside a panel would be
  // lost the first time the human dragged it somewhere else. For the renderer
  // that is not merely inconvenient — a Phaser game rebuilt on a tab drag means
  // a fresh WebGL context each time.
  //
  // The order is the dependency order: the folder, then what is selected in it,
  // then that file's settings, then the renderer showing them.
  return (
    <ProjectProvider>
      <SelectionProvider>
        <AssetMetaProvider>
          <ViewportProvider>
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
          </ViewportProvider>
        </AssetMetaProvider>
      </SelectionProvider>
    </ProjectProvider>
  )
}
