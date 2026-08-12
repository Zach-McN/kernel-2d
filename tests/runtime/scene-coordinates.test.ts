import { describe, expect, it } from 'vitest'

import { toScenePoint, toScreenPoint, toScreenRadians } from '../../runtime/scene/coordinates'

/**
 * Scene space held to the promise the whole convention exists for: y counts
 * upward from the floor, so `y: 0` is the bottom of the view and a bigger
 * number is higher up.
 *
 * That is what makes a sprite pivoted at its feet stand *on* its y position
 * rather than straddling it — a pivot of 1 puts the bottom edge of the image on
 * the point, and the point at y=0 is the bottom edge of the panel. The visual
 * half of that is asserted in the browser suite against what the renderer
 * actually drew; this is the arithmetic underneath it.
 */

describe('scene space counts upward from the bottom-left', () => {
  it('puts the origin on the bottom edge of the canvas', () => {
    expect(toScreenPoint({ x: 0, y: 0 }, 360)).toEqual({ x: 0, y: 360 })
  })

  it('puts a higher y further up the screen', () => {
    const low = toScreenPoint({ x: 0, y: 10 }, 360)
    const high = toScreenPoint({ x: 0, y: 200 }, 360)

    expect(high.y).toBeLessThan(low.y)
  })

  it('leaves x alone', () => {
    expect(toScreenPoint({ x: 120, y: 24 }, 360).x).toBe(120)
  })

  it('reaches the top edge at a y of the canvas height', () => {
    expect(toScreenPoint({ x: 0, y: 360 }, 360)).toEqual({ x: 0, y: 0 })
  })

  it('does not hide an entity above the view — it reports it off the top', () => {
    // No camera yet, so this is honest rather than clamped: an entity placed
    // past the top edge has a negative screen y and simply is not on screen.
    expect(toScreenPoint({ x: 0, y: 500 }, 360).y).toBe(-140)
  })

  it('converts back to where it came from', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 120, y: 24 },
      { x: -40, y: 512.5 },
    ]) {
      expect(toScenePoint(toScreenPoint(point, 360), 360)).toEqual(point)
    }
  })
})

describe('rotation', () => {
  it('leaves zero alone', () => {
    expect(toScreenRadians(0)).toBe(0)
  })

  it('turns a counter-clockwise scene angle into a clockwise screen one', () => {
    // The sign flip is the whole point: y is up in a scene and down on a
    // screen, so the same visual turn is the opposite angle in each.
    expect(toScreenRadians(90)).toBeCloseTo(-Math.PI / 2, 10)
    expect(toScreenRadians(-90)).toBeCloseTo(Math.PI / 2, 10)
  })

  it('takes degrees, not radians', () => {
    expect(toScreenRadians(180)).toBeCloseTo(-Math.PI, 10)
    expect(toScreenRadians(360)).toBeCloseTo(-2 * Math.PI, 10)
  })
})
