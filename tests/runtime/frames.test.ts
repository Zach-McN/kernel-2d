import { describe, expect, it } from 'vitest'

import type { Slice } from '../../runtime/formats/meta-schema'
import { framesFor } from '../../runtime/textures/frames'

/**
 * What a slice means, held to the two promises the viewport makes about it:
 * every frame it reports is a whole frame, and every pixel a frame does not
 * cover is counted rather than quietly folded into one.
 *
 * These live in `tests/runtime/` and not `tests/editor/` because Playwright
 * claims everything in there and these are Vitest tests (editor-verification
 * V15).
 */

const grid = (over: Partial<Extract<Slice, { mode: 'grid' }>> = {}): Slice => ({
  mode: 'grid',
  frameWidth: 16,
  frameHeight: 16,
  margin: 0,
  spacing: 0,
  ...over,
})

describe('a single frame', () => {
  it('is the whole image', () => {
    const sliced = framesFor({ mode: 'single' }, 64, 16)

    expect(sliced.frames).toEqual([{ x: 0, y: 0, width: 64, height: 16 }])
    expect(sliced.columns).toBe(1)
    expect(sliced.rows).toBe(1)
    expect(sliced.uncoveredRight).toBe(0)
    expect(sliced.uncoveredBottom).toBe(0)
  })

  it('is nothing at all when the image has no pixels', () => {
    expect(framesFor({ mode: 'single' }, 0, 0).frames).toEqual([])
  })
})

describe('a grid that divides the image exactly', () => {
  it('cuts a strip into frames, left to right', () => {
    const sliced = framesFor(grid(), 64, 16)

    expect(sliced.frames).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 16, y: 0, width: 16, height: 16 },
      { x: 32, y: 0, width: 16, height: 16 },
      { x: 48, y: 0, width: 16, height: 16 },
    ])
    expect(sliced.columns).toBe(4)
    expect(sliced.rows).toBe(1)
  })

  it('cuts a sheet in reading order — across, then down', () => {
    const sliced = framesFor(grid(), 32, 32)

    expect(sliced.frames.map((frame) => [frame.x, frame.y])).toEqual([
      [0, 0],
      [16, 0],
      [0, 16],
      [16, 16],
    ])
  })

  it('leaves nothing uncovered', () => {
    const sliced = framesFor(grid(), 64, 64)

    expect(sliced.frames).toHaveLength(16)
    expect(sliced.uncoveredRight).toBe(0)
    expect(sliced.uncoveredBottom).toBe(0)
  })
})

describe('a grid that does not divide the image exactly', () => {
  it('produces only whole frames and counts the rest', () => {
    // 64 wide, frames 24 across: two fit, sixteen pixels do not.
    const sliced = framesFor(grid({ frameWidth: 24 }), 64, 16)

    expect(sliced.frames).toEqual([
      { x: 0, y: 0, width: 24, height: 16 },
      { x: 24, y: 0, width: 24, height: 16 },
    ])
    expect(sliced.uncoveredRight).toBe(16)
    expect(sliced.uncoveredBottom).toBe(0)
  })

  it('counts the remainder on both axes at once', () => {
    const sliced = framesFor(grid({ frameWidth: 24, frameHeight: 24 }), 64, 64)

    expect(sliced.columns).toBe(2)
    expect(sliced.rows).toBe(2)
    expect(sliced.frames).toHaveLength(4)
    expect(sliced.uncoveredRight).toBe(16)
    expect(sliced.uncoveredBottom).toBe(16)
  })

  it('produces nothing when a frame will not fit, and counts the whole image as uncovered', () => {
    // Too wide to fit even once, though the height would have been fine. A grid
    // that fails on one axis produces no frames at all, so nothing is covered
    // on either — not one row of frames that do not exist.
    const sliced = framesFor(grid({ frameWidth: 100 }), 64, 16)

    expect(sliced.frames).toEqual([])
    expect(sliced.columns).toBe(0)
    expect(sliced.rows).toBe(0)
    expect(sliced.uncoveredRight).toBe(64)
    expect(sliced.uncoveredBottom).toBe(16)
  })
})

describe('margin and spacing', () => {
  it('starts a margin in from each edge', () => {
    const sliced = framesFor(grid({ frameWidth: 16, frameHeight: 16, margin: 2 }), 36, 20)

    expect(sliced.frames).toEqual([
      { x: 2, y: 2, width: 16, height: 16 },
      { x: 18, y: 2, width: 16, height: 16 },
    ])
    expect(sliced.uncoveredRight).toBe(0)
    expect(sliced.uncoveredBottom).toBe(0)
  })

  it('puts spacing between neighbours but not around the outside', () => {
    // Three 16px frames with a pixel between them need 50, not 51: the gaps go
    // between the frames, so there are two of them rather than three.
    const sliced = framesFor(grid({ spacing: 1 }), 50, 16)

    expect(sliced.frames.map((frame) => frame.x)).toEqual([0, 17, 34])
    expect(sliced.uncoveredRight).toBe(0)
  })

  it('describes a sheet drawn with both, exactly', () => {
    // 2 + 4*16 + 3*1 + 2 = 71 across; 2 + 2*16 + 1*1 + 2 = 37 down.
    const sliced = framesFor(grid({ margin: 2, spacing: 1 }), 71, 37)

    expect(sliced.columns).toBe(4)
    expect(sliced.rows).toBe(2)
    expect(sliced.uncoveredRight).toBe(0)
    expect(sliced.uncoveredBottom).toBe(0)
  })

  it('does not count a frame that only fits by eating its own margin', () => {
    // One pixel short of the 71 the four frames and their margins need.
    const sliced = framesFor(grid({ margin: 2, spacing: 1 }), 70, 37)

    expect(sliced.columns).toBe(3)
    expect(sliced.uncoveredRight).toBe(16)
  })
})
