import { describe, expect, it } from 'vitest'

import {
  SNAP_INTERVALS,
  WHOLE_UNITS,
  freePoint,
  freely,
  placeOn,
  snapPoint,
  snapTo,
  type Snap,
} from '../../editor/shell/snap'

/**
 * Where a placement is allowed to land, as arithmetic.
 *
 * The properties here are the ones a human would state: things end up a fixed
 * distance apart, on positions they chose, and the numbers that reach the file
 * are numbers somebody could have typed. The browser suite checks that a drag
 * and a click actually go through this; this file checks that going through it
 * is worth anything.
 */

/** The grid the first real game wants: 16-unit tiles, drawn from their middles. */
const TILES: Snap = { on: true, step: 16, offset: 8 }

describe('the intervals offered', () => {
  it('are the powers of two a pixel editor is laid out in, and the default is one of them', () => {
    expect(SNAP_INTERVALS).toEqual([1, 2, 4, 8, 16, 32, 64, 128])
    expect(SNAP_INTERVALS).toContain(WHOLE_UNITS.step)
  })
})

describe('the default', () => {
  it('is the whole units the editor placed on before any of this existed', () => {
    expect(WHOLE_UNITS).toEqual({ on: true, step: 1, offset: 0 })
    expect(snapTo(4.4, WHOLE_UNITS)).toBe(4)
    expect(snapTo(4.6, WHOLE_UNITS)).toBe(5)
    expect(snapTo(-4.6, WHOLE_UNITS)).toBe(-5)
  })
})

describe('a grid through the origin', () => {
  const sixteens: Snap = { on: true, step: 16, offset: 0 }

  it('reaches multiples of the step and nothing between them', () => {
    expect(snapTo(0, sixteens)).toBe(0)
    expect(snapTo(7, sixteens)).toBe(0)
    expect(snapTo(9, sixteens)).toBe(16)
    expect(snapTo(40, sixteens)).toBe(48)
    expect(snapTo(-9, sixteens)).toBe(-16)
  })
})

describe('the offset', () => {
  /**
   * The one that decides whether the feature is worth having. A tile sprite
   * hangs off the middle of its position, so a 16-unit tile covering the square
   * from 0 to 16 sits at 8 — and a grid through the origin cannot express that.
   */
  it('puts the grid on tile middles rather than tile corners', () => {
    expect(snapTo(8, TILES)).toBe(8)
    expect(snapTo(24, TILES)).toBe(24)
    expect(snapTo(40, TILES)).toBe(40)
    expect([9, 12, 15].map((near) => snapTo(near, TILES))).toEqual([8, 8, 8])
    expect([17, 20, 23].map((near) => snapTo(near, TILES))).toEqual([24, 24, 24])
  })

  it('keeps every landing a whole number of steps from every other', () => {
    const landings = [3, 19, 44, 61, 90].map((rough) => snapTo(rough, TILES))
    for (const landing of landings) expect((landing - TILES.offset) % TILES.step).toBe(0)
  })

  /**
   * The road this exists for is only a road if consecutive tiles are exactly one
   * tile apart — the game refuses anything else, and says nothing when it does.
   */
  it('lands a sloppy row of clicks exactly one step apart', () => {
    const clicks = [7.4, 25.9, 38.2, 55.5, 73.1]
    const placed = clicks.map((click) => snapTo(click, TILES))

    expect(placed).toEqual([8, 24, 40, 56, 72])
    for (let after = 1; after < placed.length; after += 1) {
      expect((placed[after] ?? 0) - (placed[after - 1] ?? 0)).toBe(TILES.step)
    }
  })
})

/**
 * The switch and the key that inverts it — all four combinations, because three
 * of them are obvious and the fourth is the one that gets written backwards.
 *
 * An implementation that reads the modifier as "place freely" — which is what it
 * meant while `Alt` owned it — passes every case here except `off + held`, and
 * that case is silent when it fails: the entity lands where it would have landed
 * anyway, so nothing on screen says the key did nothing.
 */
