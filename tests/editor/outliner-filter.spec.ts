import { expect, test, type Locator, type Page } from '@playwright/test'

import { carryRow, carrying, dragRow } from './carry-row.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { outlinerRow, outlinerRows } from './scene-view.js'
import { selectAsset } from './select-asset.js'

/**
 * The Outliner's filter box: type, and only the rows whose name contains it
 * stay on screen. It narrows what is shown and nothing else — the level, the
 * selection and the draw order are exactly as they were, which is what every
 * assertion here is about once the first one has shown the rows go.
 */

const LEVEL_ONE = 'scenes/level-01.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await selectAsset(page, LEVEL_ONE)
  await expect(page.getByTestId('outliner-panel')).toHaveAttribute('data-scene', LEVEL_ONE)
})

const box = (page: Page): Locator => page.getByTestId('entity-filter')
async function names(page: Page): Promise<string[]> {
  return outlinerRows(page).evaluateAll((buttons) =>
    buttons.map((button) => button.querySelector('.entity-row__name')?.textContent ?? ''),
  )
}

test('typing shows only the rows called that, any case, and says how many', async ({ page }) => {
  expect(await names(page)).toHaveLength(5)

  await box(page).fill('KNIGHT')

  expect(await names(page)).toEqual(['Knight', 'Knight running'])
  await expect(page.getByTestId('entity-filter-count')).toHaveText('2 of 5')
  await expect(page.getByTestId('outliner-panel')).toHaveAttribute('data-filter', 'KNIGHT')
})

test('every word has to match, so more words narrow', async ({ page }) => {
  await box(page).fill('knight run')
  expect(await names(page)).toEqual(['Knight running'])
})

test('nothing matching is a sentence with the words in it', async ({ page }) => {
  await box(page).fill('dragon')

  await expect(page.getByTestId('outliner-filter-empty')).toContainText('Nothing here is called “dragon”')
  expect(await names(page)).toHaveLength(0)
})

test('clearing brings every row back, and Esc clears it', async ({ page }) => {
  await box(page).fill('slime')
  expect(await names(page)).toEqual(['Slime'])

  await box(page).press('Escape')

  await expect(box(page)).toHaveValue('')
  expect(await names(page)).toHaveLength(5)
  await expect(page.getByTestId('entity-filter-count')).toHaveCount(0)
})

test('a hidden row is still selected, still in the level, and still where it was', async ({ page }) => {
  await outlinerRow(page, 'Slime').click()
  await expect(page.getByTestId('inspector-name')).toHaveText('Slime')

  await box(page).fill('knight')

  // The Inspector is still on the Slime; the filter did not touch the selection.
  await expect(page.getByTestId('inspector-name')).toHaveText('Slime')
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-scene-selected-count', '1')

  await box(page).fill('')
  await expect(outlinerRow(page, 'Slime')).toHaveAttribute('data-selected', 'true')
  expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
})

/*
 * The filter is how two entities far apart in a long list are found in the
 * first place, so the gesture that attaches one to the other has to survive it.
 * What does not survive is reordering: "between these two rows" may mean
 * "between these two and the nine you cannot see", so the outer thirds answer
 * nothing while a filter is on.
 */

test('a row can still be picked up and dropped onto another to attach it while a filter is on', async ({ page }) => {
  await box(page).fill('knight')
  expect(await names(page)).toEqual(['Knight', 'Knight running'])

  await dragRow(page, 'Knight running', 'Knight', 'into')

  await expect(outlinerRow(page, 'Knight running').locator('..')).toHaveAttribute('data-depth', '1')
  // Still filtered, and the row is still on screen because its name still matches.
  await expect(page.getByTestId('entity-filter-count')).toHaveText('2 of 5')
})

test('but a filtered list cannot be reordered: the outer thirds hold no line and change nothing', async ({ page }) => {
  await box(page).fill('knight')
  const held = await outlinerRow(page, 'Knight running').getAttribute('data-entity-id')

  await carryRow(page, 'Knight running', 'Knight', 'before')

  // Picked up — the refusal is about where it may land, not about the row.
  expect(await carrying(page)).toBe(held)
  await expect(page.locator('.entity-row[data-drop-line]')).toHaveCount(0)

  await page.mouse.up()

  expect(await names(page)).toEqual(['Knight', 'Knight running'])
  await box(page).fill('')
  expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
})

test('the filter survives dragging the panel somewhere else', async ({ page }) => {
  await box(page).fill('knight')
  expect(await names(page)).toHaveLength(2)

  const tab = page.locator('.dv-tab', { hasText: 'Outliner' })
  await tab.dragTo(page.getByTestId('assets-panel'))

  await expect(box(page)).toHaveValue('knight')
  expect(await names(page)).toHaveLength(2)
})

test('leaves a picture of a filtered list behind', async ({ page }, testInfo) => {
  await box(page).fill('knight')
  await expect(page.getByTestId('entity-filter-count')).toHaveText('2 of 5')

  await page.getByTestId('outliner-panel').screenshot({ path: testInfo.outputPath('outliner-filter.png') })
})
