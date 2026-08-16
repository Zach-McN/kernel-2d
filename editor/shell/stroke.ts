import type { Point } from '../../runtime/scene/coordinates'
import { snapTo, type Snap } from './snap'

/**
 * A stroke over the grid: which cells the pointer crossed.
 *
 * Pure arithmetic beside `snap.ts`, in the same spirit — where things land is
 * `snapTo`'s decision and this does not make a second one. A cell is named by
 * how many steps it is from the grid's offset, and it is *reached* by asking
 * the snap where its centre is, so a stroke stamps exactly where a press
 * would.
 *
 * **The walk fills what the hand skipped.** Pointer events arrive tens of times
 * a second and a fast sweep crosses many cells between two of them, so a
 * stroke that stamped only where it was sampled would be a dotted line. Between
 * two samples every cell along the straight line is visited — Bresenham's, in
 * cell coordinates, eight-connected — which is what a road drawn in one sweep
 * needs, and no more: a diagonal is a chain of cells touching at corners, as a
 * diagonal drawn on graph paper is.
 */

export interface Cell {
  col: number
  row: number
}

/** The cell a point falls in — where a press there would land, in grid steps. */
export function cellOf(point: Point, snap: Snap): Cell {
  return {
    col: Math.round((snapTo(point.x, snap) - snap.offset) / snap.step),
    row: Math.round((snapTo(point.y, snap) - snap.offset) / snap.step),
  }
}

/** Where a cell's press would land, in scene units — the point `snapTo` reaches. */
export function cellCentre(cell: Cell, snap: Snap): Point {
  return {
    x: snapTo(cell.col * snap.step + snap.offset, snap),
    y: snapTo(cell.row * snap.step + snap.offset, snap),
  }
}

/** One name per cell, for a set. */
export function cellKey(cell: Cell): string {
  return `${cell.col},${cell.row}`
}

/**
 * Every cell on the straight line from `from` (not included) to `to`
 * (included), in order, each once. Empty when the two are one cell.
 */
export function cellsBetween(from: Cell, to: Cell): Cell[] {
  const cells: Cell[] = []
  const dx = Math.abs(to.col - from.col)
  const dy = -Math.abs(to.row - from.row)
  const stepX = from.col < to.col ? 1 : -1
  const stepY = from.row < to.row ? 1 : -1
  let error = dx + dy
  let col = from.col
  let row = from.row

  while (col !== to.col || row !== to.row) {
    const twice = 2 * error
    if (twice >= dy) {
      error += dy
      col += stepX
    }
    if (twice <= dx) {
      error += dx
      row += stepY
    }
    cells.push({ col, row })
  }

  return cells
}
