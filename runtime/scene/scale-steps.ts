/**
 * Which magnifications a picture of a scene is drawn at, and nothing in between.
 *
 * Every step is a whole number of screen pixels per image pixel, or a whole
 * number of image pixels per screen pixel. That restriction is the point: pixel
 * art at 3.4× has some rows two pixels tall and some three, which reads as a
 * badly drawn sprite rather than as a badly chosen zoom — so the human ends up
 * looking at an artefact of the viewport and blaming their own art.
 *
 * **This began as editor policy and moved here the day the shipped game needed
 * it** (`editor-kernel` D20: anything the layer that ships reads belongs to the
 * layer that ships). An exported game frames its starting level, which means
 * picking a scale, and it wants the *same* rule for the *same* reason — crisp
 * pixels — so leaving the ladder in `editor/` would have meant the game either
 * inventing a second one or fitting at a fractional scale and looking worse than
 * the editor it came out of.
 *
 * What stayed behind in `editor/shell/zoom.ts` is the part that is genuinely the
 * editor's: stepping up and down with buttons, and how a scale is written on
 * screen. A shipped game has neither.
 */

export const ZOOM_STEPS: readonly number[] = [
  1 / 16,
  1 / 8,
  1 / 4,
  1 / 2,
  1,
  2,
  3,
  4,
  6,
  8,
  12,
  16,
  24,
  32,
]

/** Room left around the picture so it does not touch the edges. */
const PADDING = 16

/**
 * The largest step at which a picture of this size fits the space available.
 *
 * Falls back to the smallest step for something too big for even that — showing
 * a corner of an enormous texture beats showing nothing, and the alternative is
 * a zoom level that is not on the ladder.
 */
export function fitStep(
  contentWidth: number,
  contentHeight: number,
  availableWidth: number,
  availableHeight: number,
): number {
  const width = Math.max(1, availableWidth - PADDING)
  const height = Math.max(1, availableHeight - PADDING)
  if (contentWidth <= 0 || contentHeight <= 0) return 1

  const smallest = ZOOM_STEPS[0] ?? 1
  let best = smallest

  for (const step of ZOOM_STEPS) {
    if (contentWidth * step <= width && contentHeight * step <= height) best = step
  }

  return best
}
