import { describe, expect, it } from 'vitest'

import {
  DEAD_RADIUS,
  angleFrom,
  pivotOf,
  shortestTurn,
  tooNear,
  turnAbout,
  type Turned,
} from '../../editor/shell/rotate'

/**
 * Turning entities about a pivot, as arithmetic.
 *
 * This file exists because the browser suite can only *sample* a rotation — it
 * drags the mouse somewhere and checks the number moved — while the ways this
 * can be wrong are all specific and all silent. Three of them fail no test that
 * is not written for them on purpose:
 *
 *   - **the sign**, which turns everything the wrong way and is otherwise
 *     indistinguishable from a correct implementation being dragged the other
 *     way;
 *   - **orbiting without spinning** (or the reverse), which passes any test that
 *     only looks at positions;
 *   - **accumulating rather than measuring**, which is exactly right for one
 *     step and drifts over a long turn.
 *
 * So each of those gets a test that fails for it and for nothing else.
 */

/** Positions are rounded to three decimals on the way out (`snap.ts`'s `freely`). */
const CLOSE = 3

function at(x: number, y: number, rotation = 0, id = 'e'): Turned {
  return { id, x, y, rotation }
}

describe('the pivot', () => {
  it('of one entity is that entity, so turning one thing needs no special case', () => {
    expect(pivotOf([at(40, 25)])).toEqual({ x: 40, y: 25 })
  })

  it('of several is the mean of their positions', () => {
    expect(pivotOf([at(0, 0), at(10, 0), at(20, 30)])).toEqual({ x: 10, y: 10 })
  })

  /**
   * The mean of the *positions*, never the middle of the box they cover. Two
   * sprites of very different sizes have a bounding box centred nearer the big
   * one, which is not what "turn these around their middle" means.
   */
  it('ignores how big anything is, because it is only given positions', () => {
    expect(pivotOf([at(0, 0), at(100, 0)])).toEqual({ x: 50, y: 0 })
  })

  it('is nothing at all when nothing is selected', () => {
    expect(pivotOf([])).toBeNull()
  })
})

describe('turning one entity', () => {
  it('leaves it exactly where it is, because it is its own pivot', () => {
    const one = at(40, 25, 10)
    const [turned] = turnAbout([one], { x: 40, y: 25 }, 90)

    expect(turned?.x).toBeCloseTo(40, CLOSE)
    expect(turned?.y).toBeCloseTo(25, CLOSE)
    expect(turned?.rotation).toBeCloseTo(100, CLOSE)
  })

  it('adds to the rotation it already had rather than replacing it', () => {
    const [turned] = turnAbout([at(0, 0, 30)], { x: 0, y: 0 }, 45)
    expect(turned?.rotation).toBeCloseTo(75, CLOSE)
  })
})

describe('turning a group', () => {
  /**
   * The one that catches an implementation doing only half the job. A group
   * that orbits without spinning lands every position correctly and leaves
   * every sprite upright — so the positions are asserted *and* the rotations
   * are, in the same test, because separating them is what lets half of it pass.
   */
  it('swings them round the pivot and turns each one by the same amount', () => {
    const row = [at(0, 0, 0, 'a'), at(10, 0, 0, 'b'), at(20, 0, 0, 'c')]
    const turned = turnAbout(row, { x: 10, y: 0 }, 90)

    // A quarter turn counter-clockwise takes a row along x to a column along y.
    expect(turned[0]?.x).toBeCloseTo(10, CLOSE)
    expect(turned[0]?.y).toBeCloseTo(-10, CLOSE)
    expect(turned[1]?.x).toBeCloseTo(10, CLOSE)
    expect(turned[1]?.y).toBeCloseTo(0, CLOSE)
    expect(turned[2]?.x).toBeCloseTo(10, CLOSE)
    expect(turned[2]?.y).toBeCloseTo(10, CLOSE)

    // And every one of them is turned, not merely moved.
    for (const one of turned) expect(one?.rotation).toBeCloseTo(90, CLOSE)
  })

  /**
   * Rigid means distances survive. This is the property that would break first
   * if positions were snapped to the pixel grid during a rotation — which is why
   * they deliberately are not.
   */
  it('keeps every entity the same distance from every other', () => {
    const group = [at(0, 0, 0, 'a'), at(30, 0, 0, 'b'), at(0, 40, 0, 'c')]
    const pivot = pivotOf(group)
    const turned = turnAbout(group, pivot ?? { x: 0, y: 0 }, 37.5)

    const span = (from: Turned, to: Turned): number => Math.hypot(to.x - from.x, to.y - from.y)
    expect(span(turned[0] as Turned, turned[1] as Turned)).toBeCloseTo(30, 2)
    expect(span(turned[0] as Turned, turned[2] as Turned)).toBeCloseTo(40, 2)
    expect(span(turned[1] as Turned, turned[2] as Turned)).toBeCloseTo(50, 2)
  })

  /**
   * A full circle is the identity — which it can only be if the angle is
   * measured from the start rather than accumulated. An implementation adding up
   * per-frame deltas passes every other test here and fails this one by a
   * fraction that grows with how long the turn took.
   */
  it('comes back exactly where it started after a full turn', () => {
    const group = [at(3, 7, 12, 'a'), at(-11, 4, 0, 'b')]
    const pivot = pivotOf(group)
    const turned = turnAbout(group, pivot ?? { x: 0, y: 0 }, 360)

    expect(turned[0]?.x).toBeCloseTo(3, CLOSE)
    expect(turned[0]?.y).toBeCloseTo(7, CLOSE)
    expect(turned[1]?.x).toBeCloseTo(-11, CLOSE)
    expect(turned[1]?.y).toBeCloseTo(4, CLOSE)
    // The rotation is 360 further round, which is the same facing and a
    // different number — deliberately not normalised, because the human asked
    // for a full turn and the file should say so.
    expect(turned[0]?.rotation).toBeCloseTo(372, CLOSE)
  })

  it('does nothing at all for an angle of zero', () => {
    const group = [at(3, 7, 12, 'a'), at(-11, 4, 5, 'b')]
    expect(turnAbout(group, { x: 0, y: 0 }, 0)).toEqual(group)
  })
})

