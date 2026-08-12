import { describe, expect, it } from 'vitest'

// The exact modules rather than `runtime/index.ts`: the barrel re-exports the
// renderers, so reaching it here would boot Phaser inside a Node test run.
import { DEFAULT_CAMERA } from '../../runtime/scene/coordinates'
import type { DrawnEntity } from '../../runtime/scene/entity-layer'
import type { ShownScene } from '../../runtime/scene/scene-view'
import { PICK_TOLERANCE, entityAt, onScreen, screenRectOf } from '../../editor/shell/drawn-entities'

/**
 * What you can click, held to the one promise that makes picking trustworthy:
 * it is the same rectangle the selection outline draws.
 *
 * The failure this guards against is quiet. If picking were worked out from the
 * transforms rather than from the renderer's report, it would agree with the
 * outline almost always — and where it did not, the human would click a sprite
 * and select its neighbour, with nothing on screen saying which answer was
 * right.
 */

function entity(id: string, bounds: DrawnEntity['bounds'], origin = { x: 0, y: 0 }): DrawnEntity {
  return { id, origin, bounds }
}

/** A scene with these entities, in this order — which is back-to-front. */
function shown(entities: DrawnEntity[]): ShownScene {
  return {
    path: 'scenes/level-01.json',
    entities,
    sceneOrigin: { x: 0, y: 400 },
    canvasSize: { width: 800, height: 400 },
    camera: DEFAULT_CAMERA,
    contentBounds: null,
    undrawable: [],
  }
}

/** A ground strip and a character standing on it, overlapping between y 280 and 300. */
const GROUND = entity('ground', { x: 0, y: 280, width: 800, height: 100 })
const KNIGHT = entity('knight', { x: 100, y: 240, width: 60, height: 60 })

describe('what is under the pointer', () => {
  it('finds the entity whose rectangle contains the point', () => {
    expect(entityAt(shown([GROUND, KNIGHT]), { x: 130, y: 270 })).toBe('knight')
  })

  it('finds nothing where nothing was drawn', () => {
    expect(entityAt(shown([GROUND, KNIGHT]), { x: 400, y: 40 })).toBeNull()
  })

  it('picks the one in front where two overlap', () => {
    // List order is draw order, so the last one is on top — and the one on top
    // is the one the human was pointing at. Asserted both ways round, because
    // an implementation that simply returns the first match passes one of them.
    expect(entityAt(shown([GROUND, KNIGHT]), { x: 130, y: 290 })).toBe('knight')
    expect(entityAt(shown([KNIGHT, GROUND]), { x: 130, y: 290 })).toBe('ground')
  })

  it('counts the edges of the rectangle as being on it', () => {
    expect(entityAt(shown([KNIGHT]), { x: 100, y: 240 })).toBe('knight')
    expect(entityAt(shown([KNIGHT]), { x: 160, y: 300 })).toBe('knight')
    expect(entityAt(shown([KNIGHT]), { x: 99, y: 240 })).toBeNull()
  })

  it('is the same rectangle the outline is drawn from', () => {
    // Not a tautology while they are one function: it is the assertion that
    // fails the day somebody gives picking an opinion of its own.
    const rect = screenRectOf(KNIGHT)
    expect(entityAt(shown([KNIGHT]), { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })).toBe(
      'knight',
    )
  })

  it('finds nothing in an empty scene', () => {
    expect(entityAt(shown([]), { x: 10, y: 10 })).toBeNull()
  })
})

describe('an entity with nothing to draw', () => {
  const nowhere = entity('lost', null, { x: 200, y: 200 })

  it('can still be clicked, within a few pixels of where it is', () => {
    // Its texture is missing, so it has no picture — and if it could not be
    // picked at all it would be unreachable in the viewport for ever.
    expect(entityAt(shown([nowhere]), { x: 200, y: 200 })).toBe('lost')
    expect(entityAt(shown([nowhere]), { x: 200 + PICK_TOLERANCE, y: 200 })).toBe('lost')
  })

  it('is not clickable well away from it', () => {
    expect(entityAt(shown([nowhere]), { x: 200 + PICK_TOLERANCE + 1, y: 200 })).toBeNull()
  })

  it('does not make the sprites around it harder to hit', () => {
    // The tolerance is only ever given to a point. Growing every sprite's hit
    // area would make two that merely sit near each other overlap for picking,
    // and then which one you get stops matching what you see.
    const tight = entity('tight', { x: 0, y: 0, width: 10, height: 10 })
    expect(entityAt(shown([tight]), { x: 10 + 1, y: 5 })).toBeNull()
  })
})

describe('what is on the canvas', () => {
  it('counts what is inside and leaves out what has gone', () => {
    const away = entity('away', { x: -400, y: 0, width: 50, height: 50 })
    const visible = onScreen(shown([GROUND, KNIGHT, away]))

    expect(visible.count).toBe(2)
    expect([...visible.ids].sort()).toEqual(['ground', 'knight'])
  })

  it('uses the same rectangle picking does, so the two can never disagree', () => {
    // An entity that is off screen cannot be under the pointer either, whatever
    // point is asked about — which is only true while both read one rule.
    const away = entity('away', { x: -400, y: 0, width: 50, height: 50 })
    const scene = shown([away])

    expect(onScreen(scene).count).toBe(0)
    expect(entityAt(scene, { x: 10, y: 10 })).toBeNull()
  })
})
