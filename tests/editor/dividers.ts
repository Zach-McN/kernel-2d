import type { Page } from '@playwright/test'

/**
 * Finding the draggable divider between two panels, shared by every browser
 * test that resizes one.
 *
 * Two things it is careful about, and both were learned the hard way
 * (`editor-verification` W21):
 *
 * - **Nearest, not first-within-a-window.** Each copy of this used to accept
 *   any divider whose middle was within twelve pixels of the x it was given,
 *   which is a number that quietly encodes how much space the layout puts
 *   between panels. The day the panels gained a gap, the divider was further
 *   away than twelve pixels from the thing the caller had measured and the
 *   test failed with "there is no divider here". Nearest-wins has no such
 *   number in it.
 * - **Disabled ones do not count.** Dockview marks a divider disabled when the
 *   panels either side are already at their limits, and dragging one of those
 *   fails for a reason that has nothing to do with what is being tested.
 */

/** How far from the given x a divider may be and still be *that* divider. */
const REACH = 40

export interface DividerHandle {
  x: number
  y: number
}

export async function verticalDividerNear(page: Page, x: number): Promise<DividerHandle | null> {
  const sashes = page.locator('.dv-sash:not(.dv-disabled)')
  let best: { handle: DividerHandle; distance: number } | null = null

  for (let index = 0; index < (await sashes.count()); index += 1) {
    const box = await sashes.nth(index).boundingBox()
    if (box === null) continue
    if (box.height <= box.width) continue // horizontal: divides top from bottom, not left from right

    const middle = box.x + box.width / 2
    const distance = Math.abs(middle - x)
    if (distance > REACH) continue
    if (best !== null && distance >= best.distance) continue

    best = { handle: { x: middle, y: box.y + box.height / 2 }, distance }
  }

  return best?.handle ?? null
}
