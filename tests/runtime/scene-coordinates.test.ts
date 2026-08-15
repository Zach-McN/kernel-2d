import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CAMERA,
  clampFocus,
  framing,
  toPinnedOffset,
  toPinnedScreenPoint,
  isOnScreen,
  panBy,
  snapCamera,
  toSceneRect,
  toScenePoint,
  toScreenPoint,
  toScreenRadians,
  union,
  zoomAbout,
  type Camera,
  type Size,
} from '../../runtime/scene/coordinates'

/**
 * Scene space held to the promise the whole convention exists for: y counts
 * upward from the floor, so a bigger number is higher up.
 *
 * That is what makes a sprite pivoted at its feet stand *on* its y position
 * rather than straddling it — a pivot of 1 puts the bottom edge of the image on
 * the point. The visual half of that is asserted in the browser suite against
 * what the renderer actually drew; this is the arithmetic underneath it.
 *
 * The camera is held to four properties, and they are the four the viewport's
 * acceptance criteria are made of: what you drag moves by exactly what you
 * dragged, what is under the cursor stays under the cursor while you zoom,
 * framing puts the content in the middle, and every conversion goes back where
 * it came from.
 */

const CANVAS: Size = { width: 800, height: 600 }

/** A deliberately awkward camera: fractional focus, non-integer scale. */
const AWKWARD: Camera = { scale: 2.5, focus: { x: 137.25, y: -42.5 } }

describe('scene space counts upward', () => {
  it('puts the focus in the middle of the canvas', () => {
    expect(toScreenPoint({ x: 0, y: 0 }, DEFAULT_CAMERA, CANVAS)).toEqual({ x: 400, y: 300 })
  })

  it('puts a higher y further up the screen', () => {
    const low = toScreenPoint({ x: 0, y: 10 }, DEFAULT_CAMERA, CANVAS)
    const high = toScreenPoint({ x: 0, y: 200 }, DEFAULT_CAMERA, CANVAS)

    expect(high.y).toBeLessThan(low.y)
  })

  it('puts a bigger x further right', () => {
    const left = toScreenPoint({ x: 10, y: 0 }, DEFAULT_CAMERA, CANVAS)
    const right = toScreenPoint({ x: 200, y: 0 }, DEFAULT_CAMERA, CANVAS)

    expect(right.x).toBeGreaterThan(left.x)
  })

  it('does not hide an entity outside the view — it reports it off the edge', () => {
    // Honest rather than clamped: an entity past the top of the panel has a
    // negative screen y, and the panel is what says so in words.
    expect(toScreenPoint({ x: 0, y: 500 }, DEFAULT_CAMERA, CANVAS).y).toBe(-200)
  })

  it('converts back to where it came from, at any camera', () => {
    for (const camera of [DEFAULT_CAMERA, AWKWARD, { scale: 1 / 8, focus: { x: -900, y: 620 } }]) {
      for (const point of [
        { x: 0, y: 0 },
        { x: 120, y: 24 },
        { x: -40, y: 512.5 },
      ]) {
        const back = toScenePoint(toScreenPoint(point, camera, CANVAS), camera, CANVAS)
        expect(back.x).toBeCloseTo(point.x, 9)
        expect(back.y).toBeCloseTo(point.y, 9)
      }
    }
  })
})

describe('the scale', () => {
  it('spreads the scene out by exactly the scale', () => {
    const camera: Camera = { scale: 4, focus: { x: 0, y: 0 } }

    const near = toScreenPoint({ x: 10, y: 0 }, camera, CANVAS)
    const far = toScreenPoint({ x: 20, y: 0 }, camera, CANVAS)

    expect(far.x - near.x).toBe(40)
  })

  it('leaves the focus in the middle however far in or out it goes', () => {
    for (const scale of [1 / 16, 1, 32]) {
      const camera: Camera = { scale, focus: { x: 137.25, y: -42.5 } }
      expect(toScreenPoint(camera.focus, camera, CANVAS)).toEqual({ x: 400, y: 300 })
    }
  })
})

describe('panning', () => {
  it('moves the scene by exactly what was dragged', () => {
    const point = { x: 40, y: 90 }
    const before = toScreenPoint(point, AWKWARD, CANVAS)
    const after = toScreenPoint(point, panBy(AWKWARD, 30, -18), CANVAS)

    expect(after.x - before.x).toBeCloseTo(30, 9)
    expect(after.y - before.y).toBeCloseTo(-18, 9)
  })

  it('drags the same distance on screen whatever the zoom', () => {
    // The gesture is in screen pixels, so grabbing the level and moving the
    // mouse 30px has to move it 30px at 1/8× and at 32× alike.
    for (const scale of [1 / 8, 1, 32]) {
      const camera: Camera = { scale, focus: { x: 0, y: 0 } }
      const before = toScreenPoint({ x: 0, y: 0 }, camera, CANVAS)
      const after = toScreenPoint({ x: 0, y: 0 }, panBy(camera, 30, 0), CANVAS)

      expect(after.x - before.x).toBeCloseTo(30, 9)
    }
  })

  it('goes back where it started when dragged back', () => {
    const there = panBy(panBy(AWKWARD, 120, -60), -120, 60)

    expect(there.focus.x).toBeCloseTo(AWKWARD.focus.x, 9)
    expect(there.focus.y).toBeCloseTo(AWKWARD.focus.y, 9)
    expect(there.scale).toBe(AWKWARD.scale)
  })
})

