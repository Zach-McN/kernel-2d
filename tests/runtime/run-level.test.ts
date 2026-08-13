import { describe, expect, it } from 'vitest'

import { defaultEntity, type Entity } from '../../runtime/formats/scene-schema'
import { STEP_MS } from '../../runtime/game/loop'
import { runLevel, type RunState } from '../../runtime/game/run-level'
import { spinSystem } from '../../runtime/game/systems/index'
import type { System } from '../../runtime/game/system'

/**
 * A level running, with the browser taken out of it.
 *
 * Frames arrive because this file says so, and drawing is a function that
 * records what it was handed — which is what makes "the running level is a copy"
 * something a test can assert rather than something a comment claims. That
 * assertion is the one this file exists for: everything play mode promises about
 * files, undo and Stop rests on it, and none of those promises is testable at
 * this layer. This is.
 */

/** A frame source a test drives by hand, standing in for the engine's ticker. */
function handCrankedFrames(): {
  onFrame: (tick: (elapsedMs: number) => void) => () => void
  frame: (elapsedMs: number) => void
  subscribers: () => number
} {
  const ticks = new Set<(elapsedMs: number) => void>()

  return {
    onFrame: (tick) => {
      ticks.add(tick)
      return () => ticks.delete(tick)
    },
    frame: (elapsedMs) => {
      for (const tick of [...ticks]) tick(elapsedMs)
    },
    subscribers: () => ticks.size,
  }
}

function spinner(id: string, degreesPerSecond: number): Entity {
  const entity = defaultEntity(id, 'Spinner')
  entity.components['spin'] = { degreesPerSecond }
  return entity
}

