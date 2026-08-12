import { ZOOM_STEPS } from '../../runtime/scene/scale-steps'

/**
 * Zooming, as the editor offers it: the two step buttons and the wording.
 *
 * The ladder itself, and fitting a picture to a space, live in
 * `runtime/scene/scale-steps.ts` — they moved there when the exported game had to
 * frame its own starting level, because anything the shipping layer reads belongs
 * to the shipping layer (`editor-kernel` D20). Both halves are re-exported from
 * here so every panel keeps importing zoom from one place.
 *
 * What is left is the part a shipped game has no use for: stepping up and down,
 * which is a pair of buttons, and how a scale is written on screen.
 */

export { ZOOM_STEPS, fitStep } from '../../runtime/scene/scale-steps'

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