describe('zooming', () => {
  it('leaves whatever is under the cursor under the cursor', () => {
    const cursor = { x: 610, y: 120 }
    const under = toScenePoint(cursor, AWKWARD, CANVAS)

    for (const scale of [1 / 4, 1, 6, 32]) {
      const zoomed = zoomAbout(AWKWARD, cursor, scale, CANVAS)
      const where = toScreenPoint(under, zoomed, CANVAS)

      expect(where.x).toBeCloseTo(cursor.x, 8)
      expect(where.y).toBeCloseTo(cursor.y, 8)
    }
  })

  it('is the plain thing when the cursor is dead centre', () => {
    const zoomed = zoomAbout(AWKWARD, { x: 400, y: 300 }, 8, CANVAS)

    expect(zoomed.scale).toBe(8)
    expect(zoomed.focus.x).toBeCloseTo(AWKWARD.focus.x, 9)
    expect(zoomed.focus.y).toBeCloseTo(AWKWARD.focus.y, 9)
  })
})

describe('framing', () => {
  it('puts the middle of the content in the middle of the canvas', () => {
    const content = { x: 100, y: 40, width: 300, height: 200 }
    const camera = framing(content, 2)

    expect(toScreenPoint({ x: 250, y: 140 }, camera, CANVAS)).toEqual({ x: 400, y: 300 })
  })

  it('gets the whole content on screen at a scale that fits', () => {
    const content = { x: -500, y: -200, width: 1600, height: 1200 }
    const camera = framing(content, 1 / 2)

    const corners = [
      toScreenPoint({ x: content.x, y: content.y }, camera, CANVAS),
      toScreenPoint({ x: content.x + content.width, y: content.y + content.height }, camera, CANVAS),
    ]

    for (const corner of corners) {
      expect(corner.x).toBeGreaterThanOrEqual(0)
      expect(corner.x).toBeLessThanOrEqual(CANVAS.width)
      expect(corner.y).toBeGreaterThanOrEqual(0)
      expect(corner.y).toBeLessThanOrEqual(CANVAS.height)
    }
  })

  it('points at the origin when there is nothing to frame', () => {
    // An empty scene. The origin is where the first entity somebody adds will
    // be, so it is the one place worth looking.
    expect(framing(null, 1)).toEqual({ scale: 1, focus: { x: 0, y: 0 } })
  })
})

describe('rectangles', () => {
  it('inverts a drawn rectangle back into scene units', () => {
    const camera: Camera = { scale: 2, focus: { x: 0, y: 0 } }
    const scene = { x: 10, y: 20, width: 30, height: 40 }

    const topLeft = toScreenPoint({ x: scene.x, y: scene.y + scene.height }, camera, CANVAS)
    const screen = { x: topLeft.x, y: topLeft.y, width: scene.width * 2, height: scene.height * 2 }

    const back = toSceneRect(screen, camera, CANVAS)
    expect(back.x).toBeCloseTo(scene.x, 9)
    expect(back.y).toBeCloseTo(scene.y, 9)
    expect(back.width).toBeCloseTo(scene.width, 9)
    expect(back.height).toBeCloseTo(scene.height, 9)
  })

  it('covers both when united', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    const b = { x: 90, y: -20, width: 10, height: 5 }

    expect(union(a, b)).toEqual({ x: 0, y: -20, width: 100, height: 30 })
  })

  it('knows what is on the canvas and what has gone', () => {
    expect(isOnScreen({ x: 10, y: 10, width: 20, height: 20 }, CANVAS)).toBe(true)
    // Straddling an edge still counts: part of it is there to be seen.
    expect(isOnScreen({ x: -10, y: -10, width: 20, height: 20 }, CANVAS)).toBe(true)
    expect(isOnScreen({ x: -40, y: 10, width: 20, height: 20 }, CANVAS)).toBe(false)
    expect(isOnScreen({ x: 10, y: 900, width: 20, height: 20 }, CANVAS)).toBe(false)
  })
})

