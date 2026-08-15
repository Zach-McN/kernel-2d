import type { Point } from '../../runtime/scene/coordinates'
import type { Snap } from './snap'

/**
 * The grid, as something to look at rather than something to land on.
 *
 * `snap.ts` decides where a placement goes; this decides whether that grid can
 * be drawn and where its lines fall on the canvas. Two files because they are
 * two subjects with one input: the snap is authority over positions and must
 * stay pure arithmetic that a unit test can reach, and this is a question about
 * a screen — a camera, a canvas, and how small a cell can get before a grid
 * stops being a grid and becomes a grey wash.
 *
 * **It reads `snap.on`, and that is the one place the switch means "draw".**
 * `snapTo` deliberately does *not* consult the switch, because `Ctrl` inverts it
 * and the inverted case has to reach a grid the switch says is off. Nothing
 * inverts a drawing: the human asked for the grid to appear with the switch, so
 * the switch is checked here and the asymmetry is deliberate rather than an
 * oversight to be tidied up later.
 *
 * Every number in comes from the renderer's own report of what it drew
 * (`runtime/scene/scene-view.ts`), which is the standing rule of anything drawn
 * over that canvas: a grid computed from a second reading of the camera would
 * drift from the sprites it is supposed to be aligning.
 */

/**
 * The smallest a cell may be on screen, in CSS pixels, before the grid is not
 * drawn at all.
 *
 * A grid of one-unit cells at 1× is lines a pixel apart — which is not a grid,
 * it is a flat wash over the level that hides the art underneath it and says
 * nothing about where anything will land. Six pixels is about where a cell stops
 * being countable.
 *
 * **Nothing coarser is substituted when the cells are too small.** Drawing every
 * fourth line instead would be true — a subset of the grid is still the grid —
 * and it would also put a picture on screen whose spacing is not the number in
 * the interval field, which is the one thing this drawing exists to show. So the
 * grid disappears instead, and both ways back are immediate: zoom in, or raise
 * the interval.
 */
export const MIN_CELL = 6

export interface DrawnGrid {
  /** The spacing in scene units — the interval field's own number. */
  step: number
  /** That spacing on screen, in CSS pixels. */
  cell: number
  /**
   * A grid position, in CSS pixels from the canvas's top-left corner, with a
   * whole number of cells taken off it so it lands in the first cell.
   *
   * Where the tiling starts, in other words. Any grid line would do — they are a
   * cell apart in both directions — and the wrapped one is the only choice that
   * stays a small number however far the camera has travelled.
   */
  from: Point
}

/**
 * The grid to draw, or null when there is none to draw.
 *
 * Null covers four different situations on purpose: snapping is switched off,
 * the interval field is mid-edit and holds nothing usable, the camera is not
 * ready, or the cells would be too small to read. All four mean "no grid on
 * screen", and a caller that had to tell them apart would be a caller drawing
 * four different pictures of nothing.
 */
export function gridOnScreen(sceneOrigin: Point, scale: number, snap: Snap): DrawnGrid | null {
  if (!snap.on) return null
  if (!Number.isFinite(snap.step) || snap.step <= 0) return null
  if (!Number.isFinite(snap.offset)) return null
  if (!Number.isFinite(scale) || scale <= 0) return null
  if (!Number.isFinite(sceneOrigin.x) || !Number.isFinite(sceneOrigin.y)) return null

  const cell = snap.step * scale
  if (cell < MIN_CELL) return null

  return {
    step: snap.step,
    cell,
    // The offset moves the grid, so the line that matters is the one through
    // `offset` rather than the one through the scene's origin — a board of
    // 16-unit tiles at 8, 24, 40 must be drawn on 8, 24, 40. Screen y counts
    // down while scene y counts up, which is the whole of why one of these is a
    // minus (`runtime/scene/coordinates.ts`).
    from: {
      x: intoFirstCell(sceneOrigin.x + snap.offset * scale, cell),
      y: intoFirstCell(sceneOrigin.y - snap.offset * scale, cell),
    },
  }
}

/**
 * The same grid position, moved by whole cells until it is within one cell of
 * the canvas's corner.
 *
 * Remainder rather than modulo: a camera looking left of the origin makes this
 * negative, and JavaScript's `%` keeps the sign, so the extra term is what stops
 * the tiling starting off the far side of the canvas.
 */
function intoFirstCell(value: number, cell: number): number {
  return ((value % cell) + cell) % cell
}
