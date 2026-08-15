import { describe, expect, it } from 'vitest'

import { pivotOf } from '../../editor/shell/rotate'
import {
  MIN_FACTOR,
  alongAxis,
  factorFrom,
  reachFrom,
  scaleAbout,
  writeFactor,
  type Scaled,
} from '../../editor/shell/scale'
import { SCALE_STEP, scaleOn } from '../../editor/shell/snap'

/**
 * Scaling entities about a pivot, as arithmetic.
 *
 * `rotate.test.ts`'s sibling and written for the same reason: the browser suite
 * can only *sample* a scale — it drags the mouse and checks a number moved —
 * while the ways this can be wrong are specific and silent. Four of them fail no
 * test that is not written for them on purpose:
 *
 *   - **growing without spreading** (or the reverse), which passes any test that
 *     only looks at sizes, exactly as orbiting-without-spinning does one gesture
 *     over;
 *   - **accumulating rather than measuring**, which is right for one step and
 *     wrong by a few percent after scaling out and back;
 *   - **the axis lock applying to the wrong component**, which looks like a
 *     working feature held the other way round;
 *   - **snapping the size rather than the factor**, which deforms a group of
 *     entities that started at different sizes and is invisible on one entity.
 */

/** Positions are rounded to three decimals on the way out (`snap.ts`'s `freely`). */
const CLOSE = 3

function sized(x: number, y: number, scaleX = 1, scaleY = 1, id = 'e'): Scaled {
  return { id, x, y, scaleX, scaleY }
}

describe('scaling a group about its pivot', () => {
  it('grows the entity and leaves one on the pivot exactly where it is', () => {
    const [only] = scaleAbout([sized(10, 20, 1, 1)], { x: 10, y: 20 }, { x: 2, y: 2 })

    expect(only?.x).toBeCloseTo(10, CLOSE)
    expect(only?.y).toBeCloseTo(20, CLOSE)
    expect(only?.scaleX).toBeCloseTo(2, CLOSE)
    expect(only?.scaleY).toBeCloseTo(2, CLOSE)
  })

  it('spreads them apart as well as growing them — a group scale is both halves', () => {
    const group = [sized(0, 0, 1, 1, 'a'), sized(10, 0, 1, 1, 'b')]
    const pivot = pivotOf(group.map((one) => ({ ...one, rotation: 0 })))
    expect(pivot).not.toBeNull()

    const scaled = scaleAbout(group, pivot ?? { x: 0, y: 0 }, { x: 2, y: 2 })

    // Twice as big, and twice as far apart. An implementation that only
    // multiplied the sizes passes every assertion about scaleX and fails these.
    expect(scaled[0]?.x).toBeCloseTo(-5, CLOSE)
    expect(scaled[1]?.x).toBeCloseTo(15, CLOSE)
    expect(scaled[0]?.scaleX).toBeCloseTo(2, CLOSE)
    expect(scaled[1]?.scaleX).toBeCloseTo(2, CLOSE)
  })

  it('is measured from the start, so out and back is exactly where it began', () => {
    const group = [sized(0, 0, 1, 1, 'a'), sized(10, 4, 2, 3, 'b')]
    const pivot = { x: 5, y: 2 }

    // Two applications of the *same remembered start*, which is how the gesture
    // works — never the second applied to the first.
    scaleAbout(group, pivot, { x: 3, y: 3 })
    const back = scaleAbout(group, pivot, { x: 1, y: 1 })

    expect(back[1]?.x).toBeCloseTo(10, CLOSE)
    expect(back[1]?.y).toBeCloseTo(4, CLOSE)
    expect(back[1]?.scaleX).toBeCloseTo(2, CLOSE)
    expect(back[1]?.scaleY).toBeCloseTo(3, CLOSE)
  })

  it('keeps a size a factor of 1 never touches, whatever the other axis does', () => {
    const [only] = scaleAbout([sized(0, 0, 1.5, 0.5)], { x: 0, y: 0 }, { x: 4, y: 1 })

    expect(only?.scaleX).toBeCloseTo(6, CLOSE)
    expect(only?.scaleY).toBeCloseTo(0.5, CLOSE)
  })

  it('multiplies the size it found rather than replacing it', () => {
    // The entity is already half-size; scaling by 2 makes it whole, not double.
    const [only] = scaleAbout([sized(0, 0, 0.5, 0.5)], { x: 0, y: 0 }, { x: 2, y: 2 })

    expect(only?.scaleX).toBeCloseTo(1, CLOSE)
  })
})

describe('the axis lock', () => {
  it('unlocked is the same factor twice', () => {
    expect(alongAxis(1.5, null)).toEqual({ x: 1.5, y: 1.5 })
  })

  it('X carries the factor and Y is left alone — and the other way round', () => {
    // The pair that catches the lock being applied to the wrong component,
    // which otherwise looks like a working feature held backwards.
    expect(alongAxis(1.5, 'x')).toEqual({ x: 1.5, y: 1 })
    expect(alongAxis(1.5, 'y')).toEqual({ x: 1, y: 1.5 })
  })
})

describe('the factor the pointer asks for', () => {
  it('is the ratio of the reaches, so half the distance is half the size', () => {
    expect(factorFrom(100, 50)).toBeCloseTo(0.5, CLOSE)
    expect(factorFrom(100, 200)).toBeCloseTo(2, CLOSE)
    expect(factorFrom(100, 100)).toBeCloseTo(1, CLOSE)
  })

  it('never reaches zero, so an entity cannot be scaled out of existence', () => {
    expect(factorFrom(100, 0)).toBe(MIN_FACTOR)
  })

  it('is 1 rather than an error when there is no distance to measure against', () => {
    expect(factorFrom(0, 40)).toBe(1)
  })

  it('is a plain distance, with no y-flip — unlike the turn it is twinned with', () => {
    expect(reachFrom({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, CLOSE)
    expect(reachFrom({ x: 0, y: 0 }, { x: 3, y: -4 })).toBeCloseTo(5, CLOSE)
  })
})

describe('the snap', () => {
  const on = { on: true, step: 1, offset: 0 }
  const off = { on: false, step: 1, offset: 0 }

  it('rounds the factor to a step of a tenth', () => {
    expect(scaleOn(1.17, on, false)).toBeCloseTo(1.2, CLOSE)
    expect(scaleOn(1.94, on, false)).toBeCloseTo(1.9, CLOSE)
  })

  it('leaves a locked axis at exactly 1, so the lock survives the grid', () => {
    expect(scaleOn(1, on, false)).toBe(1)
  })

  it('never rounds down to nothing', () => {
    expect(scaleOn(0.02, on, false)).toBeCloseTo(SCALE_STEP, CLOSE)
  })

  it('is inverted by Ctrl in both directions, like every other gesture', () => {
    // With the switch on, Ctrl scales freely...
    expect(scaleOn(1.17, on, true)).toBeCloseTo(1.17, CLOSE)
    // ...and with it off, Ctrl is what puts it on the steps.
    expect(scaleOn(1.17, off, true)).toBeCloseTo(1.2, CLOSE)
    expect(scaleOn(1.17, off, false)).toBeCloseTo(1.17, CLOSE)
  })
})

describe('what a caption says', () => {
  it('is two decimals, because a scale is read rather than typed', () => {
    expect(writeFactor(1.2467)).toBe('1.25')
    expect(writeFactor(1)).toBe('1.00')
  })
})