describe('snapping the camera to the pixel grid', () => {
  it('puts the origin on a whole device pixel', () => {
    for (const pixelRatio of [1, 2]) {
      const snapped = snapCamera(AWKWARD, CANVAS, pixelRatio)
      const origin = toScreenPoint({ x: 0, y: 0 }, snapped, CANVAS)

      expect(Number.isInteger(origin.x * pixelRatio)).toBe(true)
      expect(Number.isInteger(origin.y * pixelRatio)).toBe(true)
    }
  })

  it('moves the view by less than a pixel', () => {
    const snapped = snapCamera(AWKWARD, CANVAS, 1)
    const before = toScreenPoint({ x: 500, y: 500 }, AWKWARD, CANVAS)
    const after = toScreenPoint({ x: 500, y: 500 }, snapped, CANVAS)

    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5)
  })

  it('leaves every distance between two points exact', () => {
    // The property the whole approach rests on. Rounding each sprite where it
    // is drawn would keep the art equally crisp and break this, and what breaks
    // with it is framing: a level measured at 1× would come out a different
    // size from the same level measured at 4×, so pressing the frame key twice
    // could give two different zooms.
    for (const scale of [1, 2, 8]) {
      const camera = snapCamera({ scale, focus: { x: 137.25, y: -42.5 } }, CANVAS, 1)
      const near = toScreenPoint({ x: 10, y: 0 }, camera, CANVAS)
      const far = toScreenPoint({ x: 210, y: 0 }, camera, CANVAS)

      expect(far.x - near.x).toBeCloseTo(200 * scale, 9)
    }
  })

  it('is exactly invertible, so what was drawn measures back to where it came from', () => {
    const camera = snapCamera(AWKWARD, CANVAS, 1)
    const rect = { x: 12.5, y: -8.25, width: 300, height: 190 }

    const topLeft = toScreenPoint({ x: rect.x, y: rect.y + rect.height }, camera, CANVAS)
    const screen = {
      x: topLeft.x,
      y: topLeft.y,
      width: rect.width * camera.scale,
      height: rect.height * camera.scale,
    }

    const back = toSceneRect(screen, camera, CANVAS)
    expect(back.x).toBeCloseTo(rect.x, 9)
    expect(back.y).toBeCloseTo(rect.y, 9)
    expect(back.width).toBeCloseTo(rect.width, 9)
    expect(back.height).toBeCloseTo(rect.height, 9)
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

describe('clamping a game-asked focus to what there is to see', () => {
  // A level 1024 wide and 304 tall, seen through a 320x304 window at 1x.
  const content = { x: 0, y: 0, width: 1024, height: 304 }
  const canvas: Size = { width: 320, height: 304 }

  it('leaves a focus alone while the view it implies stays inside the content', () => {
    expect(clampFocus({ x: 500, y: 152 }, content, canvas, 1)).toEqual({ x: 500, y: 152 })
  })

  it('holds the view at the edge when the ask would show past it', () => {
    expect(clampFocus({ x: 10, y: 152 }, content, canvas, 1)).toEqual({ x: 160, y: 152 })
    expect(clampFocus({ x: 2000, y: 152 }, content, canvas, 1)).toEqual({ x: 864, y: 152 })
    expect(clampFocus({ x: 500, y: 9999 }, content, canvas, 1)).toEqual({ x: 500, y: 152 })
  })

  it('accounts for the scale, because the view is canvas pixels over it', () => {
    // At 2x the window spans half as many scene units, so the clamp is looser.
    expect(clampFocus({ x: 80, y: 152 }, content, canvas, 2)).toEqual({ x: 80, y: 152 })
    expect(clampFocus({ x: 10, y: 152 }, content, canvas, 2)).toEqual({ x: 80, y: 152 })
  })

  it('centres on an axis the content cannot fill, rather than jittering between its edges', () => {
    const narrow = { x: 100, y: 0, width: 50, height: 304 }
    expect(clampFocus({ x: 0, y: 152 }, narrow, canvas, 1)).toEqual({ x: 125, y: 152 })
    expect(clampFocus({ x: 999, y: 152 }, narrow, canvas, 1)).toEqual({ x: 125, y: 152 })
  })

  it('clamps nothing when there is no content to hold to', () => {
    expect(clampFocus({ x: -500, y: 9000 }, null, canvas, 1)).toEqual({ x: -500, y: 9000 })
  })
})

describe('pinning to the screen', () => {
  const canvas: Size = { width: 400, height: 300 }
  const zoomed: Camera = { scale: 2, focus: { x: 9999, y: -9999 } }

  it('places the top-right anchor at the top-right pixel, whatever the camera looks at', () => {
    expect(toPinnedScreenPoint({ x: 0, y: 0 }, { x: 1, y: 1 }, zoomed, canvas)).toEqual({ x: 400, y: 0 })
    expect(toPinnedScreenPoint({ x: 0, y: 0 }, { x: 0, y: 0 }, zoomed, canvas)).toEqual({ x: 0, y: 300 })
    expect(toPinnedScreenPoint({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, zoomed, canvas)).toEqual({ x: 200, y: 150 })
  })

  it('measures the offset in scene units at the camera scale, y up', () => {
    // Eight units in and eight down from the top-right corner, at 2x: sixteen pixels each.
    expect(toPinnedScreenPoint({ x: -8, y: -8 }, { x: 1, y: 1 }, zoomed, canvas)).toEqual({ x: 384, y: 16 })
  })

  it('round-trips through its inverse', () => {
    const offset = { x: -13.5, y: 7 }
    const anchor = { x: 1, y: 0.5 }
    const there = toPinnedScreenPoint(offset, anchor, zoomed, canvas)
    const back = toPinnedOffset(there, anchor, zoomed, canvas)
    expect(back.x).toBeCloseTo(offset.x, 10)
    expect(back.y).toBeCloseTo(offset.y, 10)
  })
})
