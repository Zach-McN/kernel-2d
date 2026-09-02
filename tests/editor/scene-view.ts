import { expect, type Locator, type Page } from '@playwright/test'

import { selectAsset } from './select-asset.js'

/**
 * Reading the level as it is on screen, shared by every spec that opens one and
 * then asks where things are.
 *
 * Each of these used to be copied into every spec that needed it — the
 * settling poll nine times, byte for byte — because a spec must not import
 * another spec and nobody makes a shared module for a one-liner. The same
 * helpers beside `panels.ts` and `select-asset.ts` is where they belong.
 */

export const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')

/** Every entity row in the Outliner, in the level's own order. */
export const outlinerRows = (page: Page): Locator =>
  page.getByTestId('outliner-panel').locator('[data-entity-id]')

/**
 * The first Outliner row whose text contains this name. Right for reaching a
 * row and wrong for counting them — the sample level has both `Knight` and
 * `Knight running`.
 */
export const outlinerRow = (page: Page, name: string): Locator =>
  outlinerRows(page).filter({ hasText: name }).first()

/** The magnification the picture is drawn at, as the viewport reports it. */
export async function cameraScale(page: Page): Promise<number> {
  return Number(await viewport(page).getAttribute('data-scene-scale'))
}

/** The camera, once it has stopped moving — opening a scene frames it a beat later. */
export async function settled(page: Page): Promise<number> {
  let previous = Number.NaN
  await expect
    .poll(
      async () => {
        const now = await cameraScale(page)
        const same = now === previous
        previous = now
        return same && Number.isFinite(now)
      },
      { intervals: [120, 120, 120, 120, 120, 120, 120, 120] },
    )
    .toBe(true)
  return previous
}

/** A level selected in the Assets panel, drawn, and its camera at rest. */
export async function openScene(page: Page, scenePath: string): Promise<void> {
  await selectAsset(page, scenePath)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', scenePath)
  await settled(page)
}

/** The middle of the selected entity's outline, in window coordinates. */
export async function outlineCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('scene-selected-bounds').boundingBox()
  expect(box).not.toBeNull()
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
}
