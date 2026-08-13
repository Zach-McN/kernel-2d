import { describe, expect, it } from 'vitest'

import { MAX_STEPS_PER_FRAME, STEP_MS, createLoop } from '../../runtime/game/loop'

/**
 * The clock, driven by hand.
 *
 * The whole reason the timing policy is arithmetic in a module of its own is
 * this file: there is no browser here, no renderer and no waiting. Frames are
 * handed over as numbers, and what a level would do over a minute is asserted in
 * a millisecond (`editor-verification` V16's instinct, applied to time itself).
 *
 * The three properties worth having are all about what happens when the frames
 * are *not* the size the display promised: a fast display buying no steps, a slow
 * one buying several, and a tab that was hidden for a minute handing back the
 * whole minute at once.
 */

/** Runs the loop and answers with the `dt` of every step it took. */
function stepsFor(loop: ReturnType<typeof createLoop>, frames: readonly number[]): number[] {
  const taken: number[] = []
  for (const frame of frames) loop.advance(frame, (dt) => taken.push(dt))
  return taken
}

describe('time is spent in whole steps', () => {
  it('takes one step per frame when the frames are the size of a step', () => {
    const loop = createLoop()
    expect(stepsFor(loop, Array.from({ length: 10 }, () => STEP_MS))).toHaveLength(10)
    expect(loop.steps).toBe(10)
  })

  it('hands every system the same delta, whatever the frame was', () => {
    // The point of a fixed step: a system's arithmetic does not depend on how
    // busy the browser was. Frames of wildly different sizes, one delta.
    const loop = createLoop()
    const deltas = new Set(stepsFor(loop, [16.7, 4, 40, 9, 33.3]))

    expect([...deltas]).toEqual([STEP_MS / 1000])
  })

  it('takes no step at all on a frame shorter than one, and carries the remainder', () => {
    /*
     * A display faster than the step rate: most frames buy nothing, and every so
     * often the carried remainder adds up to one. Whole numbers rather than a
     * third of `STEP_MS`, so the assertion is about the carrying rule and not
     * about which side of a float the third landed on.
     */
    const loop = createLoop({ stepMs: 12 })
    const taken = stepsFor(loop, Array.from({ length: 12 }, () => 4))

    // Twelve frames of four is forty-eight milliseconds, which is four whole
    // steps. Dropping each frame's leftovers instead would have taken none at
    // all, and the level would simply never move.
    expect(taken).toHaveLength(4)
    expect(loop.elapsedMs).toBe(48)
  })

  it('catches up across a slow frame', () => {
    /*
     * A step size of its own, and it is not tidiness. A sixtieth of a second is
     * not exactly representable, and `STEP_MS * 3` rounds to exactly 50 — which
     * is *less* than three steps, so it buys two. That is the accumulator being
     * right and the arithmetic being surprising, and it is a trap for any test
     * that builds a frame by multiplying the step size. Whole numbers here, so
     * the assertion is about catching up rather than about a float.
     */
    const loop = createLoop({ stepMs: 10 })
    expect(stepsFor(loop, [30])).toHaveLength(3)
  })

  it('reports simulated time rather than the time it was handed', () => {
    // A second of wall clock arriving in one frame, against a ceiling of five
    // steps. What a system has lived through is five steps, and this says so
    // instead of claiming the second.
    const loop = createLoop({ stepMs: 10, maxStepsPerFrame: 5 })
    loop.advance(1000, () => {})

    expect(loop.steps).toBe(5)
    expect(loop.elapsedMs).toBe(50)
  })
})

describe('a frame that is not a frame', () => {
  it.each([0, -16, -1000, NaN, Infinity])('buys nothing for an elapsed of %p', (elapsed) => {
    const loop = createLoop()
    expect(stepsFor(loop, [elapsed])).toEqual([])
    expect(loop.steps).toBe(0)
  })

  it('carries on normally after one', () => {
    // A clock that went backwards once — which a machine waking from sleep can
    // genuinely produce — must not poison the accumulator.
    const loop = createLoop()
    stepsFor(loop, [-500])

    expect(stepsFor(loop, [STEP_MS * 2])).toHaveLength(2)
  })
})

describe('a tab that was hidden for a minute', () => {
  it('runs at most the ceiling of steps in one frame', () => {
    const loop = createLoop()
    expect(stepsFor(loop, [60_000])).toHaveLength(MAX_STEPS_PER_FRAME)
  })

  it('does not spend the next frames replaying the backlog', () => {
    /*
     * The failure this is really about is the spiral: if the sixty seconds were
     * *carried*, every frame after it would run the maximum, the level would be
     * in slow motion for as long as it took to catch up, and each frame taking
     * longer would make the backlog worse. Dropped, the level is a minute behind
     * a wall clock nothing is reading and is immediately running at normal speed.
     */
    const loop = createLoop()
    stepsFor(loop, [60_000])

    expect(stepsFor(loop, [STEP_MS])).toHaveLength(1)
  })

  it('leaves an ordinary stutter absorbed rather than clamped', () => {
    // The ceiling has to sit above a hitch nobody would call a problem, or it
    // would be throwing time away on frames that are merely a bit late. Four
    // steps' worth, under a ceiling of five.
    const loop = createLoop({ stepMs: 10, maxStepsPerFrame: MAX_STEPS_PER_FRAME })
    expect(stepsFor(loop, [40])).toHaveLength(4)
  })
})

describe('the step size is the caller’s to choose', () => {
  it('runs at whatever rate it was made with', () => {
    // Not a feature anything uses yet — it is what lets a test assert on a
    // system's arithmetic at a rate that makes the numbers readable.
    const loop = createLoop({ stepMs: 100 })
    expect(stepsFor(loop, [1000])).toEqual([0.1, 0.1, 0.1, 0.1, 0.1])
  })

  it('takes its own ceiling', () => {
    const loop = createLoop({ stepMs: 10, maxStepsPerFrame: 2 })
    expect(stepsFor(loop, [1000])).toHaveLength(2)
  })
})
