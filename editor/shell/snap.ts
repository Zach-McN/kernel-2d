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
  /**
   * Whether positions land on the grid at all — the toggle in the viewport bar.
   *
   * A switch rather than a number that secretly means "no". A step of zero used
   * to be the off position, and it was the wrong shape twice over: it made the
   * spacing field answer two questions, and it threw away the spacing on the way
   * out, so turning snapping off and on again lost the grid you had set up.
   * Every editor with a grid has this button; this one now does too.
   */
  on: boolean
  /**
   * The spacing of the grid, in scene units.
   *
   * Kept while snapping is off, which is the point of it being a separate field
   * — set the grid up, then switch it on.
   */
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
 * What a viewport starts with: snapping on, whole level units, grid through the
 * origin.
 *
 * Chosen so that a window nobody has touched behaves exactly as the editor did
 * before any of this existed — a level laid out on whole numbers is one whose
 * pixel art lands on the pixel grid and whose file is readable.
 */
export const WHOLE_UNITS: Snap = { on: true, step: 1, offset: 0 }

/**
 * The spacings the interval control offers, as a dropdown.
 *
 * Powers of two rather than Unreal's 1/5/10/50/100, because this is a 2D pixel
 * editor and its sprites, tiles and atlases are all sized in powers of two — a
 * ladder of 5s would offer eight intervals and no useful one. The control still
 * accepts a typed number, so a level that wants 24 can have 24; the list is the
 * common cases within reach, not a fence around them.
 */
export const SNAP_INTERVALS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128]

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
 * The nearest position on the grid.
 *
 * **Pure grid arithmetic: it does not consult `on`.** Whether the grid applies
 * at all is one decision, and it is `placeOn`'s — asking it here as well would
 * make the inverted case unreachable, because `Ctrl` with snapping off has to
 * put the entity *on* a grid the toggle says is off. Do not re-add the check
 * here; that is the bug this comment exists to stop.
 *
 * A step that is not a positive number still means no grid, but that is purely a
 * defence now rather than the off switch: a half-typed `-` or an empty field
 * must never produce a placement somewhere arithmetic nobody meant.
 */
export function snapTo(value: number, snap: Snap): number {
  if (!Number.isFinite(snap.step) || snap.step <= 0 || !Number.isFinite(snap.offset)) return freely(value)
  return freely(Math.round((value - snap.offset) / snap.step) * snap.step + snap.offset)
}

/** Both axes at once, on the same grid. */
export function snapPoint(point: Point, snap: Snap): Point {
  return { x: snapTo(point.x, snap), y: snapTo(point.y, snap) }
}

/** A point placed with no grid at all. */
export function freePoint(point: Point): Point {
  return { x: freely(point.x), y: freely(point.y) }
}

/**
 * Where a placement lands: the toggle, as the held modifier leaves it.
 *
 * **The one door.** Every way of putting something in a level goes through here
 * — a drag, a keyboard grab, a file dropped on the picture, a prefab stamped by
 * a press — so "is snapping on" has exactly one answer and switching the toggle
 * changes all four at once.
 *
 * `invert` is `Ctrl`, and it does not mean "place freely" — it means **the other
 * thing**. With snapping on it places freely; with snapping off it puts the
 * entity on the grid, which is the half nobody thinks of and the half that makes
 * the modifier worth having: laying a level out by eye and wanting *this one*
 * aligned is the commonest reason to reach for a key mid-drag.
 *
 * That exclusive-or is computed here and nowhere else. Spelled out at each of
 * the three call sites it would be three chances to write the inversion backwards
 * — and backwards is silent: things land on the grid when you asked for
 * anywhere, which reads as the snap being stuck rather than as a modifier being
 * inverted. It is also why the argument is called `invert` rather than `free`,
 * the name it had while `Alt` meant one thing: a boolean whose meaning has
 * flipped and whose name has not is how the next reader gets it wrong.
 */
export function placeOn(point: Point, snap: Snap, invert: boolean): Point {
  return snap.on !== invert ? snapPoint(point, snap) : freePoint(point)
}

/**
 * How far apart the angles a turn can land on are, in degrees.
 *
 * A fixed number rather than `snap.step`, and that is not a shortcut: the step
 * is **pixels**, and a 16-pixel grid says nothing whatever about degrees.
 * Reading it here would make the interval control secretly mean two things and
 * put the grid and the protractor on one dial.
 *
 * Fifteen because it divides the angles anybody actually wants — 15, 30, 45, 90,
 * 180 are all on it — and because a finer step stops being a snap.
 */
export const ANGLE_STEP = 15

/**
 * Where a turn lands: the same switch and the same modifier as a placement.
 *
 * The twin of `placeOn`, sharing its exclusive-or so that the switch in the
 * viewport bar means one thing across both gestures and `Ctrl` inverts both.
 *
 * **The angle that snaps is the amount turned, not the angle ended up at.** With
 * several entities selected they start at different rotations, so rounding each
 * *result* to a multiple of 15 would turn one member of the group by 15° and
 * another by 4° — which is not a rigid rotation, which is the whole of what the
 * gesture is. Rounding the delta turns every member by the same amount, which is.
 */
export function turnOn(degrees: number, snap: Snap, invert: boolean): number {
  if (snap.on === invert) return freely(degrees)
  return freely(Math.round(degrees / ANGLE_STEP) * ANGLE_STEP)
}

/**
 * How far apart the sizes a scale can land on are.
 *
 * A third fixed number rather than `snap.step`, for the reason `ANGLE_STEP` is
 * one: the step is **pixels**, and a 16-pixel grid says nothing about a
 * multiplier. Three gestures, one switch, three intervals — the switch says
 * *whether* to land on something, and each gesture knows what its own something
 * is.
 *
 * A tenth because it reaches the sizes anybody asks for by name — a half, three
 * quarters, one and a half, double — and because a finer step stops being a
 * snap.
 */
export const SCALE_STEP = 0.1

/**
 * Where a scale lands: the same switch and the same modifier again.
 *
 * **The number that snaps is the factor, not the size ended up at**, which is
 * `turnOn`'s argument exactly: a group starts at several different sizes, so
 * rounding each *result* to a tenth would multiply one member by 1.5 and
 * another by 1.43 — which is not a rigid scale, which is the whole of what the
 * gesture is. Rounding the factor grows every member by the same proportion.
 *
 * Floored at one step rather than allowed to round to zero: a factor of 0 is an
 * entity with no size, and it is the one snapped value that is never what the
 * hand meant.
 */
export function scaleOn(factor: number, snap: Snap, invert: boolean): number {
  if (snap.on === invert) return freely(factor)
  return freely(Math.max(SCALE_STEP, Math.round(factor / SCALE_STEP) * SCALE_STEP))
}