describe('the toggle, and Ctrl inverting it', () => {
  const rough = { x: 9.4, y: 41.7 }
  const onGrid = { x: 8, y: 40 }
  const anywhere = { x: 9.4, y: 41.7 }

  it('lands on the grid with snapping on and nothing held', () => {
    expect(placeOn(rough, TILES, false)).toEqual(onGrid)
  })

  it('lands anywhere with snapping on and Ctrl held', () => {
    expect(placeOn(rough, TILES, true)).toEqual(anywhere)
  })

  it('lands anywhere with snapping off and nothing held', () => {
    expect(placeOn(rough, { ...TILES, on: false }, false)).toEqual(anywhere)
  })

  /** The one. Ctrl is not "free" — it is *the other thing*. */
  it('lands on the grid with snapping off and Ctrl held', () => {
    expect(placeOn(rough, { ...TILES, on: false }, true)).toEqual(onGrid)
  })

  /**
   * Switching off must not throw the grid away, or setting one up and turning it
   * on would be two steps that undo each other.
   */
  it('keeps the spacing while it is switched off', () => {
    const off: Snap = { ...TILES, on: false }
    expect(off.step).toBe(16)
    expect(off.offset).toBe(8)
    expect(placeOn(rough, { ...off, on: true }, false)).toEqual(onGrid)
  })

  /**
   * The grid arithmetic deliberately does not consult the switch — asking there
   * as well would make the inverted case above unreachable, since it has to snap
   * to a grid the toggle says is off.
   */
  it('snaps by arithmetic alone, whatever the switch says', () => {
    expect(snapTo(9.4, { ...TILES, on: false })).toBe(8)
  })
})

describe('a step that is not a grid', () => {
  it('places freely, whatever else is asked for', () => {
    expect(snapTo(4.5678, { on: true, step: 0, offset: 0 })).toBe(4.568)
    expect(snapTo(4.5678, { on: true, step: -16, offset: 0 })).toBe(4.568)
    expect(snapTo(4.5678, { on: true, step: Number.NaN, offset: 0 })).toBe(4.568)
    expect(snapTo(4.5678, { on: true, step: Number.POSITIVE_INFINITY, offset: 0 })).toBe(4.568)
  })

  it('does the same for an offset nobody could mean', () => {
    expect(snapTo(4.5678, { on: true, step: 16, offset: Number.NaN })).toBe(4.568)
  })
})

describe('what reaches the file', () => {
  /**
   * `(24 - 8) / 16 * 16 + 8` is not always exactly 24 in binary. A tile at
   * 24.000000000000004 draws in the same place, reads as noise in the file, and
   * is a different number to everything that compares positions.
   */
  it('is a number somebody could have typed', () => {
    for (const rough of [23.9999, 24.0001, 7.5, 55.5, -8.3]) {
      const landed = snapTo(rough, TILES)
      expect(Number.isInteger(landed)).toBe(true)
      expect(String(landed).length).toBeLessThan(8)
    }
  })

  it('keeps a free position readable rather than exact', () => {
    expect(freely(1 / 3)).toBe(0.333)
    expect(freePoint({ x: 1 / 3, y: 2 / 3 })).toEqual({ x: 0.333, y: 0.667 })
  })

  /**
   * Placing something that is already placed must not move it. Without this, a
   * click on a tile that is already on the grid could shuffle it a fraction,
   * and a level would drift every time it was touched.
   */
  it('leaves a position that is already on the grid exactly where it is', () => {
    for (const snap of [WHOLE_UNITS, TILES, { on: true, step: 0.25, offset: 0 }, { on: true, step: 0, offset: 0 }]) {
      for (const rough of [0, 7.4, 25.9, -33.2]) {
        const once = snapTo(rough, snap)
        expect(snapTo(once, snap)).toBe(once)
      }
    }
  })
})

describe('both axes', () => {
  it('are on the same grid, so a board is square', () => {
    expect(snapPoint({ x: 9, y: 41 }, TILES)).toEqual({ x: 8, y: 40 })
  })
})