describe('the running level is a copy', () => {
  it('never touches the entities it was given, however long it runs', () => {
    const original = [spinner('a', 90)]
    const before = JSON.stringify(original)
    const frames = handCrankedFrames()

    runLevel({
      entities: original,
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    for (let count = 0; count < 120; count += 1) frames.frame(STEP_MS)

    // Byte-for-byte, which is the same instrument the browser suite uses on the
    // file itself (`editor-verification` V25). If this ever fails, play mode is
    // editing the level it is playing.
    expect(JSON.stringify(original)).toBe(before)
  })

  it('does not share a transform with the caller, which a shallow copy would', () => {
    // The failure a shallow copy gives you: the list is new, every object in it
    // is not, and the first step moves the level the editor is holding.
    const original = [spinner('a', 90)]
    const frames = handCrankedFrames()

    const level = runLevel({
      entities: original,
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    frames.frame(STEP_MS * 60)

    expect(level.state().entities[0]?.transform.rotation).toBeGreaterThan(0)
    expect(original[0]?.transform.rotation).toBe(0)
  })

  it('hands the systems the copy, so what they change is what gets drawn', () => {
    const frames = handCrankedFrames()
    let drawn: readonly Entity[] = []

    const level = runLevel({
      entities: [spinner('a', 90)],
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: (entities) => {
        drawn = entities
      },
    })
    frames.frame(STEP_MS)

    expect(drawn).toBe(level.state().entities)
  })
})

describe('what a frame buys', () => {
  it('draws on a frame where something moved', () => {
    const frames = handCrankedFrames()
    let draws = 0

    runLevel({
      entities: [spinner('a', 90)],
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: () => {
        draws += 1
      },
    })
    frames.frame(STEP_MS)

    expect(draws).toBe(1)
  })

  it('draws nothing on a frame too short to buy a step', () => {
    // The ordinary case on a display faster than the step rate. Drawing the same
    // positions again would be work with nothing to show for it.
    const frames = handCrankedFrames()
    let draws = 0

    runLevel({
      entities: [spinner('a', 90)],
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: () => {
        draws += 1
      },
    })
    frames.frame(STEP_MS / 4)

    expect(draws).toBe(0)
  })

  it('draws once for a frame that bought several steps, not once per step', () => {
    const frames = handCrankedFrames()
    let draws = 0

    const level = runLevel({
      // A step size of its own: a sixtieth of a second is not exactly
      // representable, so `STEP_MS * 3` rounds down to something worth two
      // steps rather than three. Whole numbers keep this about drawing.
      loop: { stepMs: 10 },
      entities: [spinner('a', 90)],
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: () => {
        draws += 1
      },
    })
    frames.frame(30)

    expect(level.state().steps).toBe(3)
    expect(draws).toBe(1)
  })

  it('moves nothing when it has no systems', () => {
    const frames = handCrankedFrames()

    const level = runLevel({
      entities: [spinner('a', 90)],
      systems: [],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    frames.frame(STEP_MS * 60)

    expect(level.state().entities[0]?.transform.rotation).toBe(0)
  })
})

describe('being told how the run is going', () => {
  /** Runs a whole second of frames and collects every notification. */
  function secondOfFrames(notifyEveryMs?: number): RunState[] {
    const frames = handCrankedFrames()
    const heard: RunState[] = []

    runLevel({
      entities: [spinner('a', 90)],
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: () => {},
      watch: (state) => heard.push({ ...state }),
      ...(notifyEveryMs === undefined ? {} : { notifyEveryMs }),
    })
    for (let count = 0; count < 60; count += 1) frames.frame(STEP_MS)

    return heard
  }

  it('says so on the very first step, rather than a tenth of a second later', () => {
    expect(secondOfFrames()[0]?.steps).toBe(1)
  })

  it('says so about ten times a second, not sixty', () => {
    // The gap is the decision: the picture is drawn every frame and described
    // ten times a second, because describing is the editor's job and drawing is
    // the runtime's.
    const heard = secondOfFrames()

    expect(heard.length).toBeGreaterThanOrEqual(9)
    expect(heard.length).toBeLessThanOrEqual(11)
  })

  it('says so as often as it was asked to', () => {
    // A second of simulated time: one at the start, one half a second later.
    expect(secondOfFrames(500).length).toBe(2)
    expect(secondOfFrames(1000).length).toBe(1)
  })

  it('is not called at all when nobody is listening', () => {
    // A shipped game with no watcher must not pay for one, and a runner that
    // required one would be a runner shaped by the editor.
    const frames = handCrankedFrames()

    expect(() => {
      runLevel({
        entities: [spinner('a', 90)],
        systems: [spinSystem],
        onFrame: frames.onFrame,
        draw: () => {},
      })
      frames.frame(STEP_MS * 60)
    }).not.toThrow()
  })
})

describe('stopping', () => {
  it('unsubscribes, so nothing is stepped afterwards', () => {
    const frames = handCrankedFrames()

    const level = runLevel({
      entities: [spinner('a', 90)],
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    frames.frame(STEP_MS * 60)
    const stoppedAt = level.state().entities[0]?.transform.rotation

    level.stop()
    frames.frame(STEP_MS * 60)

    expect(level.state().entities[0]?.transform.rotation).toBe(stoppedAt)
    expect(frames.subscribers()).toBe(0)
  })

  it('can be stopped twice', () => {
    // React tears an effect down more than once in development, and a stop that
    // threw the second time would be a crash nobody could reproduce in a build.
    const frames = handCrankedFrames()
    const level = runLevel({
      entities: [spinner('a', 90)],
      systems: [spinSystem],
      onFrame: frames.onFrame,
      draw: () => {},
    })

    level.stop()
    expect(() => {
      level.stop()
    }).not.toThrow()
  })

  it('leaves a level that is stopped mid-frame alone', () => {
    /*
     * A system that stops its own level is not something the kernel does yet,
     * and the frame source has to survive it anyway: unsubscribing from inside
     * the callback being iterated is the classic way to lose the *next*
     * subscriber in the same set.
     */
    const frames = handCrankedFrames()
    let stopped = false
    let other = 0

    const stopper: System = {
      id: 'stopper',
      step: () => {
        if (!stopped) {
          stopped = true
          level.stop()
        }
      },
    }

    const level = runLevel({
      entities: [spinner('a', 90)],
      systems: [stopper],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    runLevel({
      entities: [spinner('b', 90)],
      systems: [{ id: 'counter', step: () => (other += 1) }],
      onFrame: frames.onFrame,
      draw: () => {},
    })

    frames.frame(STEP_MS)

    expect(other).toBe(1)
  })
})
