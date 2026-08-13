/**
 * Time, cut into steps of a fixed size.
 *
 * The whole of the kernel's timing policy, and it is deliberately arithmetic
 * rather than machinery: no Phaser, no DOM, no timer of its own. Something else
 * says how many milliseconds went by — in the browser that is the engine's own
 * ticker — and this decides how many steps of the simulation that buys.
 *
 * **The step is fixed, and that is a decision with three reasons.**
 *
 *   1. **A level plays the same way on every machine.** A variable delta makes
 *      the size of a step depend on how busy the browser was, so the same level
 *      run twice is two slightly different runs. That is tolerable for a
 *      spinning icon and not tolerable for anything a game is later built on —
 *      and changing it after there are systems written against it is a change to
 *      every one of them.
 *   2. **A system's arithmetic becomes exact.** Sixty steps is one second,
 *      whatever the frame rate, so a test can hand this a clock it moves itself
 *      and assert on the number rather than on a tolerance (`editor-verification`
 *      V16's pattern, one layer out).
 *   3. **A tab coming back from the background catches up rather than jumping.**
 *      A browser that was hidden for a minute hands back one enormous elapsed
 *      value, and a variable step would apply the whole minute in a single
 *      update — everything teleports. Whole steps plus a ceiling on how many of
 *      them run per frame turns that into a few frames of catching up and then
 *      normality.
 *
 * The cost, stated because it is real: time the ceiling discards is gone, so a
 * level that cannot keep up runs in slow motion rather than dropping frames of
 * simulation. That is the better failure for an editor — the alternative is the
 * spiral where each frame's backlog makes the next frame slower — and it is the
 * decision to revisit first if a game ever needs wall-clock fidelity.
 */

/** One sixtieth of a second, in milliseconds. The size of every step there is. */
export const STEP_MS = 1000 / 60

/**
 * The most steps one frame may run.
 *
 * Five is a twelfth of a second of catching up per frame: enough that an
 * ordinary hitch is absorbed invisibly, small enough that a minute in a
 * background tab does not lock the browser while it replays.
 */
export const MAX_STEPS_PER_FRAME = 5

export interface LoopOptions {
  stepMs?: number
  maxStepsPerFrame?: number
}

export interface Loop {
  /**
   * Hands over the time that has passed and runs whole steps with it.
   *
   * Answers how many ran, which is zero for most frames at a high refresh rate
   * and is what tells a caller whether anything is worth redrawing.
   */
  advance: (elapsedMs: number, step: (dtSeconds: number) => void) => number
  /** Simulated time, in milliseconds: steps run times the step size. Never the wall clock. */
  readonly elapsedMs: number
  /** How many steps have run since this loop was made. */
  readonly steps: number
}

export function createLoop(options: LoopOptions = {}): Loop {
  const stepMs = options.stepMs ?? STEP_MS
  const maxSteps = options.maxStepsPerFrame ?? MAX_STEPS_PER_FRAME
  const dtSeconds = stepMs / 1000

  /** Time handed over and not yet spent on a step. Always less than one step. */
  let carried = 0
  let steps = 0

  return {
    advance: (elapsedMs, step) => {
      // A frame that took no time, or a clock that went backwards — which a
      // browser waking from sleep can genuinely produce — buys no steps rather
      // than an argument about what a negative step would mean.
      if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0

      carried += elapsedMs

      let ran = 0
      while (carried >= stepMs && ran < maxSteps) {
        carried -= stepMs
        ran += 1
        steps += 1
        step(dtSeconds)
      }

      // Whatever is left after the ceiling is reached is dropped rather than
      // carried, or the backlog outlives the hitch that caused it and every
      // frame after it runs the maximum: the spiral this ceiling exists to
      // prevent, arrived at the long way round.
      if (carried >= stepMs) carried = 0

      return ran
    },

    get elapsedMs() {
      return steps * stepMs
    },

    get steps() {
      return steps
    },
  }
}
