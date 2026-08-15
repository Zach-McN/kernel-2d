import { describe, expect, it } from 'vitest'

import { defaultEntity, type Entity } from '../../runtime/formats/scene-schema'
import { STEP_MS } from '../../runtime/game/loop'
import { runLevel } from '../../runtime/game/run-level'
import { MAX_STANDING_CUES, SOUND_ENTITY_ID, playSound, soundIn, type SoundCue } from '../../runtime/game/sound'
import type { System } from '../../runtime/game/system'

/**
 * The sound seam: a system asks for notes, the host is handed them once, and
 * the ask never reaches the picture. Same shape as the camera's and the door's
 * suites — most of it needs no runner, because the ask is an ordinary entity.
 */

const BEEP: SoundCue = [{ from: 440, to: 880, seconds: 0.1, wave: 'square', volume: 0.2 }]
const THUD: SoundCue = [{ from: 130, to: 60, seconds: 0.09, wave: 'sine', volume: 0.5 }]

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

function noisy(cue: SoundCue): System {
  return {
    id: 'noisy',
    step: (entities) => {
      playSound(entities, cue)
    },
  }
}

describe('the ask as an entity', () => {
  it('reads back the cue that was asked for', () => {
    const entities: Entity[] = []
    playSound(entities, BEEP)
    expect(soundIn(entities)).toEqual([BEEP])
  })

  it('queues rather than replaces, because one step can make several noises', () => {
    const entities: Entity[] = []
    playSound(entities, BEEP)
    playSound(entities, THUD)
    expect(entities).toHaveLength(1)
    expect(soundIn(entities)).toEqual([BEEP, THUD])
  })

  it('answers nothing when nobody is asking', () => {
    expect(soundIn([defaultEntity('abc123', 'Slime')])).toEqual([])
  })

  it('drops a note that cannot be played, and a cue left with none of them', () => {
    const entities: Entity[] = []
    playSound(entities, BEEP)
    const standing = entities.find((one) => one.id === SOUND_ENTITY_ID)
    if (standing !== undefined) {
      standing.components['sound'] = {
        cues: [
          // A zero frequency: an exponential ramp cannot reach it, and a
          // browser throws rather than shrugging.
          [{ from: 0, to: 440, seconds: 0.1, wave: 'square', volume: 0.2 }],
          // A wave nothing has ever heard of, beside a note that is fine.
          [{ from: 300, to: 300, seconds: 0.1, wave: 'trumpet', volume: 0.2 }, ...BEEP],
          'not a cue at all',
        ],
      }
    }
    expect(soundIn(entities)).toEqual([BEEP])
  })

  it('keeps a flat note flat, and carries a delay when one is asked for', () => {
    const entities: Entity[] = []
    playSound(entities, [
      { from: 988, to: 988, seconds: 0.07, wave: 'square', volume: 0.1 },
      { from: 1319, to: 1319, seconds: 0.22, wave: 'square', volume: 0.1, delay: 0.07 },
    ])
    expect(soundIn(entities)[0]).toEqual([
      { from: 988, to: 988, seconds: 0.07, wave: 'square', volume: 0.1 },
      { from: 1319, to: 1319, seconds: 0.22, wave: 'square', volume: 0.1, delay: 0.07 },
    ])
  })

  it('never stands more than a capful of unheard cues', () => {
    const entities: Entity[] = []
    for (let at = 0; at < MAX_STANDING_CUES + 5; at += 1) {
      playSound(entities, [{ from: 100 + at, to: 200, seconds: 0.1, wave: 'sine', volume: 0.1 }])
    }
    const standing = soundIn(entities)
    expect(standing).toHaveLength(MAX_STANDING_CUES)
    // The oldest went, not the newest: what is heard is what just happened.
    expect(standing[standing.length - 1]?.[0]?.from).toBe(100 + MAX_STANDING_CUES + 4)
  })
})

describe('the runner telling the host', () => {
  it('hands over every cue of the frame, once, after the picture', () => {
    const frames = handCrankedFrames()
    const order: string[] = []

    runLevel({
      entities: [],
      systems: [noisy(BEEP), noisy(THUD)],
      onFrame: frames.onFrame,
      draw: () => order.push('draw'),
      sound: (cues) => order.push(`sound ${String(cues.length)}`),
    })
    frames.frame(STEP_MS)
    // A second frame with nothing new asked for says nothing at all.
    frames.frame(STEP_MS)

    expect(order).toEqual(['draw', 'sound 2', 'draw', 'sound 2'])
  })

  it('empties the queue, so a cue is never heard twice', () => {
    const frames = handCrankedFrames()
    let asked = false
    const heard: number[] = []

    const level = runLevel({
      entities: [],
      systems: [
        {
          id: 'once',
          step: (entities) => {
            if (asked) return
            asked = true
            playSound(entities, BEEP)
          },
        },
      ],
      onFrame: frames.onFrame,
      draw: () => {},
      sound: (cues) => heard.push(cues.length),
    })
    frames.frame(STEP_MS)
    frames.frame(STEP_MS)

    expect(heard).toEqual([1])
    expect(soundIn([...level.state().entities])).toEqual([])
  })

  it('never lets the ask reach the picture', () => {
    const frames = handCrankedFrames()
    let drawnIds: string[] = []

    runLevel({
      entities: [defaultEntity('abc123', 'Slime')],
      systems: [noisy(BEEP)],
      onFrame: frames.onFrame,
      sound: () => {},
      draw: (drawn) => {
        drawnIds = drawn.map((one) => one.id)
      },
    })
    frames.frame(STEP_MS)

    expect(drawnIds).toEqual(['abc123'])
  })

  it('leaves the cues standing when the host takes no sound, for a test to read', () => {
    const frames = handCrankedFrames()

    const level = runLevel({
      entities: [],
      systems: [noisy(THUD)],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    frames.frame(STEP_MS)

    expect(soundIn([...level.state().entities])).toEqual([THUD])
  })
})
