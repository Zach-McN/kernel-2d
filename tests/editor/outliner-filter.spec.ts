import { expect, test, type Locator, type Page } from '@playwright/test'

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

test('a row cannot be dragged while a filter is on, and can again once it is cleared', async ({ page }) => {
  await expect(outlinerRow(page, 'Knight')).toHaveAttribute('draggable', 'true')

  await box(page).fill('knight')
  await expect(outlinerRow(page, 'Knight')).toHaveAttribute('draggable', 'false')

  await box(page).fill('')
  await expect(outlinerRow(page, 'Knight')).toHaveAttribute('draggable', 'true')
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
