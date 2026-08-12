import { describe, expect, it } from 'vitest'

import {
  compareDrawings,
  describeDrawingComparison,
  parseDrawing,
  type Drawing,
} from './drawn-comparison.js'

/**
 * The instrument that checks an exported game against the editor, checked itself.
 *
 * A test that compares two pictures is only worth anything if it can tell them apart,
 * and the way that goes wrong is silent: a comparison that always answers "the same"
 * passes every test written from the happy path. So each way two pictures can differ
 * has a test here, and so does each edge of the tolerance.
 *
 * Same reasoning as `tests/shell/play-comparison.test.ts` one layer out — that one
 * checks the editor's own play-mode comparison, this one checks the suite's.
 */

const NAMES: readonly [string, string] = ['the exported game', 'the editor']

function at(id: string, x: number, y: number, width = 16, height = 16): Drawing[number] {
  // A sprite pivoted at its feet, which is what the sample project's characters are.
  return { id, x, y, bounds: { x: x - width / 2, y, width, height } }
}

const LEVEL: Drawing = [
  { id: 'ground', x: 160, y: 8, bounds: { x: 0, y: 0, width: 320, height: 16 } },
  at('knight', 100, 16),
  at('slime', 200, 16),
]

describe('when the two pictures agree', () => {
  it('says so, and counts what was drawn', () => {
    const verdict = compareDrawings(LEVEL, [...LEVEL], NAMES)
    expect(verdict).toEqual({ kind: 'same', count: 3 })
    expect(describeDrawingComparison(verdict)).toContain('same 3 entities')
  })

  it('says so for two levels with nothing in them', () => {
    expect(compareDrawings([], [], NAMES)).toEqual({ kind: 'same', count: 0 })
  })

  it('accepts a difference smaller than a thousandth of a unit', () => {
    // The tolerance's job: both numbers came out of one renderer, and only a JSON
    // round trip separates them.
    const nudged: Drawing = [{ ...at('knight', 100.0004, 16) }]
    expect(compareDrawings([at('knight', 100, 16)], nudged, NAMES).kind).toBe('same')
  })

  it('rejects a difference of a tenth of a unit', () => {
    // The other edge. Without this the tolerance could be widened to anything and
    // every test above would keep passing.
    const moved: Drawing = [at('knight', 100.1, 16)]
    expect(compareDrawings([at('knight', 100, 16)], moved, NAMES).kind).toBe('different')
  })
})

describe('when they do not agree, it says how', () => {
  it('names an entity that is in one and not the other, in both directions', () => {
    const missing = compareDrawings(LEVEL, LEVEL.slice(0, 2), NAMES)
    expect(missing.kind === 'different' && missing.differences).toEqual([
      'slime is in the exported game and not in the editor',
    ])

    const extra = compareDrawings(LEVEL.slice(0, 2), LEVEL, NAMES)
    expect(extra.kind === 'different' && extra.differences).toEqual([
      'slime is in the editor and not in the exported game',
    ])
  })

  it('names an entity drawn somewhere else, with both positions', () => {
    const moved = compareDrawings([at('knight', 100, 16)], [at('knight', 104, 16)], NAMES)
    expect(moved.kind === 'different' && moved.differences[0]).toBe(
      'knight is at 100,16 in the first and 104,16 in the second',
    )
  })

  it('names an entity drawn at a different size, with both sizes', () => {
    const bigger = compareDrawings([at('knight', 100, 16)], [at('knight', 100, 16, 64, 16)], NAMES)
    expect(bigger.kind === 'different' && bigger.differences[0]).toContain('16×16 in the first and 64×16')
  })

  it('names a pivot difference, which is the same position and the same size', () => {
    const centred: Drawing = [{ id: 'knight', x: 100, y: 16, bounds: { x: 92, y: 8, width: 16, height: 16 } }]
    const verdict = compareDrawings([at('knight', 100, 16)], centred, NAMES)
    expect(verdict.kind === 'different' && verdict.differences[0]).toContain('different pivot')
  })

  it('names a picture that is there on one side only', () => {
    const nothing: Drawing = [{ id: 'knight', x: 100, y: 16, bounds: null }]
    const gone = compareDrawings([at('knight', 100, 16)], nothing, NAMES)
    expect(gone.kind === 'different' && gone.differences[0]).toContain('none in the second')
  })

  /*
   * Draw order is part of the picture: the same entities in a different order overlap
   * differently, which is exactly the sort of thing a set-based comparison would call
   * identical.
   */
  it('names a difference in draw order, when nothing else differs', () => {
    const reversed = [...LEVEL].reverse()
    const verdict = compareDrawings(LEVEL, reversed, NAMES)
    expect(verdict.kind === 'different' && verdict.differences[0]).toContain('draw order differs')
  })

  it('names every difference rather than the first', () => {
    const twoWrong: Drawing = [LEVEL[0] as Drawing[number], at('knight', 104, 16), at('slime', 200, 24)]
    const verdict = compareDrawings(LEVEL, twoWrong, NAMES)
    expect(verdict.kind === 'different' && verdict.differences).toHaveLength(2)
  })
})

describe('reading a drawing off a page', () => {
  it('takes the JSON an attribute carries', () => {
    expect(parseDrawing(JSON.stringify(LEVEL))).toEqual(LEVEL)
  })

  it('takes the value an evaluate handed back', () => {
    expect(parseDrawing(LEVEL)).toEqual(LEVEL)
  })

  it('refuses something that is not a drawing, rather than comparing nonsense', () => {
    // A hook that stopped being published would otherwise arrive as an empty list and
    // compare equal to another empty list, which is the green-for-the-wrong-reason
    // failure this suite exists to avoid.
    expect(() => parseDrawing('[{"id":"knight"}]')).toThrow()
    expect(() => parseDrawing('')).toThrow()
  })
})
