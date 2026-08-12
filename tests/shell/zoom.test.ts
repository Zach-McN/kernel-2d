import { describe, expect, it } from 'vitest'

import { ZOOM_STEPS, describeZoom, fitStep, stepDown, stepUp } from '../../editor/shell/zoom'

/**
 * The viewport's magnifications, held to the one promise that matters: every
 * one of them is a whole number of screen pixels per image pixel, or the other
 * way round. Pixel art at anything else looks like badly drawn art rather than
 * like a badly chosen zoom.
 */

describe('the ladder itself', () => {
  it('is only whole numbers, or whole fractions of one', () => {
    for (const step of ZOOM_STEPS) {
      const whole = step >= 1 ? step : 1 / step
      expect(Number.isInteger(whole)).toBe(true)
    }
  })

  it('climbs', () => {
    const sorted = [...ZOOM_STEPS].sort((a, b) => a - b)
    expect(ZOOM_STEPS).toEqual(sorted)
  })
})

describe('fitting an image to the panel', () => {
  it('makes a tiny sprite big enough to look at', () => {
    // A 16px knight in a panel most of a laptop screen wide.
    expect(fitStep(16, 16, 640, 480)).toBeGreaterThanOrEqual(8)
  })

  it('never overflows the panel it was given', () => {
    for (const [width, height] of [
      [16, 16],
      [64, 16],
      [64, 64],
      [320, 240],
      [1024, 1024],
    ] as const) {
      const step = fitStep(width, height, 500, 300)

      expect(width * step).toBeLessThanOrEqual(500)
      expect(height * step).toBeLessThanOrEqual(300)
    }
  })

  it('shrinks by a whole fraction when the image is bigger than the panel', () => {
    const step = fitStep(2048, 2048, 400, 400)

    expect(step).toBeLessThan(1)
    expect(Number.isInteger(1 / step)).toBe(true)
  })

  it('is bounded by the tighter of the two axes', () => {
    // A wide strip in a panel that is wide but short.
    const step = fitStep(64, 16, 800, 40)

    expect(16 * step).toBeLessThanOrEqual(40)
  })

  it('answers for an image with no pixels rather than dividing by nothing', () => {
    expect(fitStep(0, 0, 400, 400)).toBe(1)
  })
})

describe('stepping by hand', () => {
  it('moves one rung at a time', () => {
    expect(stepUp(1)).toBe(2)
    expect(stepUp(2)).toBe(3)
    expect(stepDown(1)).toBe(1 / 2)
  })

  it('stays put at the ends rather than running off them', () => {
    const top = ZOOM_STEPS.at(-1) ?? 1
    const bottom = ZOOM_STEPS[0] ?? 1

    expect(stepUp(top)).toBe(top)
    expect(stepDown(bottom)).toBe(bottom)
  })

  it('lands back on the ladder from a scale that is not on it', () => {
    expect(ZOOM_STEPS).toContain(stepUp(5))
    expect(ZOOM_STEPS).toContain(stepDown(5))
  })
})

describe('saying the zoom out loud', () => {
  it('reads as a multiplier above one and a fraction below it', () => {
    expect(describeZoom(8)).toBe('8×')
    expect(describeZoom(1)).toBe('1×')
    expect(describeZoom(1 / 4)).toBe('1/4×')
  })
})
