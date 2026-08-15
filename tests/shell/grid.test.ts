import { describe, expect, it } from 'vitest'

import { MIN_CELL, gridOnScreen } from '../../editor/shell/grid'
import { WHOLE_UNITS, type Snap } from '../../editor/shell/snap'
import { toScreenPoint, type Camera, type Size } from '../../runtime/scene/coordinates'

/**
 * The grid as a thing on screen: whether there is one to draw, how big its cells
 * are, and where its lines fall.
 *
 * The load-bearing property is the last one, and it is stated here as a round
 * trip rather than as a formula. A grid whose lines are *near* the positions
 * things land on is worse than no grid: it is a picture that says a tile is
 * aligned when it is half a cell out. So the tests below take a scene position
 * the snap can actually reach, ask the camera where it landed on screen, and
 * check that a line is drawn exactly there.
 */

/** The grid the first real game wants: 16-unit tiles, drawn from their middles. */
const TILES: Snap = { on: true, step: 16, offset: 8 }

const CANVAS: Size = { width: 800, height: 600 }

/** Where the renderer would report the scene's origin for this camera. */
function originFor(camera: Camera): { x: number; y: number } {
  return toScreenPoint({ x: 0, y: 0 }, camera, CANVAS)
}

/**
 * Whether a screen position falls on one of the drawn lines.
 *
 * The tiling is reported by its first cell, so "on a line" means "a whole number
 * of cells away from it" — in either direction, because the canvas has grid on
 * both sides of wherever the tiling was reported to start.
 */
function onALine(from: number, cell: number, screen: number): boolean {
  const cells = (screen - from) / cell
  return Math.abs(cells - Math.round(cells)) < 1e-9
}

describe('whether there is a grid to draw at all', () => {
  it('is nothing while snapping is switched off, however big the cells would be', () => {
    expect(gridOnScreen({ x: 0, y: 0 }, 4, { ...TILES, on: false })).toBeNull()
  })

  it('is nothing while the interval field holds something unusable', () => {
    for (const step of [0, -16, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gridOnScreen({ x: 0, y: 0 }, 4, { ...TILES, step })).toBeNull()
    }
    expect(gridOnScreen({ x: 0, y: 0 }, 4, { ...TILES, offset: Number.NaN })).toBeNull()
  })

  it('is nothing when there is no camera to speak of', () => {
    expect(gridOnScreen({ x: 0, y: 0 }, 0, TILES)).toBeNull()
    expect(gridOnScreen({ x: 0, y: 0 }, Number.NaN, TILES)).toBeNull()
    expect(gridOnScreen({ x: Number.NaN, y: 0 }, 2, TILES)).toBeNull()
  })
})

describe('cells too small to read', () => {
  /**
   * The default grid is one unit, which at 1× is lines a pixel apart. Drawing
   * that is not a grid, it is a grey wash over the level — so nothing is drawn,
   * and both ways back (zoom in, or raise the interval) are immediate.
   */
  it('are not drawn, which is what the default grid does until it is zoomed into', () => {
    expect(gridOnScreen({ x: 0, y: 0 }, 1, WHOLE_UNITS)).toBeNull()
    expect(gridOnScreen({ x: 0, y: 0 }, MIN_CELL - 0.001, WHOLE_UNITS)).toBeNull()

    expect(gridOnScreen({ x: 0, y: 0 }, MIN_CELL, WHOLE_UNITS)?.cell).toBe(MIN_CELL)
    // Or the same zoom with a wider interval, which is the other way back.
    expect(gridOnScreen({ x: 0, y: 0 }, 1, { on: true, step: 16, offset: 0 })?.cell).toBe(16)
  })
})

describe('the cells', () => {
  it('are the interval, at the camera’s scale — so the grid changes size with the number typed', () => {
    for (const [step, scale, cell] of [
      [16, 1, 16],
      [16, 2, 32],
      [32, 1, 32],
      [8, 4, 32],
    ] as const) {
      const grid = gridOnScreen({ x: 0, y: 0 }, scale, { on: true, step, offset: 0 })
      expect(grid?.cell).toBe(cell)
      // And the level's own number is carried through untouched, because it is
      // what the tooltip and the interval field are both saying.
      expect(grid?.step).toBe(step)
    }
  })
})

describe('where the lines fall', () => {
  /**
   * The one that decides whether the drawing is worth having. An offset grid is
   * the case a formula gets wrong quietly: 16 from 8 reaches 8, 24, 40, and a
   * grid drawn through the origin instead is half a cell out everywhere and
   * looks perfectly convincing.
   */
  it('is exactly where the snap puts things, offset and all', () => {
    const camera: Camera = { scale: 2, focus: { x: 37.5, y: -12.25 } }
    const grid = gridOnScreen(originFor(camera), camera.scale, TILES)
    expect(grid).not.toBeNull()

    for (const scenePosition of [
      { x: 8, y: 8 },
      { x: 24, y: 40 },
      { x: -8, y: 24 },
      { x: 120, y: -56 },
    ]) {
      const screen = toScreenPoint(scenePosition, camera, CANVAS)
      expect(onALine(grid?.from.x ?? 0, grid?.cell ?? 1, screen.x), `x at ${scenePosition.x}`).toBe(true)
      expect(onALine(grid?.from.y ?? 0, grid?.cell ?? 1, screen.y), `y at ${scenePosition.y}`).toBe(true)
    }
  })

  it('is not where a position between two grid lines is', () => {
    const camera: Camera = { scale: 2, focus: { x: 0, y: 0 } }
    const grid = gridOnScreen(originFor(camera), camera.scale, TILES)

    const screen = toScreenPoint({ x: 16, y: 16 }, camera, CANVAS)
    expect(onALine(grid?.from.x ?? 0, grid?.cell ?? 1, screen.x)).toBe(false)
    expect(onALine(grid?.from.y ?? 0, grid?.cell ?? 1, screen.y)).toBe(false)
  })

  /**
   * Wherever the camera has travelled to, the tiling is reported within one cell
   * of the canvas's corner — including the negative side, which a plain
   * remainder would report off the far edge and draw nothing at all.
   */
  it('starts inside the first cell, however far the camera has gone', () => {
    for (const focus of [
      { x: 0, y: 0 },
      { x: 5_000, y: 5_000 },
      { x: -5_000, y: -5_000 },
      { x: -3.5, y: 2.5 },
    ]) {
      const camera: Camera = { scale: 2, focus }
      const grid = gridOnScreen(originFor(camera), camera.scale, TILES)
      const cell = grid?.cell ?? 0

      expect(grid?.from.x ?? -1).toBeGreaterThanOrEqual(0)
      expect(grid?.from.x ?? cell).toBeLessThan(cell)
      expect(grid?.from.y ?? -1).toBeGreaterThanOrEqual(0)
      expect(grid?.from.y ?? cell).toBeLessThan(cell)
    }
  })
})
