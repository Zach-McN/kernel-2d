import type { Point } from '../../runtime/scene/coordinates'

/**
 * Where a placement lands.
 *
 * Everything that puts an entity somewhere goes through here — a drag in the
 * picture, and a prefab dropped by a press — so there is one answer to "which
 * positions are reachable" rather than one per gesture. Imported from the
 * coordinates module directly rather than through `runtime/index.ts`, which
 * would load Phaser and put this arithmetic out of reach of a unit test.
 *
 * **A grid needs two numbers, and leaving the second one out is the mistake
 * this file exists to have already made.** A step on its own describes a grid
 * through the origin, which lands on 0, 16, 32 — and the first level anybody
 * drew on this kernel has its tiles at 8, 24, 40, because a tile sprite hangs
 * off the middle of its position and a 16-unit tile centred at 8 covers the
 * square from 0 to 16. Snapping such a level to a step alone puts every new
 * tile half a cell away from the ones already there: near enough to look
 * deliberate, far enough to be a different square. So the offset is not a
 * refinement to add later, it is the difference between the feature working and
 * quietly ruining a level, and it is the same pair Godot's 2D editor settled on
 * (grid step, grid offset).
 *
 * Neither number is in the document, in a `.meta` or in `project.json`. It is a
 * property of the window, like the camera and the selection (`editor-ui` U8),
 * so Ctrl-Z cannot see it and no file records it.
 */

export interface Snap {
  /** The spacing of the grid, in scene units. Zero places freely. */
  step: number
  /**
   * Where the grid sits, in scene units — the position that is always on it.
   *
   * A step of 16 offset by 8 reaches 8, 24, 40; offset by 0 it reaches 0, 16,
   * 32. Same grid, moved half a cell.
   */
  offset: number
}

/**
 * What a viewport starts with: whole level units, the grid through the origin.
 *
 * Chosen so that a window nobody has touched behaves exactly as the editor did
 * before any of this existed — a level laid out on whole numbers is one whose
 * pixel art lands on the pixel grid and whose file is readable.
 */
export const WHOLE_UNITS: Snap = { step: 1, offset: 0 }

/**
 * How many decimals a free position keeps.
 *
 * Finer than the closest zoom can resolve, and the alternative is seventeen
 * digits of floating-point noise in somebody's level. Applied to snapped
 * positions too: `(24 - 8) / 16 * 16 + 8` is not always exactly 24 in binary,
 * and a tile at 24.000000000000004 is a tile the eye cannot tell from one at 24
 * and the file can.
 */
const PLACES = 1_000

/** A position with the noise taken off, and nothing else done to it. */
export function freely(value: number): number {
  return Math.round(value * PLACES) / PLACES
}

/**
 * The nearest position this snap allows.
 *
 * A step that is not a positive number means no grid at all, which is the same
 * answer as holding Alt. That is deliberate rather than defensive: it gives the
 * step field an "off" that reads as a number rather than as a checkbox, and it
 * means a half-typed `-` or an empty field can never produce a placement
 * somewhere arithmetic nobody meant.
 */
export function snapTo(value: number, snap: Snap): number {
  if (!Number.isFinite(snap.step) || snap.step <= 0 || !Number.isFinite(snap.offset)) return freely(value)
  return freely(Math.round((value - snap.offset) / snap.step) * snap.step + snap.offset)
}

/** Both axes at once, on the same grid. */
export function snapPoint(point: Point, snap: Snap): Point {
  return { x: snapTo(point.x, snap), y: snapTo(point.y, snap) }
}

/** A point placed with no grid — what Alt does. */
export function freePoint(point: Point): Point {
  return { x: freely(point.x), y: freely(point.y) }
}
