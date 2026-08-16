import type { DockviewApi, IDockviewPanelProps } from 'dockview-react'
import type { FunctionComponent, ReactElement } from 'react'

import { AssetsPanel } from '../panels/AssetsPanel'
import { OutlinerPanel } from '../panels/OutlinerPanel'
import { InspectorPanel } from '../panels/InspectorPanel'
import { TexturePanel } from '../panels/TexturePanel'
import { ViewportPanel } from '../panels/ViewportPanel'
import { usePlayMode } from './play-mode'

/**
 * Every panel the editor has, declared once.
 *
 * A panel is added here and nowhere else: this file produces both the set of
 * components dockview renders and the layout they start in, so there is no
 * second list to keep in step.
 */

export interface PanelDefinition {
  /** Also the dockview component name, so the two can never drift apart. */
  id: string
  /** What the tab says. */
  title: string
  /** One line telling the human what lives here — the Windows menu shows it beside the name. */
  blurb: string
  /** The panel itself. */
  render: FunctionComponent
}

const VIEWPORT: PanelDefinition = {
  id: 'viewport',
  title: 'Viewport',
  blurb: 'The open scene, drawn by the real runtime. Play mode will run here too.',
  render: ViewportPanel,
}

/**
 * The second viewport-shaped panel, and the second live renderer in the window.
 *
 * It shares the Viewport's group rather than getting a corner of its own, so
 * selecting a texture swaps the tab in front and the scene keeps its place
 * behind it. The count of renderers is bounded by the number of entries in this
 * file, which is what keeps two of them from turning into a habit — see the note
 * at the top of `scene-view-context.tsx`.
 */
const TEXTURE: PanelDefinition = {
  id: 'texture',
  title: 'Texture',
  blurb: 'The selected texture on its own, with its frames and pivot marked.',
  render: TexturePanel,
}

const OUTLINER: PanelDefinition = {
  id: 'outliner',
  title: 'Outliner',
  blurb: 'Everything in the open scene, in the order it is drawn.',
  render: OutlinerPanel,
}

const INSPECTOR: PanelDefinition = {
  id: 'inspector',
  title: 'Inspector',
  blurb: 'The properties of whatever is selected, ready to tune.',
  render: InspectorPanel,
}

const ASSETS: PanelDefinition = {
  id: 'assets',
  title: 'Assets',
  blurb: 'Your project folder, mirrored exactly — textures, models, audio, and their import settings.',
  render: AssetsPanel,
}

export const PANELS = {
  viewport: VIEWPORT,
  texture: TEXTURE,
  outliner: OUTLINER,
  inspector: INSPECTOR,
  assets: ASSETS,
} as const

export type PanelId = keyof typeof PANELS

/**
 * Reopen a panel the window has lost — the Windows menu's half of UG4.
 *
 * The panel lands as a tab in the active group rather than at its original
 * spot: the spot may have been closed along with it, and a tab the human can
 * drag anywhere beats a guess about where it used to be. Lives here rather
 * than in the menu because this file is where panels are added, full stop
 * (`editor-ui` U1) — the menu asks, it does not know how.
 */
export function spawnPanel(api: DockviewApi, id: PanelId): void {
  const panel = PANELS[id]
  api.addPanel({ id: panel.id, component: panel.id, title: panel.title })
}

export const PANEL_COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = Object.fromEntries(
  Object.values(PANELS).map((panel) => [
    panel.id,
    panel.id === VIEWPORT.id ? panel.render : quietWhilePlaying(panel.render),
  ]),
)

/**
 * A panel that stops accepting input while a level is running.
 *
 * Everything except the Viewport, because everything except the Viewport is a
 * way to change a level — and a level that is running was read off disk, so a
 * change made now would go to the file, move nothing on screen, and leave the
 * human unable to tell which half was broken.
 *
 * `inert` rather than a `disabled` on each control: it covers the whole subtree
 * including anything a later session adds, and it takes the panel out of the
 * keyboard order too, which a pile of `disabled` attributes would each have to
 * remember. The wrapper is `display: contents`, so no box is added and nothing
 * about the docking layout changes.
 *
 * The store refuses an edit as well (`editor/store/open-documents.ts`). Two
 * mechanisms on purpose: this one is what the human *sees*, and that one is what
 * makes the guarantee hold whichever control anybody finds a way to reach. The
 * sentence explaining it is shown once, in the viewport, rather than four times
 * over.
 */
function quietWhilePlaying(Body: FunctionComponent): FunctionComponent {
  return function QuietWhilePlaying(): ReactElement {
    const { active } = usePlayMode()
    return (
      <div className="panel-host" inert={active} data-testid="panel-host">
        <Body />
      </div>
    )
  }
}

/**
 * The layout the editor opens in. The human can drag it into any other shape
 * from here; nothing is pinned.
 */
export function layOutPanels(api: DockviewApi): void {
  // Under React's development double-mount this can be reached twice. Adding
  // the same panels to an already-populated layout would stack duplicates.
  if (api.panels.length > 0) return

  api.addPanel({ id: PANELS.viewport.id, component: PANELS.viewport.id, title: PANELS.viewport.title })

  // Behind the Viewport in the same group, so selecting a texture brings it
  // forward and the scene is still there when the human clicks back.
  api.addPanel({
    id: PANELS.texture.id,
    component: PANELS.texture.id,
    title: PANELS.texture.title,
    position: { direction: 'within', referencePanel: PANELS.viewport.id },
  })

  api.addPanel({
    id: PANELS.outliner.id,
    component: PANELS.outliner.id,
    title: PANELS.outliner.title,
    position: { direction: 'left', referencePanel: PANELS.viewport.id },
    initialWidth: 240,
  })

  api.addPanel({
    id: PANELS.inspector.id,
    component: PANELS.inspector.id,
    title: PANELS.inspector.title,
    position: { direction: 'right', referencePanel: PANELS.viewport.id },
    initialWidth: 300,
  })

  api.addPanel({
    id: PANELS.assets.id,
    component: PANELS.assets.id,
    title: PANELS.assets.title,
    position: { direction: 'below', referencePanel: PANELS.viewport.id },
    // Tall enough for two rows of tiles under the controls: the icon view is a
    // grid, and a strip one row high is a list with pictures on it.
    initialHeight: 320,
  })

  api.getPanel(PANELS.viewport.id)?.focus()
}
