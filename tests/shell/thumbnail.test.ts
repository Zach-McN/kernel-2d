import { describe, expect, it } from 'vitest'

import type { Slice } from '../../runtime/formats/meta-schema'
import type { AssetRow } from '../../editor/shell/asset-rows'
import { thumbnailKeyFor, thumbnailPlan, thumbnailStepFor } from '../../editor/shell/thumbnail'

/**
 * The three answers behind a picture on an asset tile: what identifies it, what
 * is cut out of the image, and how big it is shown.
 *
 * Worth having without a browser because the failures are all *quiet*. A sheet
 * shown whole is a legible thumbnail of the wrong thing; a picture kept at full
 * size costs a folder of tilesets a gigabyte and looks identical on screen; a
 * key that does not move when the art is re-exported shows yesterday's sprite
 * for ever. None of the three raises anything.
 */

const BOX = 64

const grid = (frameWidth: number, frameHeight: number): Slice => ({
  mode: 'grid',
  frameWidth,
  frameHeight,
  margin: 0,
  spacing: 0,
})

function rowFor(path: string, mtimeMs: number, settingsMtimeMs: number | null): AssetRow {
  return {
    node: { kind: 'file', name: path.split('/').at(-1) ?? path, path, ext: '.png', size: 1, mtimeMs },
    hasSettings: settingsMtimeMs !== null,
    settingsMtimeMs,
    isOrphanedSettings: false,
  }
}

describe('what identifies a tile picture', () => {
  it('changes when the art is re-exported', () => {
    const before = thumbnailKeyFor(rowFor('a/knight.png', 1000, 900))
    const after = thumbnailKeyFor(rowFor('a/knight.png', 2000, 900))

    expect(before).not.toBe(after)
  })

  it('changes when the slicing is changed, which is the whole reason it is not just the file', () => {
    const before = thumbnailKeyFor(rowFor('a/strip.png', 1000, 900))
    const after = thumbnailKeyFor(rowFor('a/strip.png', 1000, 950))

    expect(before).not.toBe(after)
  })

  it('does not change when nothing has', () => {
    expect(thumbnailKeyFor(rowFor('a/knight.png', 1000, 900))).toBe(
      thumbnailKeyFor(rowFor('a/knight.png', 1000, 900)),
    )
  })

  it('tells "no settings" apart from settings that have just arrived', () => {
    expect(thumbnailKeyFor(rowFor('a/knight.png', 1000, null))).not.toBe(
      thumbnailKeyFor(rowFor('a/knight.png', 1000, 0)),
    )
  })

  it('has nothing to say about a folder', () => {
    expect(
      thumbnailKeyFor({
        node: { kind: 'directory', name: 'textures', path: 'assets/textures', children: [] },
        hasSettings: false,
        settingsMtimeMs: null,
        isOrphanedSettings: false,
      }),
    ).toBeNull()
  })
})

describe('what a tile picture is made of', () => {
  it('takes the first frame of a strip rather than the smear of all of them', () => {
    const plan = thumbnailPlan(grid(16, 16), 96, 16, BOX)

    expect(plan?.crop).toEqual({ x: 0, y: 0, width: 16, height: 16 })
    // Kept at its own size: blowing it up to fill the box is the browser's job,
    // and doing it here would store sixteen times the pixels for no more detail.
    expect(plan).toMatchObject({ width: 16, height: 16 })
  })

  it('takes the top-left tile of a sheet, margin and spacing included', () => {
    const plan = thumbnailPlan(
      { mode: 'grid', frameWidth: 16, frameHeight: 16, margin: 2, spacing: 1 },
      70,
      70,
      BOX,
    )

    expect(plan?.crop).toEqual({ x: 2, y: 2, width: 16, height: 16 })
  })

  it('shows the whole image when the file is one picture', () => {
    expect(thumbnailPlan({ mode: 'single' }, 24, 32, BOX)?.crop).toEqual({
      x: 0,
      y: 0,
      width: 24,
      height: 32,
    })
  })

  it('shows the whole image when there are no settings beside it yet', () => {
    expect(thumbnailPlan(null, 24, 32, BOX)?.crop).toEqual({ x: 0, y: 0, width: 24, height: 32 })
  })

  it('shows the whole image when the frame size fits nothing, rather than showing nothing', () => {
    // A mis-set frame size is a mistake the Texture panel reports properly. A
    // tile's job is still to say which file this is.
    expect(thumbnailPlan(grid(64, 64), 16, 16, BOX)?.crop).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    })
  })

  it('stands a large tileset down to the box on the way in, keeping its shape', () => {
    const plan = thumbnailPlan({ mode: 'single' }, 4096, 2048, BOX)

    expect(plan).toMatchObject({ width: 64, height: 32 })
  })

  it('stands one frame down rather than the sheet it came from', () => {
    const plan = thumbnailPlan(grid(256, 256), 4096, 4096, BOX)

    expect(plan?.crop).toEqual({ x: 0, y: 0, width: 256, height: 256 })
    expect(plan).toMatchObject({ width: 64, height: 64 })
  })

  it('never keeps a picture smaller than a pixel', () => {
    expect(thumbnailPlan({ mode: 'single' }, 4096, 1, BOX)).toMatchObject({ width: 64, height: 1 })
  })

  it('has nothing to draw for an image with no size', () => {
    expect(thumbnailPlan({ mode: 'single' }, 0, 0, BOX)).toBeNull()
  })
})

describe('how big a kept picture is drawn', () => {
  it('fills the box exactly when the sprite divides into it', () => {
    expect(thumbnailStepFor(16, 16, BOX)).toBe(4)
  })

  it('gives up filling the box rather than draw half a pixel row', () => {
    // 64/24 is 2.67, at which some rows of a sprite are two pixels tall and some
    // are three — which reads as badly drawn art rather than a badly chosen
    // size, and sends the human looking at their own file (U17).
    expect(thumbnailStepFor(24, 24, BOX)).toBe(2)
  })

  it('measures against the longer side, so a wide sprite still fits', () => {
    expect(thumbnailStepFor(32, 8, BOX)).toBe(2)
  })

  it('never shrinks — anything at least box-sized was already stood down', () => {
    expect(thumbnailStepFor(64, 32, BOX)).toBe(1)
    expect(thumbnailStepFor(64, 64, BOX)).toBe(1)
  })
})
