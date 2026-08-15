import { useId, type ReactElement } from 'react'

import type { DrawnEntity, ShownScene } from '../../runtime'
import type { DrawnGrid } from '../shell/grid'
import type { Scale, Turn } from '../shell/useSceneGestures'
import { describeZoom } from '../shell/zoom'

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
  /**
   * The grid to draw under everything, or null when there is none to draw —
   * which is snapping being off, or its cells being too small to read
   * (`../shell/grid.ts`).
   */
  grid: DrawnGrid | null
  /**
   * Every selected entity, in the order they were selected — so the last one is
   * the primary one, the one `F` frames and `G` grabs. Empty when the selection
   * is not an entity.
   */
  selected: readonly string[]
  /** The axis a grab is held to, or null when nothing is being held to one. */
  axis: 'x' | 'y' | null
  /** The turn in progress, or null. Everything it needs is already in pixels. */
  turning: Turn | null
  /** The scale in progress, or null. Same again, one gesture over. */
  scaling: Scale | null
}

/**
 * Every selected entity is outlined; the last one is outlined *and* crosshaired.
 *
 * The difference is not decoration. With six selected, exactly one of them is
 * what the Inspector is describing and what the next `G` will move, and an
 * overlay that drew all six identically would leave the human to find that out
 * by pressing something. The primary mark is the mark a single selection has
 * always had, so nothing changed for the commonest case.
 *
 * The list is walked rather than the scene, so an id that has gone — deleted
 * between the report and this render — simply draws nothing.
 */
export function SceneOverlay({
  shown,
  grid,
  selected,
  axis,
  turning,
  scaling,
}: SceneOverlayProps): ReactElement {
  const drawn = selected
    .map((id) => shown.entities.find((one) => one.id === id) ?? null)
    .filter((one): one is DrawnEntity => one !== null)
  const primary = drawn.at(-1) ?? null

  return (
    <svg className="scene__overlay" data-testid="scene-overlay" aria-hidden="true">
      {/* First, so everything else in the level and every mark about it is on
          top of the floor rather than behind it. */}
      {grid !== null && <Grid grid={grid} />}
      <Origin at={shown.sceneOrigin} />
      {primary !== null && axis !== null && <Axis at={primary.origin} axis={axis} />}
      {drawn.map((entity) => (
        <Selected key={entity.id} entity={entity} primary={entity === primary} />
      ))}
      {turning !== null && <Turning turn={turning} />}
      {scaling !== null && <Scaling scale={scaling} />}
    </svg>
  )
}

/**
 * The grid the snap lands things on, drawn.
 *
 * **One tile repeated, rather than a line per cell.** A tiled pattern is a
 * single element whichever way the camera moves, where a panel-wide grid of
 * six-pixel cells is several hundred `<line>`s that React would rebuild on every
 * frame of a pan — the kind of jank that makes a viewport feel like a web page.
 * The cost of the choice is that the lines cannot be counted from the outside,
 * so what the grid *is* is published as numbers on the group instead.
 *
 * The tile's own lines are drawn a half-pixel inside it rather than on its edge.
 * A pattern clips its contents to the tile, so a stroke centred on the boundary
 * would lose half its width and come out fainter than the same line drawn
 * anywhere else — the sort of difference that reads as the grid fading at
 * certain zooms.
 *
 * The pattern's id is per-instance rather than a constant. Two viewports are not
 * something the layout offers today, and an id collision between them would not
 * fail loudly: the second overlay would quietly paint the first one's spacing.
 */
