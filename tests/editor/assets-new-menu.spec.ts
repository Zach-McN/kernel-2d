import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { gapFrom } from './floating.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { openNewDocument, showTree } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * The make-a-file menu: the `+` in the Assets bar, and a right-click on the
 * empty part of the browser.
 *
 * Making a level used to be a permanent row under the folder listing. It is a
 * menu now, so the panel shows the project folder and nothing else — and the
 * two doors open **one** menu, which is what most of this file is about. What a
 * made file *is* stays in `new-scene.spec.ts` and `prefabs.spec.ts`; this is
 * about how it is reached.
 */

const WITHIN_A_SECOND = 1_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

// --- the panel is about the folder now --------------------------------------

test('the panel shows no make-a-file row until it is asked for', async ({ page }) => {
  await expect(page.getByTestId('new-document')).toBeHidden()
  // One line under the folder listing names the press instead.
  await expect(page.getByTestId('assets-hint')).toContainText('Right-click')
})

// --- the button ------------------------------------------------------------

test('the + opens the menu, and pressing it again puts it away', async ({ page }) => {
  await page.getByTestId('assets-new-document').click()
  await expect(page.getByTestId('assets-new-menu')).toBeVisible()

  await page.getByTestId('assets-new-document').click()

  await expect(page.getByTestId('assets-new-menu')).toBeHidden()
})

test('the cursor is in the name field the moment it opens', async ({ page }) => {
  await openNewDocument(page)

  await expect(page.getByTestId('new-document-name')).toBeFocused()
})

test('Esc closes it and the + has the keys again', async ({ page }) => {
  await openNewDocument(page)

  await page.keyboard.press('Escape')

  await expect(page.getByTestId('assets-new-menu')).toBeHidden()
  await expect(page.getByTestId('assets-new-document')).toBeFocused()
})

test('a press somewhere else closes it', async ({ page }) => {
  await openNewDocument(page)

  await page.getByTestId('viewport-panel').click({ position: { x: 8, y: 8 } })

  await expect(page.getByTestId('assets-new-menu')).toBeHidden()
})

// --- the right-click -------------------------------------------------------

test('right-clicking the empty part of the browser opens the same menu, where the press landed', async ({
  page,
}) => {
  const spot = await emptySpot(page)
  await page.mouse.click(spot.x, spot.y, { button: 'right' })

  const menu = page.getByTestId('assets-new-menu')
  await expect(menu).toBeVisible()
  await expect(page.getByTestId('new-document-name')).toBeFocused()

  // Next to the press rather than somewhere fixed — measured to the nearest
  // edge, because near the bottom of the panel the menu opens *above* the press
  // rather than sliding up the panel (`./floating.ts`).
  expect(await gapFrom(menu, spot)).toBeLessThan(40)
})

test('right-clicking a file opens the other menu — that press is about the file', async ({ page }) => {
  await showTree(page)

  await page.locator('[data-asset-path="project.json"]').click({ button: 'right' })

  await expect(page.getByTestId('assets-new-menu')).toBeHidden()
  await expect(page.getByTestId('assets-file-menu')).toBeVisible()
})

test('a level made from the right-click lands where the menu said, and the menu goes away', async ({
  page,
}) => {
  // The icon view, where a single click selects the folder and the space under
  // the tiles is reliably empty — in the tree, rows are full-width and a long
  // enough project leaves nowhere to right-click.
  await page.locator('[data-asset-path="scenes"]').click()

  const spot = await emptySpot(page)
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(page.getByTestId('assets-new-menu')).toBeVisible()

  await page.getByTestId('new-document-name').fill('level-03')
  await expect(page.getByTestId('new-document-path')).toContainText('scenes/level-03.json')
  await page.getByTestId('new-scene-create').click()

  await expect
    .poll(() => fs.existsSync(fileFor('scenes/level-03.json')), { timeout: WITHIN_A_SECOND + 1_000 })
    .toBe(true)
  await expect(page.getByTestId('assets-new-menu')).toBeHidden()
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute(
    'data-scene-showing',
    'scenes/level-03.json',
  )
})

// --- one menu, two doors ---------------------------------------------------

test('only one menu is ever open, whichever door was used last', async ({ page }) => {
  await openNewDocument(page)

  const spot = await emptySpot(page)
  await page.mouse.click(spot.x, spot.y, { button: 'right' })

  await expect(page.getByTestId('assets-new-menu')).toHaveCount(1)
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-new-document', 'browser')

  await page.getByTestId('assets-new-document').click()

  await expect(page.getByTestId('assets-new-menu')).toHaveCount(1)
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-new-document', 'bar')
})

test('a picture of the menu the browser opens', async ({ page }, testInfo) => {
  const spot = await emptySpot(page)
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(page.getByTestId('assets-new-menu')).toBeVisible()
  await page.getByTestId('assets-panel').screenshot({ path: testInfo.outputPath('assets-new-menu.png') })
})

// --- driving ---------------------------------------------------------------

function fileFor(projectRelative: string): string {
  return path.join(editorTestProjectPath(), projectRelative.replaceAll('/', path.sep))
}

/**
 * A point in the browser that is not on a file or a folder.
 *
 * Found by measuring the tiles rather than by aiming near the bottom of the
 * panel: how far down the listing reaches depends on how tall a tile is, and a
 * tile grew by half its height the day pictures were drawn on them. A press
 * aimed at a guess landed on `project.json` and opened the wrong menu, which is
 * the right behaviour for that press and a broken test — so the spot is
 * *derived* now, and the expectation below is what says out loud that this
 * gesture needs somewhere to be made.
 */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const body = await page.getByTestId('assets-panel').locator('.assets__body').boundingBox()
  const listing = await page.getByTestId('assets-grid').boundingBox()
  expect(body).not.toBeNull()
  expect(listing).not.toBeNull()

  const below = (listing?.y ?? 0) + (listing?.height ?? 0) + 12
  const bottom = (body?.y ?? 0) + (body?.height ?? 0)
  expect(below, 'the folder listing fills the panel, so there is no background to press on').toBeLessThan(
    bottom - 8,
  )

  return { x: (body?.x ?? 0) + 24, y: below }
}
