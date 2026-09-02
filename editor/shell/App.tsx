import { DockviewReact, themeAbyssSpaced } from 'dockview-react'
import { useEffect } from 'react'
import type { ReactElement } from 'react'

import { StatusStrip } from './StatusStrip'
import { AssetBrowsingProvider } from './asset-browsing'
import { AssetMetaProvider } from './asset-meta-context'
import { ComponentTypesProvider } from './component-types'
import { EntityPopoverProvider } from './entity-popover'
import { OutlinerFilterProvider } from './outliner-filter'
import { LayoutProvider, useLayout } from './layout-context'
import { OpenSceneProvider } from './open-scene'
import { PANEL_COMPONENTS } from './panels'
import { PlacingProvider } from './placing'
import { PlayModeProvider } from './play-mode'
import { ProjectProvider } from './project-context'
import { SceneAssetsProvider } from './scene-assets'
import { ScenePrefabsProvider } from './scene-prefabs'
import { SceneViewProvider } from './scene-view-context'
import { SelectionProvider } from './selection'
import { ThumbnailProvider } from './thumbnails'
import { useSidecarStatus, type SidecarConnection } from './useSidecarStatus'
import { useSelectionFocus } from './useSelectionFocus'
import { useUndoShortcuts } from './useUndoShortcuts'
import { ViewportProvider } from './viewport-context'

/**
 * The editor shell: a status strip that names the connected project, and the
 * docking layout everything else is built inside.
 *
 * Every provider sits outside the docking layout, because dockview mounts and
 * unmounts panel bodies as tabs move: anything held inside a panel would be lost
 * the first time the human dragged it somewhere else. For the two renderers that
 * is not merely inconvenient — a Phaser game rebuilt on a tab drag means a fresh
 * WebGL context each time.
 *
 * The order is the dependency order: the folder, then what this game's own
 * components are, then what is selected in it, then that file's settings and the
 * scene it may have opened, then what that scene's instances inherit, then the
 * textures all of that turns out to need, then the two renderers, then play
 * mode, then the layout handle that lets a selection bring a tab forward.
 *
 * The game's component vocabulary is second because it depends on the folder and
 * on nothing else — it is a listing of `components/`, not a thing any selection
 * or level names — and because the Inspector needs it whatever is selected.
 *
 * Play mode is below the scene renderer because starting a level needs the
 * picture the editing view is showing at that instant — that report is what the
 * running level gets checked against — and above the layout because a running
 * level puts every other panel out of reach.
 *
 * Prefabs sit *above* textures deliberately: an instance's picture is named by
 * its prefab, so which textures a level needs cannot be known until every prefab
 * it points at has been read.
 *
 * How a press in the picture places things sits next to selection and depends on
 * nothing, for the same reason selection does not: it is a fact about this
 * window rather than about anything on disk. How the Assets panel is *being
 * looked through* — which of its three views, and which folder — is the same
 * kind of fact and sits in the same place.
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

  return (
    <ProjectProvider>
      <ComponentTypesProvider>
        <SelectionProvider>
          <EntityPopoverProvider>
            <PlacingProvider>
              <OutlinerFilterProvider>
              <AssetBrowsingProvider>
                <ThumbnailProvider>
                  <AssetMetaProvider>
                    <OpenSceneProvider>
                      <ScenePrefabsProvider>
                        <SceneAssetsProvider>
                          <ViewportProvider>
                            <SceneViewProvider>
                              <PlayModeProvider>
                                <LayoutProvider>
                                  <Shell connection={connection} />
                                </LayoutProvider>
                              </PlayModeProvider>
                            </SceneViewProvider>
                          </ViewportProvider>
                        </SceneAssetsProvider>
                      </ScenePrefabsProvider>
                    </OpenSceneProvider>
                  </AssetMetaProvider>
                </ThumbnailProvider>
              </AssetBrowsingProvider>
              </OutlinerFilterProvider>
            </PlacingProvider>
          </EntityPopoverProvider>
        </SelectionProvider>
      </ComponentTypesProvider>
    </ProjectProvider>
  )
}

/**
 * The window itself, inside every provider.
 *
 * Separate from `App` only so that the handful of things which need both a
 * provider and the layout — bringing the right tab forward for whatever was
 * just clicked — have somewhere to be called from.
 */
function Shell({ connection }: { connection: SidecarConnection }): ReactElement {
  const layout = useLayout()
  useSelectionFocus()

  return (
    <div className="editor-shell">
      <StatusStrip connection={connection} />
      <main className="editor-shell__panels">
        <DockviewReact
          components={PANEL_COMPONENTS}
          /*
           * The spaced variant, for its *structure*: it is the one that gives
           * each group rounded corners and a gap around it, and that puts the
           * tabs inside the group they belong to rather than on a strip above
           * the whole layout. Its colours are all redefined in `shell.css`.
           */
          theme={themeAbyssSpaced}
          // Attaching restores the remembered arrangement, or lays out the
          // default (`layout-context.tsx`).
          onReady={(event) => {
            layout.attach(event.api)
          }}
        />
      </main>
    </div>
  )
}
