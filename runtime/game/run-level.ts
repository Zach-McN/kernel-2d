import type { Entity } from '../formats/scene-schema.js'
import { createLoop, type LoopOptions } from './loop.js'
import { stepSystems, type System } from './system.js'

/**
 * A level, running.
 *
 * The glue between the three things that are each simple on their own: a copy of
 * the level, a fixed-step clock, and a list of systems. It owns no timer, no
 * renderer and no files — where frames come from and what to do with the result
 * both arrive as plain functions, which is what lets the whole of this be driven
 * by a clock a test moves by hand, in Node, with no browser (`editor-kernel`
 * D26's seam, applied to time instead of to files).
 *
 * **The running level is a copy, and that is the load-bearing sentence.** The
 * entities a system mutates were deep-copied when the run started, so nothing a
 * system does can reach the file the level was read from, the editor's document
 * store, or the undo stack. Three guarantees fall out of one line rather than
 * being arranged for by three pieces of care:
 *
 *   - pressing Stop puts everything back exactly as the file has it, because
 *     nothing else ever changed;
 *   - a running level writes nothing, because the only thing it can write to is
 *     an object that is about to be thrown away;
 *   - the editor's own picture of the level carries on being maintained behind
 *     the running one, so Stop has nothing to rebuild.
 *
 * The copy goes through JSON rather than `structuredClone`, for the reason
 * `copyEntity` gives: an entity *is* a JSON document, so the round trip is
 * faithful by construction, and `structuredClone` throws on the immer draft the
 * editor may be holding — a failure that only appears when Play is pressed
 * mid-edit.
 *
 * **Redrawing happens when the simulation moved, not once per frame.** A 144Hz
 * display buys no steps on most frames, and drawing the same positions again
 * would be work with nothing to show for it.
 */

export interface RunState {
  /** Steps run since the level started. */
  steps: number
  /** Simulated time in milliseconds — steps times the step size, never the wall clock. */
  elapsedMs: number
  /** The level as it is now. The live array, not a copy: read it, do not keep it. */
  entities: readonly Entity[]
}

export interface RunLevelOptions {
  /**
   * The level to run. **Copied, never mutated** — the caller may carry on
   * holding, drawing and comparing against this exact list.
   */
  entities: readonly Entity[]
  /** In order. Nothing moves when this is empty, which is a case worth being able to ask for. */
  systems: readonly System[]
  /**
   * Subscribes to frames, answering with the way to unsubscribe. In a browser
   * this is the engine's own ticker; in a test it is a function that keeps the
   * callback and calls it on demand.
   */
  onFrame: (tick: (elapsedMs: number) => void) => () => void
  /** Draws the level as it is now. Called only on a frame where at least one step ran. */
  draw: (entities: readonly Entity[]) => void
  /**
   * Told how the run is going, no more often than `notifyEveryMs` of simulated
   * time. Optional, because a shipped game has nobody to tell.
   */
  watch?: (state: RunState) => void
  /**
   * How often a watcher hears about the run, in milliseconds of simulated time.
   *
   * **Ten times a second, not sixty**, and the gap is the decision. The picture
   * is drawn every frame by the runtime; a watcher is something being *told
   * about* the picture — the editor putting a caption or a test hook on a panel —
   * and a React render per frame would be the editor driving the game rather than
   * describing it. Ten is above the rate a human reads a changing number at and
   * an order of magnitude below the rate that would cost anything.
   */
  notifyEveryMs?: number
  loop?: LoopOptions
}

export interface RunningLevel {
  /** Unsubscribes from frames. Safe to call twice; the copy is simply dropped. */
  stop: () => void
  /** The current state, for a caller that would rather ask than be told. */
  state: () => RunState
}

/** Ten times a second. See `notifyEveryMs`. */
export const NOTIFY_EVERY_MS = 100

export function runLevel(options: RunLevelOptions): RunningLevel {
  const entities = copyEntities(options.entities)
  const loop = createLoop(options.loop ?? {})
  const notifyEveryMs = options.notifyEveryMs ?? NOTIFY_EVERY_MS

  const state = (): RunState => ({ steps: loop.steps, elapsedMs: loop.elapsedMs, entities })

  /** Simulated time at the last notification, or null before the first one. */
  let notifiedAtMs: number | null = null
  let running = true

  const unsubscribe = options.onFrame((frameMs) => {
    if (!running) return

    const ran = loop.advance(frameMs, (dtSeconds) => {
      stepSystems(options.systems, entities, dtSeconds)
    })

    // Nothing moved, so there is nothing to draw and nothing to say. This is the
    // ordinary case on a display faster than the step rate.
    if (ran === 0) return

    options.draw(entities)

    const watch = options.watch
    if (watch === undefined) return
    // The first step always reports, so a watcher hears that the level is moving
    // at the moment it starts rather than a tenth of a second later.
    if (notifiedAtMs !== null && loop.elapsedMs - notifiedAtMs < notifyEveryMs) return
    notifiedAtMs = loop.elapsedMs
    watch(state())
  })

  return {
    stop: () => {
      if (!running) return
      running = false
      unsubscribe()
    },
    state,
  }
}

/**
 * A deep copy of the level's entities.
 *
 * Deep rather than a copy of the list: a shallow copy would share every
 * transform object with the caller, so the first step a system took would move
 * the level the editor is holding — silently, and only while a level happened to
 * be running.
 */
function copyEntities(entities: readonly Entity[]): Entity[] {
  return JSON.parse(JSON.stringify(entities)) as Entity[]
}
