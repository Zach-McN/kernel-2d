import type { Slice } from '../../runtime/formats/meta-schema'
import { framesFor, type FrameRect } from '../../runtime/textures/frames'
import type { AssetRow } from './asset-rows'

/**
 * The arithmetic behind a picture on an asset tile: what to cut out of the
 * image, how big to keep it, and how big to show it.
 *
 * No React and no browser API in here, so every one of those three answers is
 * unit-testable without a canvas — which matters more than usual, because the
 * thing they decide (a 64-pixel picture) is exactly the size at which a wrong
 * answer looks like a slightly odd thumbnail rather than like a bug.
 */

/**
 * The picture box on a tile, in CSS pixels. Square, and the same for every tile.
 *
 * Chosen against the panel rather than against the art. A picture box is height
 * every tile pays for, and the Assets panel in the opening layout is short
 * enough that a box much larger than this leaves a two-row folder with no
 * background at all — which quietly takes away the right-click that makes a file
 * (`editor-ui` U45), since a press has to land on something that is not a tile.
 * 48 keeps two rows *and* their background in the panel as it opens, and it is
 * three whole pixels per pixel of the 16-pixel sprites this kernel is mostly
 * pointed at.
 */
export const THUMBNAIL_BOX = 48

/**
 * What identifies one picture, and therefore what invalidates it.
 *
 * The three parts are all in the project tree the panel is already drawing from,
 * so **nothing has to be fetched to find out whether a kept copy is stale**.
 * Re-export the art from Photoshop and the file's own timestamp moves; change
 * the slicing in the Inspector and the `.meta`'s timestamp moves. Either way
 * this string changes, which is the whole of the invalidation rule — there is no
 * second piece of code deciding when to forget something.
 *
 * A file with no `.meta` beside it says so rather than leaving a gap, or a file
 * that gains one would keep the key it had while it had none.
 */
export function thumbnailKeyFor(row: AssetRow): string | null {
  if (row.node.kind !== 'file') return null
  return `${row.node.path}@${row.node.mtimeMs}@${row.settingsMtimeMs ?? 'none'}`
}

export interface ThumbnailPlan {
  /** The part of the image to keep, in image pixels. */
  crop: FrameRect
  /** How big to keep it. Never larger than the crop — see below. */
  width: number
  height: number
}

/**
 * Which rectangle a picture is made from, and how big it is kept.
 *
 * **A sheet shows its first frame**, cut by the same `framesFor` the runtime
 * cuts with and the Texture panel draws guides with — so what a tile shows is
 * what the game will draw, by construction rather than by a second reading of
 * the same settings. A sixteen-frame strip drawn whole is a smear that says
 * nothing about which strip it is.
 *
 * It falls back to the whole image in three cases, and the third is the one
 * worth stating: there is no `.meta`; the slice is `single`; or the grid
 * settings produce no whole frame on an image this size. A frame size somebody
 * has mis-set should show the art rather than show nothing — the tile is not
 * the place to report a mistake the Texture panel already reports properly.
 *
 * **It never keeps a picture bigger than the box, and never keeps one bigger
 * than it is.** A 16×16 sprite is kept at 16×16 and blown up at draw time,
 * which is what keeps pixel art crisp; a 4096×4096 tileset is shrunk on the way
 * in, which is what stops a folder of them costing a gigabyte.
 */
export function thumbnailPlan(
  slice: Slice | null,
  imageWidth: number,
  imageHeight: number,
  box: number,
): ThumbnailPlan | null {
  const width = Math.floor(imageWidth)
  const height = Math.floor(imageHeight)
  if (width <= 0 || height <= 0) return null

  const whole: FrameRect = { x: 0, y: 0, width, height }
  const crop = slice === null ? whole : (framesFor(slice, width, height).frames[0] ?? whole)

  const shrink = Math.min(1, box / Math.max(crop.width, crop.height))

  return {
    crop,
    width: Math.max(1, Math.round(crop.width * shrink)),
    height: Math.max(1, Math.round(crop.height * shrink)),
  }
}

/**
 * How much bigger than itself a kept picture is drawn — whole steps only.
 *
 * The same choice the texture preview makes and for the same reason
 * (`editor-ui` U17): at 2.7× some rows of a sprite are two pixels tall and some
 * are three, which reads as *badly drawn art* rather than as a badly chosen
 * size, and sends the human looking for the fault in their own work. So a 16px
 * sprite fills the 64px box exactly, a 24px one is shown at 48 with room around
 * it, and filling the box is given up rather than paid for in uneven pixels.
 *
 * Only ever upward: anything at least as big as the box was already shrunk to
 * fit by the plan above, with smoothing, which is the right treatment for
 * standing a 4096-pixel tileset down to 64.
 */
export function thumbnailStepFor(width: number, height: number, box: number): number {
  const longest = Math.max(width, height)
  if (longest <= 0) return 1
  return Math.max(1, Math.floor(box / longest))
}