/**
 * The sign, on its own, because it is the failure that looks like the feature
 * working backwards rather than like arithmetic.
 *
 * Scene space is y-up and rotation is counter-clockwise; screen space is y-down.
 * `angleFrom` is the single place that flip happens, so it is the single place
 * worth pinning down.
 */
describe('the bearing from pivot to pointer', () => {
  it('reads a pointer to the right as zero', () => {
    expect(angleFrom({ x: 100, y: 100 }, { x: 200, y: 100 })).toBeCloseTo(0, CLOSE)
  })

  /**
   * The load-bearing one. **Up the screen is a smaller y**, and it must come out
   * as +90° — a positive, counter-clockwise scene rotation. An implementation
   * that forgot the flip answers −90 and every sprite in the editor turns the
   * wrong way.
   */
  it('reads a pointer above as a positive quarter turn', () => {
    expect(angleFrom({ x: 100, y: 100 }, { x: 100, y: 40 })).toBeCloseTo(90, CLOSE)
  })

  it('reads a pointer below as a negative quarter turn', () => {
    expect(angleFrom({ x: 100, y: 100 }, { x: 100, y: 160 })).toBeCloseTo(-90, CLOSE)
  })

  /**
   * And the whole gesture, end to end: dragging the pointer anticlockwise on
   * screen turns the entity anticlockwise in the level. This is the assertion
   * that would still hold if somebody negated `angleFrom` *and* the subtraction,
   * so it is here alongside the one above rather than instead of it.
   */
  it('turns an entity the same way the hand went', () => {
    const pivot = { x: 100, y: 100 }
    const started = angleFrom(pivot, { x: 200, y: 100 })
    const swept = angleFrom(pivot, { x: 100, y: 40 }) - started

    expect(swept).toBeCloseTo(90, CLOSE)
    const [turned] = turnAbout([at(10, 0)], { x: 0, y: 0 }, swept)
    // The entity was to the right of its pivot; a quarter turn the way the hand
    // went puts it above, which in a y-up level is a larger y.
    expect(turned?.y).toBeCloseTo(10, CLOSE)
    expect(turned?.x).toBeCloseTo(0, CLOSE)
  })
})

describe('the dead zone around the pivot', () => {
  /**
   * On the pivot itself `atan2(0, 0)` is zero by convention rather than by
   * meaning, and a pixel of noise a pixel away swings the bearing through tens
   * of degrees. Without this, crossing the middle of a sprite on the way
   * somewhere spins it.
   */
  it('catches a pointer sitting on the pivot', () => {
    expect(tooNear({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true)
    expect(tooNear({ x: 100, y: 100 }, { x: 100 + DEAD_RADIUS - 1, y: 100 })).toBe(true)
  })

  it('lets go once the pointer is far enough out to mean something', () => {
    expect(tooNear({ x: 100, y: 100 }, { x: 100 + DEAD_RADIUS + 1, y: 100 })).toBe(false)
  })
})

describe('what the caption says', () => {
  it('writes a turn the short way round', () => {
    expect(shortestTurn(45)).toBe(45)
    expect(shortestTurn(-45)).toBe(-45)
    expect(shortestTurn(370)).toBe(10)
    expect(shortestTurn(-370)).toBe(-10)
  })

  /** Three times round is somewhere, not 1080° of somewhere. */
  it('does not report how many times round the hand went', () => {
    expect(shortestTurn(1080)).toBe(0)
    expect(shortestTurn(1125)).toBe(45)
  })

  /** A half turn reads as 180, never as -180 — both are true and one is odd. */
  it('prefers 180 to minus 180', () => {
    expect(shortestTurn(180)).toBe(180)
    expect(shortestTurn(-180)).toBe(180)
  })
})
