import type { ReactElement } from 'react'

import type { DrawnEntity, ShownScene } from '../../runtime'

/**
 * What is selected and where the floor is, drawn over the scene.
 *
 * Annotations *about* a scene rather than part of it — no shipped game outlines
 * the entity you happen to have clicked — so they belong to the editor rather
 * than the runtime, and drawing them in SVG keeps a line one pixel wide however
 * big the sprite is.
 *
 * Every number here came from the renderer's report of what it actually drew
 * (`runtime/scene/scene-view.ts`). Nothing on this side recomputes a position
 * from a transform: an outline that disagreed with the sprite it is outlining
 * would be worse than no outline, because its whole job is to say "this one".
 */

interface SceneOverlayProps {
  shown: ShownScene
  /** The selected entity's id, or null when the selection is not an entity. */
  selected: string | null
}

export function SceneOverlay({ shown, selected }: SceneOverlayProps): ReactElement {
  const entity = selected === null ? null : (shown.entities.find((one) => one.id === selected) ?? null)

  return (
    <svg className="scene__overlay" data-testid="scene-overlay" aria-hidden="true">
      <Origin at={shown.sceneOrigin} />
      {entity !== null && <Selected entity={entity} />}
    </svg>
  )
}

/**
 * The scene's own origin, marked in the corner it sits in.
 *
 * Worth two short lines of chrome because the coordinate convention is
 * otherwise invisible: y counts *upward* from here, so an entity at y=0 stands
 * on this line rather than at the top of the panel. There is no camera yet, so
 * this is also the only clue about where an entity that is off screen has gone.
 */
function Origin({ at }: { at: { x: number; y: number } }): ReactElement {
  return (
    <g className="scene__origin" data-testid="scene-origin" data-origin-x={at.x} data-origin-y={at.y}>
      <line x1={at.x} y1={at.y} x2={at.x + 28} y2={at.y} />
      <line x1={at.x} y1={at.y} x2={at.x} y2={at.y - 28} />
      <text x={at.x + 5} y={at.y - 6}>
        0,0
      </text>
    </g>
  )
}

/**
 * The selected entity: its outline, and a crosshair on its position.
 *
 * Both, because they answer different questions. The outline says which sprite
 * is selected; the crosshair says where the entity *is*, which is not the middle
 * of the outline whenever the texture's pivot says otherwise — a sprite pivoted
 * at its feet has its crosshair on the ground under it. That difference is the
 * whole of how a pivot is understood without reading a number.
 *
 * An entity with nothing to draw gets the crosshair alone. It is somewhere even
 * when it is nothing, and marking the spot beats leaving it unfindable.
 */
function Selected({ entity }: { entity: DrawnEntity }): ReactElement {
  return (
    <g className="scene__selected" data-testid="scene-selected" data-selected-entity={entity.id}>
      {entity.bounds !== null && (
        <rect
          className="scene__bounds"
          data-testid="scene-selected-bounds"
          x={entity.bounds.x}
          y={entity.bounds.y}
          width={entity.bounds.width}
          height={entity.bounds.height}
        />
      )}
      <g
        className="scene__handle"
        data-testid="scene-selected-origin"
        data-entity-x={entity.origin.x}
        data-entity-y={entity.origin.y}
      >
        <line x1={entity.origin.x - 7} y1={entity.origin.y} x2={entity.origin.x + 7} y2={entity.origin.y} />
        <line x1={entity.origin.x} y1={entity.origin.y - 7} x2={entity.origin.x} y2={entity.origin.y + 7} />
        <circle cx={entity.origin.x} cy={entity.origin.y} r={2.5} />
      </g>
    </g>
  )
}

/** What is on screen, in one line: how much of the scene was drawn. */
export function describeScene(shown: ShownScene, entityCount: number): string {
  if (entityCount === 0) return 'This scene is empty. Add an entity in the Hierarchy to put something in it.'

  const drawn = shown.entities.filter((entity) => entity.bounds !== null).length
  const nothing = entityCount - drawn

  const size = `${shown.canvasSize.width}×${shown.canvasSize.height}`
  const what =
    nothing === 0
      ? `${count(drawn, 'entity', 'entities')} drawn`
      : `${count(drawn, 'entity', 'entities')} drawn, ${nothing} with nothing to draw`

  return `${what} — 1:1 from the bottom-left corner, ${size}.`
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
