import type { DockviewApi, IDockviewPanelProps } from 'dockview-react'
import type { FunctionComponent, ReactElement } from 'react'

import { AssetsPanel } from '../panels/AssetsPanel'
import { HierarchyPanel } from '../panels/HierarchyPanel'
import { InspectorPanel } from '../panels/InspectorPanel'
import { TexturePanel } from '../panels/TexturePanel'
import { ViewportPanel } from '../panels/ViewportPanel'

/**
 * Every panel the editor has, declared once.
 *
 * A panel is added here and nowhere else: this file produces both the set of
 * components dockview renders and the layout they start in, so there is no
 * second list to keep in step. Panels are empty placeholders until the session
 * that builds each one replaces its component.
 */

export interface PanelDefinition {
  /** Also the dockview component name, so the two can never drift apart. */
  id: string
  /** What the tab says. */
  title: string
  /** One line telling the human what will live here. */
  blurb: string
  /** The panel itself. Panels not built yet show their blurb instead. */
  render?: FunctionComponent
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

const HIERARCHY: PanelDefinition = {
  id: 'hierarchy',
  title: 'Hierarchy',
  blurb: 'Everything in the open scene, in the order it is drawn.',
  render: HierarchyPanel,
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
  hierarchy: HIERARCHY,
  inspector: INSPECTOR,
  assets: ASSETS,
} as const

export const PANEL_COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = Object.fromEntries(
  Object.values(PANELS).map((panel) => [panel.id, panel.render ?? (() => <PanelPlaceholder panel={panel} />)]),
)

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
    id: PANELS.hierarchy.id,
    component: PANELS.hierarchy.id,
    title: PANELS.hierarchy.title,
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
    initialHeight: 220,
  })

  api.getPanel(PANELS.viewport.id)?.focus()
}

function PanelPlaceholder({ panel }: { panel: PanelDefinition }): ReactElement {
  return (
    <section className="panel-placeholder" data-panel={panel.id}>
      <h2 className="panel-placeholder__title">{panel.title}</h2>
      <p className="panel-placeholder__blurb">{panel.blurb}</p>
      <p className="panel-placeholder__note">Empty for now.</p>
    </section>
  )
}
