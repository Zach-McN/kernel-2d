import type { DockviewApi, IDockviewPanelProps } from 'dockview-react'
import type { FunctionComponent, ReactElement } from 'react'

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
}

export const PANELS = {
  viewport: {
    id: 'viewport',
    title: 'Viewport',
    blurb: 'The game itself, drawn by the real runtime. Scenes open here, and play mode runs here.',
  },
  hierarchy: {
    id: 'hierarchy',
    title: 'Hierarchy',
    blurb: 'Everything in the open scene, as a tree you can select, reorder, and nest.',
  },
  inspector: {
    id: 'inspector',
    title: 'Inspector',
    blurb: 'The properties of whatever is selected, ready to tune.',
  },
  assets: {
    id: 'assets',
    title: 'Assets',
    blurb: 'Your project folder, mirrored exactly — textures, models, audio, and their import settings.',
  },
} as const satisfies Record<string, PanelDefinition>

export const PANEL_COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = Object.fromEntries(
  Object.values(PANELS).map((panel) => [panel.id, () => <PanelPlaceholder panel={panel} />]),
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
