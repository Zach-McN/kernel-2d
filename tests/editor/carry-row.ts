import { expect, type Page } from '@playwright/test'

import { outlinerRow } from './scene-view.js'

/**
 * Carrying a row in the Outliner, for the specs that do it — the parenting
 * gesture's own and the filter's.
 *
 * Plain pointer presses and moves, because that is what the gesture is: rows
 * are carried by the editor's own press-move-release rather than by the
 * browser's drag-and-drop (`editor-ui` U37, amended 2026-09-02), so a test
 * drives it exactly as it drives a drag in the picture. Nothing here knows
 * about `dataTransfer`.
 */

/** The list itself — the thing that scrolls, and so the thing the wheel is aimed at. */
export const outlinerList = (page: Page) => page.locator('.outliner__list')

/**
 * Hold the pointer over a row: the top or bottom sixth (well inside the outer
 * thirds, which mean before and after) or the very middle (which means onto).
 */
export async function moveOverRow(page: Page, target: string, edge: 'before' | 'after' | 'into'): Promise<void> {
  const box = await outlinerRow(page, target).boundingBox()
  if (box === null) throw new Error(`no row for ${target}`)
  const fraction = edge === 'before' ? 0.15 : edge === 'after' ? 0.85 : 0.5
  const spot = { x: box.x + box.width / 2, y: box.y + box.height * fraction }
  // Two moves: the first advances the carry, the second is the one that is read.
  await page.mouse.move(spot.x, spot.y, { steps: 6 })
  await page.mouse.move(spot.x, spot.y)
}

/** Pick a row up and hold it over the target, without letting go. */
export async function carryRow(
  page: Page,
  dragged: string,
  target: string,
  edge: 'before' | 'after' | 'into',
): Promise<void> {
  await outlinerRow(page, dragged).hover()
  await page.mouse.down()
  await moveOverRow(page, target, edge)
}

/** Pick a row up, hold it over the target, and let go. */
export async function dragRow(
  page: Page,
  dragged: string,
  target: string,
  edge: 'before' | 'after' | 'into',
): Promise<void> {
  await carryRow(page, dragged, target, edge)
  await page.mouse.up()
}

/** Which row is being carried, by id, or '' for none. */
export async function carrying(page: Page): Promise<string> {
  return (await page.getByTestId('outliner-panel').getAttribute('data-carrying')) ?? ''
}

/** How far down the list has been scrolled, in pixels. */
export async function scrollTop(page: Page): Promise<number> {
  return outlinerList(page).evaluate((element) => element.scrollTop)
}

/** Whether there is more list than fits — the situation the wheel is needed for. */
export async function listScrolls(page: Page): Promise<boolean> {
  return outlinerList(page).evaluate((element) => element.scrollHeight > element.clientHeight + 1)
}

/**
 * Add entities until the list is longer than the panel. The gesture only needs
 * the wheel when the row you are aiming at is off screen, so a test of it has
 * to build that situation rather than assume the sample level is long enough.
 */
export async function fillUntilItScrolls(page: Page, limit = 60): Promise<void> {
  for (let added = 0; added < limit; added += 1) {
    if (await listScrolls(page)) return
    await page.getByTestId('entity-add').click()
  }
  expect(await listScrolls(page)).toBe(true)
}