function Grid({ grid }: { grid: DrawnGrid }): ReactElement {
  // Sanitized, because a React id is decorated with characters that a URL
  // reference inside `fill` cannot carry.
  const pattern = `scene-grid-${useId().replaceAll(/[^\w-]/g, '')}`

  return (
    <g
      className="scene__grid"
      data-testid="scene-grid"
      // What is being drawn, in both units: the level's, which is the number in
      // the interval field, and the screen's, which is what decides whether it
      // is drawn at all.
      data-grid-step={grid.step}
      data-grid-cell={grid.cell}
    >
      <defs>
        <pattern
          id={pattern}
          patternUnits="userSpaceOnUse"
          x={grid.from.x}
          y={grid.from.y}
          width={grid.cell}
          height={grid.cell}
        >
          <path d={`M 0.5 0 V ${grid.cell} M 0 0.5 H ${grid.cell}`} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${pattern})`} />
    </g>
  )
}

/**
 * The scale gizmo: the same ring, line and pivot the turn draws, with the arc
 * replaced by a **second mark on the line** showing the reach the gesture
 * started from.
 *
 * That mark is the arc's job done for a different number. A line that simply
 * follows the cursor says nothing about *how much bigger* — there is no wedge to
 * fill, because the pointer never sweeps anywhere — so the one thing on screen
 * that makes the factor legible is being able to see the distance now against
 * the distance then. It is also what makes a snapped scale read as steps rather
 * than as a laggy mouse, which is the argument the arc makes one gesture over.
 *
 * Drawn from the numbers the gesture used and never a second derivation of them,
 * the standing rule of this file.
 */
function Scaling({ scale }: { scale: Scale }): ReactElement {
  const reach = Math.hypot(scale.at.x - scale.pivot.x, scale.at.y - scale.pivot.y)
  // Where the pointer started, put back on the line the pointer is on now — so
  // the two marks are comparable along one direction rather than being a pair of
  // points somewhere. At zero reach there is no direction to place it along, and
  // the mark sits on the pivot, which is exactly where it belongs.
  const along = reach === 0 ? 0 : scale.from / reach
  const started = {
    x: scale.pivot.x + (scale.at.x - scale.pivot.x) * along,
    y: scale.pivot.y + (scale.at.y - scale.pivot.y) * along,
  }

  return (
    <g
      className="scene__turn scene__scale"
      data-testid="scene-scaling"
      data-scale-x={scale.factor.x}
      data-scale-y={scale.factor.y}
    >
      <line
        className="scene__turn-line"
        x1={scale.pivot.x}
        y1={scale.pivot.y}
        x2={scale.at.x}
        y2={scale.at.y}
      />
      {/* The reach it started at: a tick across the line, so growing and
          shrinking are told apart by which side of it the cursor is on. */}
      <circle
        className="scene__scale-from"
        data-testid="scene-scaling-from"
        cx={started.x}
        cy={started.y}
        r={3}
      />
      <circle
        className="scene__turn-pivot"
        data-testid="scene-scaling-pivot"
        cx={scale.pivot.x}
        cy={scale.pivot.y}
        r={3.5}
      />
      <g className="scene__turn-gizmo" data-testid="scene-scaling-gizmo">
        <circle cx={scale.at.x} cy={scale.at.y} r={9} />
        <circle cx={scale.at.x} cy={scale.at.y} r={2} />
      </g>
    </g>
  )
}

/**
 * The rotate gizmo: a ring on the cursor, a line back to the pivot, and the
 * angle swept so far drawn as an arc between the two.
 *
 * **Drawn from the numbers the gesture used, not from a second derivation of
 * them.** The pivot and the pointer arrive already in this SVG's pixels — that
 * is why `Turn` carries them — so the line cannot disagree with what is actually
 * being rotated about. Recomputing the pivot here from the outlines on screen
 * would look identical until an entity's sprite failed to load, and then the
 * line would point somewhere nothing is turning around.
 *
 * The arc is what makes a stepped angle legible as steps: a line that jumps
 * between 15° positions reads as the mouse being laggy, and the same jump with a
 * wedge behind it reads as snapping. It is also the only thing on screen saying
 * which way round the turn has gone once it passes half a circle.
 */
function Turning({ turn }: { turn: Turn }): ReactElement {
  const reach = Math.hypot(turn.at.x - turn.pivot.x, turn.at.y - turn.pivot.y)
  // The arc is drawn at a fixed distance rather than at the cursor's, so it
  // stays readable whether the hand is an inch from the pivot or across the
  // panel — and never larger than the reach, so it cannot escape its own line.
  const radius = Math.max(12, Math.min(44, reach - 6))

  return (
    <g className="scene__turn" data-testid="scene-turn" data-turn-degrees={turn.degrees}>
      <Sweep pivot={turn.pivot} from={turn.from} degrees={turn.degrees} radius={radius} />
      <line
        className="scene__turn-line"
        x1={turn.pivot.x}
        y1={turn.pivot.y}
        x2={turn.at.x}
        y2={turn.at.y}
      />
      {/* The pivot: a small solid mark, distinct from a selected entity's
          crosshair, because it is a point the group turns about rather than a
          thing that is selected — and with several selected it is usually not
          where any of them is. */}
      <circle
        className="scene__turn-pivot"
        data-testid="scene-turn-pivot"
        cx={turn.pivot.x}
        cy={turn.pivot.y}
        r={3.5}
      />
      <g className="scene__turn-gizmo" data-testid="scene-turn-gizmo">
        <circle cx={turn.at.x} cy={turn.at.y} r={9} />
        <circle cx={turn.at.x} cy={turn.at.y} r={2} />
      </g>
    </g>
  )
}

/**
 * The wedge between where the line started and where it is now.
 *
 * Screen y counts down while the turn's degrees are counter-clockwise in a y-up
 * world, so the angle is subtracted rather than added when it is turned back
 * into a screen position — the same flip `editor/shell/rotate.ts` makes going
 * the other way, and the only place in the drawing that has to know about it.
 *
 * Nothing is drawn below a degree or so: a zero-width wedge is invisible anyway,
 * and an arc whose two ends coincide is the one input the path syntax cannot
 * express unambiguously.
 */
function Sweep({
  pivot,
  from,
  degrees,
  radius,
}: {
  pivot: { x: number; y: number }
  from: { x: number; y: number }
  degrees: number
  radius: number
}): ReactElement | null {
  if (Math.abs(degrees) < 1) return null

  const start = Math.atan2(from.y - pivot.y, from.x - pivot.x)
  // Clamped to just under a full turn: at exactly 360° the arc's ends meet and
  // the sweep becomes ambiguous, which SVG resolves by drawing nothing at all.
  const swept = Math.max(-359.9, Math.min(359.9, degrees))
  const end = start - (swept * Math.PI) / 180

  const at = (angle: number): string =>
    `${(pivot.x + radius * Math.cos(angle)).toFixed(2)} ${(pivot.y + radius * Math.sin(angle)).toFixed(2)}`

  const large = Math.abs(swept) > 180 ? 1 : 0
  // A positive scene rotation is counter-clockwise, which on a y-down canvas is
  // the *negative* sweep direction.
  const clockwise = swept > 0 ? 0 : 1

  return (
    <path
      className="scene__turn-sweep"
      data-testid="scene-turn-sweep"
      d={`M ${pivot.x} ${pivot.y} L ${at(start)} A ${radius} ${radius} 0 ${large} ${clockwise} ${at(end)} Z`}
    />
  )
}

/**
 * The line a locked grab is running along.
 *
 * Drawn through the entity's *position* rather than the middle of its outline,
 * because that is the point the lock actually holds still — a sprite pivoted at
 * its feet slides along the ground it is standing on, not along its own waist.
 *
 * Worth drawing at all because the alternative is a caption: a sentence saying
 * "locked to X" is read once, and a line through the level is still there while
 * the hand is moving. Blender draws the same line for the same reason.
 */
function Axis({ at, axis }: { at: { x: number; y: number }; axis: 'x' | 'y' }): ReactElement {
  // Longer than any canvas, and clipped by the SVG. The alternative is passing
  // the canvas size down for a line whose ends nobody looks at.
  const far = 10_000

  return (
    <g className="scene__axis" data-testid="scene-axis" data-axis={axis}>
      {axis === 'x' ? (
        <line x1={at.x - far} y1={at.y} x2={at.x + far} y2={at.y} />
      ) : (
        <line x1={at.x} y1={at.y - far} x2={at.x} y2={at.y + far} />
      )}
    </g>
  )
}

/**
 * The scene's own origin, wherever the camera has put it.
 *
 * Worth two short lines of chrome because the coordinate convention is
 * otherwise invisible: y counts *upward* from here, so an entity at y=0 stands
 * on this line rather than below it. Under a camera it is also the one fixed
 * landmark in the level — panning away and watching it leave is how the human
 * knows which direction they have gone.
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
 * A selected entity: its outline, and — for the primary one — a crosshair on
 * its position.
 *
 * Both, because they answer different questions. The outline says which sprite
 * is selected; the crosshair says where the entity *is*, which is not the middle
 * of the outline whenever the texture's pivot says otherwise — a sprite pivoted
 * at its feet has its crosshair on the ground under it. That difference is the
 * whole of how a pivot is understood without reading a number.
 *
 * An entity with nothing to draw gets the crosshair alone. It is somewhere even
 * when it is nothing, and marking the spot beats leaving it unfindable — which
 * is why a *secondary* entity with nothing to draw is the one case that gets no
 * mark at all: a bare crosshair is this overlay's word for "the primary one is
 * here", and spending it on something else would make six selected sprites
 * unreadable to save one invisible entity.
 */
function Selected({ entity, primary }: { entity: DrawnEntity; primary: boolean }): ReactElement {
  return (
    <g
      className={primary ? 'scene__selected' : 'scene__selected scene__selected--also'}
      data-testid="scene-selected"
      data-selected-entity={entity.id}
      data-selected-primary={primary}
    >
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
      {primary && (
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
      )}
    </g>
  )
}

/** What is on screen, in one line: how much of the scene was drawn, and how close. */
export function describeScene(shown: ShownScene, entityCount: number): string {
  if (entityCount === 0) return 'This scene is empty. Add an entity in the Outliner to put something in it.'

  const drawn = shown.entities.filter((entity) => entity.bounds !== null).length
  const nothing = entityCount - drawn

  const size = `${shown.canvasSize.width}×${shown.canvasSize.height}`
  const what =
    nothing === 0
      ? `${count(drawn, 'entity', 'entities')} drawn`
      : `${count(drawn, 'entity', 'entities')} drawn, ${nothing} with nothing to draw`

  // The zoom is written the way the texture tab writes it, from the same
  // ladder, so `8×` means one thing across the editor rather than two.
  return `${what} — ${describeZoom(shown.camera.scale)}, ${size}.`
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
