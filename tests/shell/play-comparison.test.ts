import { describe, expect, it } from 'vitest'

import type { DrawnEntity, ShownScene } from '../../runtime'
import { comparePictures, describeComparison } from '../../editor/shell/play-comparison'

/**
 * "What I see matches what the editor was showing me", as arithmetic.
 *
 * This is the check that makes `editor-kernel` D2 an assertion rather than a
 * claim. The renderer is shared, so the two pictures agree if and only if the
 * *loaders* agree — and the editor and the runtime resolve a level through two
 * different code paths. A divergence between them looks like a working editor
 * from every angle except this one.
 *
 * The negative cases matter more than the positive one: a comparison that only
 * ever answers "same" would pass the happy test forever and catch nothing.
 */

const NAMES = new Map([
  ['knight', 'Knight'],
  ['slime', 'Slime'],
])

function drawn(id: string, x: number, y: number, width = 32, height = 32): DrawnEntity {
  return { id, origin: { x, y }, bounds: { x: x - width / 2, y: y - height / 2, width, height } }
}

function picture(entities: DrawnEntity[], overrides: Partial<ShownScene> = {}): ShownScene {
  return {
    path: 'scenes/one.json',
    entities,
    sceneOrigin: { x: 0, y: 360 },
    canvasSize: { width: 640, height: 360 },
    camera: { scale: 2, focus: { x: 0, y: 0 } },
    contentBounds: null,
    undrawable: [],
    ...overrides,
  }
}

describe('when the two pictures agree', () => {
  it('says so, and counts what was drawn', () => {
    const editing = picture([drawn('knight', 100, 200), drawn('slime', 300, 200)])
    const playing = picture([drawn('knight', 100, 200), drawn('slime', 300, 200)])

    expect(comparePictures(editing, playing, NAMES)).toEqual({ kind: 'same', count: 2 })
  })

  it('tolerates the last bit of a float, and nothing wider', () => {
    const editing = picture([drawn('knight', 100, 200)])

    // A play request makes a round trip through the service as JSON, so an exact
    // comparison could fail on a value that is the same number.
    expect(comparePictures(editing, picture([drawn('knight', 100.0005, 200)]), NAMES).kind).toBe('same')
    // A tenth of a pixel is not float noise. It is a bug.
    expect(comparePictures(editing, picture([drawn('knight', 100.1, 200)]), NAMES).kind).toBe('different')
  })

  it('is content with two empty levels', () => {
    expect(comparePictures(picture([]), picture([]), NAMES)).toEqual({ kind: 'same', count: 0 })
  })
})

describe('when they do not', () => {
  it('names a sprite that moved, in the direction a human would say it', () => {
    const result = comparePictures(
      picture([drawn('knight', 100, 200)]),
      picture([drawn('knight', 96, 204)]),
      NAMES,
    )

    expect(result.kind).toBe('different')
    if (result.kind !== 'different') return
    expect(result.differences).toEqual([
      { entity: 'knight', detail: 'Knight is drawn 4px left and 4px down of where the editor drew it' },
    ])
  })

  it('names a sprite that came out a different size', () => {
    const result = comparePictures(
      picture([drawn('knight', 100, 200, 32, 32)]),
      picture([drawn('knight', 100, 200, 16, 32)]),
      NAMES,
    )

    if (result.kind !== 'different') throw new Error('expected a difference')
    expect(result.differences[0]?.detail).toBe('Knight is 16×32 here and was 32×32')
  })

  it('names a sprite drawn on a different pivot', () => {
    // Same position, same size, different rectangle — which is only possible if
    // the two halves disagree about where the sprite hangs off its position.
    const editing = picture([{ id: 'knight', origin: { x: 100, y: 200 }, bounds: { x: 84, y: 184, width: 32, height: 32 } }])
    const playing = picture([{ id: 'knight', origin: { x: 100, y: 200 }, bounds: { x: 84, y: 168, width: 32, height: 32 } }])

    const result = comparePictures(editing, playing, NAMES)
    if (result.kind !== 'different') throw new Error('expected a difference')
    expect(result.differences[0]?.detail).toBe('Knight sits on a different pivot here')
  })

  it('names a sprite with no picture where the editor had one', () => {
    const result = comparePictures(
      picture([drawn('knight', 100, 200)]),
      picture([{ id: 'knight', origin: { x: 100, y: 200 }, bounds: null }]),
      NAMES,
    )

    if (result.kind !== 'different') throw new Error('expected a difference')
    expect(result.differences[0]?.detail).toBe('Knight has no picture here')
  })

  it('names an entity that is missing, and one that is unexpected', () => {
    const result = comparePictures(
      picture([drawn('knight', 100, 200)]),
      picture([drawn('slime', 300, 200)]),
      NAMES,
    )

    if (result.kind !== 'different') throw new Error('expected a difference')
    expect(result.differences.map((one) => one.detail)).toEqual([
      'Knight is missing',
      'Slime is here and was not',
    ])
  })

  it('falls back to the id when the level has no name for it', () => {
    const result = comparePictures(picture([drawn('ghost', 0, 0)]), picture([]), new Map())

    if (result.kind !== 'different') throw new Error('expected a difference')
    expect(result.differences[0]?.detail).toBe('ghost is missing')
  })
})

describe('when the two pictures are not of the same thing', () => {
  it('refuses to compare across a resize', () => {
    const result = comparePictures(
      picture([drawn('knight', 100, 200)]),
      picture([drawn('knight', 100, 200)], { canvasSize: { width: 800, height: 360 } }),
      NAMES,
    )

    expect(result).toEqual({ kind: 'unavailable', why: 'the panel changed size while it was running' })
  })

  it('refuses to compare through a different camera', () => {
    const result = comparePictures(
      picture([drawn('knight', 100, 200)]),
      picture([drawn('knight', 100, 200)], { camera: { scale: 4, focus: { x: 0, y: 0 } } }),
      NAMES,
    )

    expect(result.kind).toBe('unavailable')
  })

  it('refuses to compare two different levels', () => {
    const result = comparePictures(
      picture([drawn('knight', 100, 200)]),
      picture([drawn('knight', 100, 200)], { path: 'scenes/two.json' }),
      NAMES,
    )

    expect(result.kind).toBe('unavailable')
  })
})

describe('what it says out loud', () => {
  it('says every difference rather than a count and an ellipsis', () => {
    const sentence = describeComparison({
      kind: 'different',
      differences: [
        { entity: 'a', detail: 'Knight is missing' },
        { entity: 'b', detail: 'Slime has no picture here' },
      ],
    })

    expect(sentence).toContain('2 differences')
    expect(sentence).toContain('Knight is missing')
    expect(sentence).toContain('Slime has no picture here')
  })

  it('has a sentence for a match and for a refusal', () => {
    expect(describeComparison({ kind: 'same', count: 3 })).toBe('Drawn exactly as the editing view had it.')
    expect(describeComparison({ kind: 'same', count: 0 })).toContain('Nothing to draw')
    expect(describeComparison({ kind: 'unavailable', why: 'the view moved while it was running' })).toBe(
      'Cannot be checked against the editing view: the view moved while it was running.',
    )
  })
})
