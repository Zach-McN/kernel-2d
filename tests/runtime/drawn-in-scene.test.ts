import { describe, expect, it } from 'vitest'

import { snapCamera, toScreenPoint, type Camera, type Size } from '../../runtime/scene/coordinates'
import { inSceneUnits } from '../../runtime/scene/drawn-in-scene'
import type { DrawnEntity } from '../../runtime/scene/entity-layer'
import type { ShownScene } from '../../runtime/scene/scene-view'

/**
 * The picture, back in the level's own units.
 *
 * This is the instrument that makes "the folder I exported draws what the editor
 * drew" checkable: two windows of different sizes frame a level differently, so
 * every screen number differs and none of the differences is about whether the two
 * agree. In level units they agree exactly.
 *
 * The load-bearing test is the last one. Inverting through the camera that was
 * *asked* for, rather than the one the renderer actually drew with, is off by the
 * sub-pixel nudge that keeps pixel art crisp — at 8× that is an eighth of a level
 * unit, which is small enough to look like a rounding artefact and big enough to
 * fail a comparison. Nothing else in this file can tell the two apart, because in
 * every other test the two cameras are the same.
 *
 * Imported from the modules themselves rather than from `runtime/index.ts`: the
 * barrel pulls in the renderer and therefore Phaser, which needs a browser
 * (editor-kernel D16, second half).
 */

const CANVAS: Size = { width: 640, height: 360 }

function shown(entities: DrawnEntity[], camera: Camera, drawnWith = camera): ShownScene {
  return {
    path: 'scenes/level-01.json',
    entities,
    sceneOrigin: toScreenPoint({ x: 0, y: 0 }, drawnWith, CANVAS),
    canvasSize: CANVAS,
    camera,
    drawnWith,
    contentBounds: null,
    undrawable: [],
  }
}

/**
 * An entity as the renderer reports it: a screen position, and the screen rectangle
 * it covers. Built by projecting a level-unit position *forward*, so the test states
 * the level's numbers and the inversion has to get back to them.
 */
function drawnAt(
  id: string,
  scene: { x: number; y: number },
  size: { width: number; height: number },
  camera: Camera,
): DrawnEntity {
  const origin = toScreenPoint(scene, camera, CANVAS)
  return {
    id,
    origin,
    // A sprite pivoted at its feet: the bottom edge of the rectangle sits on the
    // entity's own position, and it is centred left to right.
    bounds: {
      x: origin.x - (size.width * camera.scale) / 2,
      y: origin.y - size.height * camera.scale,
      width: size.width * camera.scale,
      height: size.height * camera.scale,
    },
  }
}

describe('what the renderer drew, in the level’s units', () => {
  it('gives back the position the entity was drawn at', () => {
    const camera: Camera = { scale: 2, focus: { x: 100, y: 50 } }
    const report = inSceneUnits(shown([drawnAt('knight', { x: 120, y: 16 }, { width: 16, height: 16 }, camera)], camera))

    expect(report).toHaveLength(1)
    expect(report[0]?.id).toBe('knight')
    expect(report[0]?.x).toBeCloseTo(120, 6)
    expect(report[0]?.y).toBeCloseTo(16, 6)
  })

  it('gives back the rectangle in the level’s units, feet on the position', () => {
    const camera: Camera = { scale: 4, focus: { x: 0, y: 0 } }
    const report = inSceneUnits(shown([drawnAt('knight', { x: 100, y: 16 }, { width: 16, height: 16 }, camera)], camera))

    const bounds = report[0]?.bounds
    expect(bounds?.x).toBeCloseTo(92, 6)
    expect(bounds?.y).toBeCloseTo(16, 6)
    expect(bounds?.width).toBeCloseTo(16, 6)
    expect(bounds?.height).toBeCloseTo(16, 6)
  })

  it('is the same answer at every zoom, which is the whole point of it', () => {
    const scene = { x: 272, y: 16 }
    const size = { width: 64, height: 16 }

    const answers = [1 / 2, 1, 3, 8, 32].map((scale) => {
      const camera: Camera = { scale, focus: { x: 160, y: 100 } }
      return inSceneUnits(shown([drawnAt('strip', scene, size, camera)], camera))[0]
    })

    for (const answer of answers) {
      expect(answer?.x).toBeCloseTo(scene.x, 6)
      expect(answer?.y).toBeCloseTo(scene.y, 6)
      expect(answer?.bounds?.width).toBeCloseTo(size.width, 6)
      expect(answer?.bounds?.height).toBeCloseTo(size.height, 6)
    }
  })

  it('keeps an entity with nothing to draw, as a position with no rectangle', () => {
    const camera: Camera = { scale: 1, focus: { x: 0, y: 0 } }
    const missing: DrawnEntity = { id: 'ghost', origin: toScreenPoint({ x: 40, y: 8 }, camera, CANVAS), bounds: null }

    const report = inSceneUnits(shown([missing], camera))
    expect(report[0]?.bounds).toBeNull()
    expect(report[0]?.x).toBeCloseTo(40, 6)
    expect(report[0]?.y).toBeCloseTo(8, 6)
  })

  it('reports entities in the order they were drawn, which is the order they are in', () => {
    const camera: Camera = { scale: 1, focus: { x: 0, y: 0 } }
    const three = ['ground', 'knight', 'heart'].map((id) =>
      drawnAt(id, { x: 0, y: 0 }, { width: 16, height: 16 }, camera),
    )
    expect(inSceneUnits(shown(three, camera)).map((one) => one.id)).toEqual(['ground', 'knight', 'heart'])
  })

  /*
   * The one that earns its place.
   *
   * The renderer draws through a camera nudged onto the device pixel grid and
   * reports the camera it was *asked* for. An implementation that inverted through
   * the reported one passes every test above — in all of them the two cameras are
   * identical — and is wrong by a fraction of a level unit here, which is exactly
   * the size of difference that reads as noise rather than as a bug.
   */
  it('inverts through the camera that was drawn with, not the one that was asked for', () => {
    // A focus deliberately off the pixel grid, at a zoom where the nudge is a
    // visible fraction of a level unit.
    const asked: Camera = { scale: 8, focus: { x: 100.3, y: 50.7 } }
    const drawing = snapCamera(asked, CANVAS, 2)

    expect(drawing.focus.x).not.toBeCloseTo(asked.focus.x, 6)

    const entity = drawnAt('knight', { x: 100, y: 16 }, { width: 16, height: 16 }, drawing)
    const report = inSceneUnits(shown([entity], asked, drawing))

    expect(report[0]?.x).toBeCloseTo(100, 6)
    expect(report[0]?.y).toBeCloseTo(16, 6)

    // And the wrong inversion really would be wrong by enough to see: this is what
    // the assertion above is protecting against.
    const wrong = inSceneUnits(shown([entity], asked, asked))
    expect(Math.abs((wrong[0]?.x ?? 0) - 100)).toBeGreaterThan(0.001)
  })
})
