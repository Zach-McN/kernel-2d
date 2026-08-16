import { describe, expect, it } from 'vitest'

import { cellCentre, cellKey, cellOf, cellsBetween, type Cell } from '../../editor/shell/stroke'
import { snapPoint, type Snap } from '../../editor/shell/snap'

/**
 * The arithmetic a paint stroke rests on: which cell a point is in, where a
 * cell's press lands, and — the half that matters — every cell along the line
 * between two pointer samples, each once, so a fast sweep is a solid road.
 */

const GRID: Snap = { on: true, step: 16, offset: 8 }

describe('which cell a point is in', () => {
  it('names the cell by steps from the offset, and lands back where the snap would', () => {
    // 8, 24, 40 are the centres of cells 0, 1, 2 on this grid.
    expect(cellOf({ x: 8, y: 40 }, GRID)).toEqual({ col: 0, row: 2 })
    expect(cellOf({ x: 30, y: 3 }, GRID)).toEqual({ col: 1, row: 0 })
    expect(cellCentre({ col: 1, row: 0 }, GRID)).toEqual({ x: 24, y: 8 })
    // Round trip through the snap: a stroke stamps exactly where a press would.
    expect(cellCentre(cellOf({ x: 30, y: 3 }, GRID), GRID)).toEqual(snapPoint({ x: 30, y: 3 }, GRID))
  })

  it('counts negative cells left of and below the offset', () => {
    expect(cellOf({ x: -8, y: -24 }, GRID)).toEqual({ col: -1, row: -2 })
    expect(cellCentre({ col: -1, row: -2 }, GRID)).toEqual({ x: -8, y: -24 })
  })
})

describe('the cells between two samples', () => {
  const walk = (from: Cell, to: Cell): string[] => cellsBetween(from, to).map(cellKey)

  it('is empty when the pointer stayed in one cell', () => {
    expect(walk({ col: 3, row: 3 }, { col: 3, row: 3 })).toEqual([])
  })

  it('is every cell along a row, in order, not including where it started', () => {
    expect(walk({ col: 0, row: 0 }, { col: 4, row: 0 })).toEqual(['1,0', '2,0', '3,0', '4,0'])
    expect(walk({ col: 4, row: 0 }, { col: 0, row: 0 })).toEqual(['3,0', '2,0', '1,0', '0,0'])
  })

  it('is every cell along a column', () => {
    expect(walk({ col: 2, row: 5 }, { col: 2, row: 2 })).toEqual(['2,4', '2,3', '2,2'])
  })

  it('is a chain of touching cells along a diagonal', () => {
    expect(walk({ col: 0, row: 0 }, { col: 3, row: 3 })).toEqual(['1,1', '2,2', '3,3'])
    expect(walk({ col: 0, row: 0 }, { col: -3, row: 3 })).toEqual(['-1,1', '-2,2', '-3,3'])
  })

  it('leaves no gap on a shallow or a steep line, and visits no cell twice', () => {
    for (const to of [
      { col: 10, row: 3 },
      { col: 3, row: 10 },
      { col: -7, row: 2 },
      { col: 5, row: -9 },
    ]) {
      const cells = cellsBetween({ col: 0, row: 0 }, to)
      const keys = cells.map(cellKey)
      expect(new Set(keys).size).toBe(keys.length)
      expect(cells.at(-1)).toEqual(to)
      // Every step moves at most one cell on each axis: no gaps.
      let previous: Cell = { col: 0, row: 0 }
      for (const cell of cells) {
        expect(Math.abs(cell.col - previous.col)).toBeLessThanOrEqual(1)
        expect(Math.abs(cell.row - previous.row)).toBeLessThanOrEqual(1)
        expect(cell).not.toEqual(previous)
        previous = cell
      }
      // And it takes exactly as many steps as the longer axis.
      expect(cells).toHaveLength(Math.max(Math.abs(to.col), Math.abs(to.row)))
    }
  })
})
