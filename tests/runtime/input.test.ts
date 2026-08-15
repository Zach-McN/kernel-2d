import { describe, expect, it } from 'vitest'

import { defaultEntity, type Entity } from '../../runtime/formats/scene-schema'
import { clickedIn, heldIn, inputEntity, pressedIn, writeInput } from '../../runtime/game/input'
import { STEP_MS } from '../../runtime/game/loop'
import { runLevel } from '../../runtime/game/run-level'
import type { System } from '../../runtime/game/system'

/**
 * Input as data in the running level.
 *
 * The carrier is an ordinary entity, so half of these tests need no runner at
 * all — a fixture list with `inputEntity([...])` in it *is* a level that was
 * pressed, which is the whole point of the shape. The other half prove the
 * runner's end of the bargain: a press reaches exactly one step, however the
 * frames fall.
 */

/** The same hand-cranked frames as `run-level.test.ts`. */
function handCrankedFrames(): {
  onFrame: (tick: (elapsedMs: number) => void) => () => void
  frame: (elapsedMs: number) => void
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
  }
}

/** Records what every step saw pressed. */
function listener(): { system: System; heard: string[][] } {
  const heard: string[][] = []
  return {
    heard,
    system: {
      id: 'listener',
      step: (entities) => {
        heard.push([...pressedIn(entities)])
      },
    },
  }
}

describe('reading input off a level', () => {
  it('answers what the carrier holds', () => {
    expect(pressedIn([inputEntity(['Space', 'KeyW'])])).toEqual(['Space', 'KeyW'])
  })

  it('answers nothing when no carrier is in the level', () => {
    expect(pressedIn([defaultEntity('abc123', 'Slime')])).toEqual([])
  })

  it('answers nothing for a carrier somebody mangled', () => {
    const mangled = inputEntity()
    mangled.components['input'] = { pressed: 'Space' }
    expect(pressedIn([mangled])).toEqual([])
  })

  it('replaces rather than appends when written to, because a press belongs to one step', () => {
    const carrier = inputEntity(['Space'])
    writeInput(carrier, { pressed: ['KeyA'], clicked: [] })
    expect(pressedIn([carrier])).toEqual(['KeyA'])
  })

  it('answers the clicks the carrier holds, in scene units as given', () => {
    expect(clickedIn([inputEntity([], [{ x: 120, y: 56 }])])).toEqual([{ x: 120, y: 56 }])
  })

  it('answers no clicks for a carrier somebody mangled', () => {
    const mangled = inputEntity()
    mangled.components['input'] = { clicked: [{ x: 'here' }] }
    expect(clickedIn([mangled])).toEqual([])
  })

  it('answers the held codes the carrier holds', () => {
    expect(heldIn([inputEntity([], [], ['ArrowRight', 'ShiftLeft'])])).toEqual(['ArrowRight', 'ShiftLeft'])
  })

  it('answers nothing held for a sample that says nothing about holding', () => {
    const carrier = inputEntity(['Space'])
    writeInput(carrier, { pressed: ['Space'], clicked: [] })
    expect(heldIn([carrier])).toEqual([])
  })

  it('replaces held state when written to, exactly as it replaces presses', () => {
    const carrier = inputEntity([], [], ['ArrowRight'])
    writeInput(carrier, { pressed: [], clicked: [], held: ['ArrowLeft'] })
    expect(heldIn([carrier])).toEqual(['ArrowLeft'])
  })
})

describe('the runner feeding input', () => {
  it('hands a press to exactly one step', () => {
    const frames = handCrankedFrames()
    const ears = listener()
    let queued: string[] = ['Space']

    runLevel({
      entities: [],
      systems: [ears.system],
      onFrame: frames.onFrame,
      draw: () => {},
      input: () => {
        const pressed = queued
        queued = []
        return { pressed, clicked: [] }
      },
    })

    frames.frame(STEP_MS)
    frames.frame(STEP_MS)
    frames.frame(STEP_MS)

    expect(ears.heard).toEqual([['Space'], [], []])
  })

  it('hands a press to the first step of a catching-up frame, not to all of them', () => {
    const frames = handCrankedFrames()
    const ears = listener()

    runLevel({
      entities: [],
      systems: [ears.system],
      onFrame: frames.onFrame,
      draw: () => {},
      input: () => ({ pressed: ['Space'], clicked: [] }),
    })

    // One big frame buys three steps (plus a millisecond so float rounding
    // cannot leave the third a hair short). The source above always answers
    // Space, but it is asked once per draining step — so one batch, first step.
    frames.frame(STEP_MS * 3 + 1)

    expect(ears.heard).toEqual([['Space'], [], []])
  })

  it('keeps held state for every step of a catching-up frame, while the press stays with the first', () => {
    const frames = handCrankedFrames()
    const seen: { pressed: string[]; held: string[] }[] = []
    const ears: System = {
      id: 'ears',
      step: (entities) => {
        seen.push({ pressed: [...pressedIn(entities)], held: [...heldIn(entities)] })
      },
    }

    runLevel({
      entities: [],
      systems: [ears],
      onFrame: frames.onFrame,
      draw: () => {},
      input: () => ({ pressed: ['Space'], clicked: [], held: ['ArrowRight'] }),
    })

    // One big frame buys three steps. The press belongs to the first; the held
    // key is state and is true of all three — a player holding right through a
    // hitch did not let go three times.
    frames.frame(STEP_MS * 3 + 1)

    expect(seen).toEqual([
      { pressed: ['Space'], held: ['ArrowRight'] },
      { pressed: [], held: ['ArrowRight'] },
      { pressed: [], held: ['ArrowRight'] },
    ])
  })

  it('injects no carrier when there is no input source', () => {
    const frames = handCrankedFrames()
    const level = runLevel({
      entities: [defaultEntity('abc123', 'Slime')],
      systems: [],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    frames.frame(STEP_MS)

    expect(level.state().entities.map((one: Entity) => one.id)).toEqual(['abc123'])
  })

  it('never lets the carrier reach the caller\'s list', () => {
    const original = [defaultEntity('abc123', 'Slime')]
    const frames = handCrankedFrames()

    runLevel({
      entities: original,
      systems: [],
      onFrame: frames.onFrame,
      draw: () => {},
      input: () => ({ pressed: [], clicked: [] }),
    })
    frames.frame(STEP_MS)

    expect(original).toHaveLength(1)
  })
})
