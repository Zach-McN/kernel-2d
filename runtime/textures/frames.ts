import type { Slice } from '../formats/meta-schema'

/**
 * What a slice means, in pixels. The single definition, and the only one.
 *
 * Two things read this: the runtime, when it cuts a texture into frames, and
 * the viewport's overlay, when it draws where those frames are. That is
 * deliberate and it is the whole reason this is a separate module — the guides
 * on screen have exactly one job, which is to tell the human which frames the
 * runtime will produce, and a second interpretation of "frame width 24 with a
 * margin of 2" would let them say something that is not true.
 *
 * Phaser 4 does not expose its sprite-sheet parser (the v3
 * `Phaser.Textures.Parsers.SpriteSheet` entry point is gone), so frames are
 * added to a texture by hand from this function. That turned out to be the
 * better arrangement anyway: the geometry is ours, so it is testable without a
 * browser, a renderer, or a canvas.
 *
 * No Phaser import here, on purpose. This is arithmetic.
 */

export interface FrameRect {
  /** Top-left in image pixels, x rightwards and y downwards. */
  x: number
  y: number
  width: number
  height: number
}

export interface SlicedFrames {
  /** In reading order: left to right, then top to bottom. */
  frames: FrameRect[]
  /** How many columns and rows of whole frames fitted. */
  columns: number
  rows: number
  /**
   * Pixels along the right edge and bottom edge that no frame covers.
   *
   * A partial frame is not a frame: nothing downstream will ever cut one, so
   * reporting the leftover as a measurement rather than as a stunted rectangle
   * is what lets the viewport show the mismatch without drawing a frame that
   * does not exist.
   */
  uncoveredRight: number
  uncoveredBottom: number
}

/**
 * The frames a slice produces on an image of this size.
 *
 * `single` is the whole image as one frame — including its margin-free,
 * spacing-free self, because a lone frame has nothing to be spaced from.
 *
 * A grid lays frames out from `margin` pixels in on each side, with `spacing`
 * pixels between neighbours. Only whole frames count: a frame that would run
 * off the right or bottom edge is not produced, and the pixels it would have
 * covered are reported as uncovered instead.
 */
export function framesFor(slice: Slice, imageWidth: number, imageHeight: number): SlicedFrames {
  const width = Math.max(0, Math.floor(imageWidth))
  const height = Math.max(0, Math.floor(imageHeight))

  if (slice.mode === 'single') {
    return {
      frames: width > 0 && height > 0 ? [{ x: 0, y: 0, width, height }] : [],
      columns: width > 0 && height > 0 ? 1 : 0,
      rows: width > 0 && height > 0 ? 1 : 0,
      uncoveredRight: 0,
      uncoveredBottom: 0,
    }
  }

  const columns = countAlong(width, slice.frameWidth, slice.margin, slice.spacing)
  const rows = countAlong(height, slice.frameHeight, slice.margin, slice.spacing)

  // A grid that fails on either axis produces nothing at all, so it covers
  // nothing on *both*. Reporting "no columns but one row" would describe a row
  // of frames that does not exist, and the viewport would then draw an
  // uncovered strip down one side of an image where every pixel is uncovered.
  if (columns === 0 || rows === 0) {
    return { frames: [], columns: 0, rows: 0, uncoveredRight: width, uncoveredBottom: height }
  }

  const frames: FrameRect[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      frames.push({
        x: slice.margin + column * (slice.frameWidth + slice.spacing),
        y: slice.margin + row * (slice.frameHeight + slice.spacing),
        width: slice.frameWidth,
        height: slice.frameHeight,
      })
    }
  }

  return {
    frames,
    columns,
    rows,
    uncoveredRight: width - coveredLength(columns, slice.frameWidth, slice.margin, slice.spacing),
    uncoveredBottom: height - coveredLength(rows, slice.frameHeight, slice.margin, slice.spacing),
  }
}

/**
 * How many whole frames fit along one axis.
 *
 * The margin is taken off both ends, so `n` frames need
 * `2*margin + n*frame + (n-1)*spacing` pixels. Solved for `n` and floored,
 * because a frame that does not fit entirely does not exist.
 */
function countAlong(available: number, frame: number, margin: number, spacing: number): number {
  if (frame <= 0) return 0
  const usable = available - 2 * margin
  if (usable < frame) return 0
  return Math.floor((usable + spacing) / (frame + spacing))
}

/**
 * How far along the axis the frames actually reach, measured from 0.
 *
 * The trailing margin counts as covered — it is blank border the human asked
 * for, not pixels the grid failed to reach — so a sheet whose settings describe
 * it exactly reports nothing uncovered.
 */
function coveredLength(count: number, frame: number, margin: number, spacing: number): number {
  if (count === 0) return 0
  return 2 * margin + count * frame + (count - 1) * spacing
}
