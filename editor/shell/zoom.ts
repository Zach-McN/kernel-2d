/**
 * Which magnifications the viewport will use, and nothing in between.
 *
 * Every step is a whole number of screen pixels per image pixel, or a whole
 * number of image pixels per screen pixel. That restriction is the point:
 * pixel art at 3.4× has some rows two pixels tall and some three, which reads
 * as a badly drawn sprite rather than as a badly chosen zoom — so the human
 * would be looking at an artefact of the viewport and blaming their own art.
 *
 * Fitting picks the largest of these that fits, rather than the exact ratio
 * that would fill the panel.
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

/** Room left around the image so it does not touch the panel's edges. */
const PADDING = 16

/**
 * The largest step at which an image of this size fits the panel.
 *
 * Falls back to the smallest step for an image too big for even that — showing
 * a corner of an enormous texture beats showing nothing, and the alternative is
 * a zoom level that is not on the ladder.
 */
export function fitStep(imageWidth: number, imageHeight: number, panelWidth: number, panelHeight: number): number {
  const availableWidth = Math.max(1, panelWidth - PADDING)
  const availableHeight = Math.max(1, panelHeight - PADDING)
  if (imageWidth <= 0 || imageHeight <= 0) return 1

  const smallest = ZOOM_STEPS[0] ?? 1
  let best = smallest

  for (const step of ZOOM_STEPS) {
    if (imageWidth * step <= availableWidth && imageHeight * step <= availableHeight) best = step
  }

  return best
}

/** The next step up, or the same one at the top of the ladder. */
export function stepUp(scale: number): number {
  return ZOOM_STEPS.find((step) => step > scale) ?? scale
}

/** The next step down, or the same one at the bottom. */
export function stepDown(scale: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < scale) ?? scale
}

/** How a scale is written on screen: `8×`, or `1/4×` below one. */
export function describeZoom(scale: number): string {
  if (scale >= 1) return `${Math.round(scale)}×`
  return `1/${Math.round(1 / scale)}×`
}
