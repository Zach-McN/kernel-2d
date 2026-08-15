import { describe, expect, it } from 'vitest'

import type { SoundCue } from '../../runtime/game/sound'
import { SILENCE, TAIL_SECONDS, scheduleCue } from '../../runtime/scene/synth'

/**
 * What a note *is*, checked without a browser.
 *
 * The envelope is the parity contract — a sound that ramps the wrong way, or
 * fades over the wrong span, is wrong by ear and by nothing else — so it is
 * asserted against a stand-in context that records the appointments made on
 * it. The cast is the whole of the pretence: `scheduleCue` speaks the real Web
 * Audio types, and this answers them.
 */

interface Booking {
  what: string
  value: number
  when: number
}

function standInContext(startAt = 10): {
  context: AudioContext
  bookings: Booking[]
  destination: AudioNode
} {
  const bookings: Booking[] = []
  const param = (name: string): unknown => ({
    setValueAtTime: (value: number, when: number) => bookings.push({ what: `${name} at`, value, when }),
    exponentialRampToValueAtTime: (value: number, when: number) =>
      bookings.push({ what: `${name} ramp`, value, when }),
  })
  const destination = { id: 'destination' } as unknown as AudioNode

  const context = {
    currentTime: startAt,
    createOscillator: () => ({
      type: '',
      frequency: param('frequency'),
      connect: () => {},
      start: (when: number) => bookings.push({ what: 'start', value: 0, when }),
      stop: (when: number) => bookings.push({ what: 'stop', value: 0, when }),
    }),
    createGain: () => ({
      gain: param('gain'),
      connect: () => {},
    }),
  } as unknown as AudioContext

  return { context, bookings, destination }
}

const JUMP: SoundCue = [{ from: 200, to: 640, seconds: 0.16, wave: 'square', volume: 0.1 }]

describe('one note', () => {
  it('sweeps the frequency and fades the gain across the same span', () => {
    const { context, bookings, destination } = standInContext(10)

    scheduleCue(context, destination, JUMP, context.currentTime)

    expect(bookings).toEqual([
      { what: 'frequency at', value: 200, when: 10 },
      { what: 'frequency ramp', value: 640, when: 10.16 },
      { what: 'gain at', value: 0.1, when: 10 },
      { what: 'gain ramp', value: SILENCE, when: 10.16 },
      { what: 'start', value: 0, when: 10 },
      { what: 'stop', value: 0, when: 10.16 + TAIL_SECONDS },
    ])
  })

  it('leaves a flat note unramped — an exponential ramp to where it already is buys nothing', () => {
    const { context, bookings, destination } = standInContext(0)

    scheduleCue(context, destination, [{ from: 988, to: 988, seconds: 0.07, wave: 'square', volume: 0.1 }], 0)

    expect(bookings.filter((one) => one.what === 'frequency ramp')).toEqual([])
    expect(bookings.filter((one) => one.what === 'frequency at')).toEqual([
      { what: 'frequency at', value: 988, when: 0 },
    ])
  })

  it('answers when the last of it is over, tail included', () => {
    const { context, destination } = standInContext(5)
    expect(scheduleCue(context, destination, JUMP, 5)).toBeCloseTo(5 + 0.16 + TAIL_SECONDS, 10)
  })
})

describe('a cue of several notes', () => {
  it('starts each one at its own delay, and ends when the last of them does', () => {
    const { context, bookings, destination } = standInContext(0)

    const win: SoundCue = [523, 659, 784, 1047].map((hz, at) => ({
      from: hz,
      to: hz,
      seconds: 0.15,
      wave: 'square' as const,
      volume: 0.1,
      delay: at * 0.12,
    }))
    const endsAt = scheduleCue(context, destination, win, 0)

    expect(bookings.filter((one) => one.what === 'start').map((one) => one.when)).toEqual([0, 0.12, 0.24, 0.36])
    expect(endsAt).toBeCloseTo(0.36 + 0.15 + TAIL_SECONDS, 10)
  })

  it('refuses to ramp below the floor a browser can reach', () => {
    const { context, bookings, destination } = standInContext(0)

    scheduleCue(context, destination, [{ from: 320, to: 0.4, seconds: 0.14, wave: 'sawtooth', volume: 0.14 }], 0)

    expect(bookings.find((one) => one.what === 'frequency ramp')?.value).toBe(1)
  })
})
