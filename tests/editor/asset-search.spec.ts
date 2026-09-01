import { expect, test, type Locator, type Page } from '@playwright/test'

import { showTree } from './select-asset.js'

/**
 * The search box on the Assets panel's bar: type a word, and the folder
 * underneath becomes one list of everything in the project called that, from
 * whichever view you were in. Clear it and the view comes back.
 *
 * Everything is addressed inside the results pane, because a search result and
 * a tree row for the same file carry the same `data-asset-path` — and the point
 * of the search is that the results exist where the tree does not.
 */

const KNIGHT = 'assets/textures/characters/knight-idle.png'
const RUN = 'assets/textures/characters/knight-run-strip.png'
const SLIME = 'assets/textures/characters/slime.png'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

const box = (page: Page): Locator => page.getByTestId('assets-search')
const results = (page: Page): Locator => page.getByTestId('assets-search-results')
const found = (page: Page, assetPath: string): Locator =>
  results(page).locator(`[data-asset-path="${assetPath}"]`)

test('typing a word lists every file called that, from anywhere, with where it lives', async ({ page }) => {
  // From the icon view at the top of the project — nothing under `assets` is on screen.
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'icons')

  await box(page).fill('knight')

  await expect(results(page)).toBeVisible()
  await expect(found(page, KNIGHT)).toBeVisible()
  await expect(found(page, RUN)).toBeVisible()
  await expect(found(page, SLIME)).toHaveCount(0)
  await expect(found(page, KNIGHT).getByTestId('assets-search-where')).toHaveText('assets/textures/characters')
  await expect(page.getByTestId('assets-search-summary')).toContainText('2 files called “knight”')
  // The folder view is gone while the search says something.
  await expect(page.getByTestId('assets-icons')).toBeHidden()
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-search', 'knight')
})

test('it does not care about case, and it matches names rather than folders', async ({ page }) => {
  await box(page).fill('KNIGHT')
  await expect(found(page, KNIGHT)).toBeVisible()

  await box(page).fill('textures')
  // One folder called that; not the pictures inside it.
  await expect(results(page).locator('[data-asset-path]')).toHaveCount(1)
  await expect(found(page, 'assets/textures')).toHaveAttribute('data-kind', 'directory')
  await expect(page.getByTestId('assets-search-summary')).toContainText('1 folder')
})

test('nothing found is a sentence with the words in it', async ({ page }) => {
  await box(page).fill('zzzz')

  await expect(page.getByTestId('assets-search-summary')).toContainText('Nothing in the project is called “zzzz”')
  await expect(results(page).locator('[data-asset-path]')).toHaveCount(0)
})

test('clearing the box brings the view back exactly as it was', async ({ page }) => {
  await showTree(page)
  await box(page).fill('slime')
  await expect(results(page)).toBeVisible()
  await expect(page.getByTestId('assets-list')).toBeHidden()

  await box(page).fill('')

  await expect(results(page)).toBeHidden()
  await expect(page.getByTestId('assets-list')).toBeVisible()
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'list')
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-search', '')
})

test('Esc clears it, and a second Esc hands the keys back', async ({ page }) => {
  await box(page).fill('slime')
  await expect(results(page)).toBeVisible()

  await box(page).press('Escape')
  await expect(box(page)).toHaveValue('')
  await expect(results(page)).toBeHidden()
  await expect(box(page)).toBeFocused()

  await box(page).press('Escape')
  await expect(box(page)).not.toBeFocused()
})

test('a result selects like a row, so the Inspector answers about it', async ({ page }) => {
  await box(page).fill('slime')

  await found(page, SLIME).click()

  await expect(found(page, SLIME)).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting', SLIME)
  // And it has been opened to in the tree, so clearing the search lands on it.
  await box(page).fill('')
  await showTree(page)
  await expect(page.getByTestId('assets-list').locator(`[data-asset-path="${SLIME}"]`)).toBeVisible()
})

test('a result keeps its import-settings badge, and the sidecar is never a result of its own', async ({
  page,
}) => {
  await box(page).fill('knight-idle')

  await expect(found(page, KNIGHT)).toHaveAttribute('data-has-settings', 'true')
  await expect(found(page, `${KNIGHT}.meta`)).toHaveCount(0)
})

test('right-clicking a result opens the file menu on it', async ({ page }) => {
  await box(page).fill('slime')

  await found(page, SLIME).click({ button: 'right' })

  await expect(page.getByTestId('assets-file-menu')).toHaveAttribute('data-file', SLIME)
})

test('double-clicking a folder result clears the search and walks into that folder', async ({ page }) => {
  await box(page).fill('characters')
  await expect(found(page, 'assets/textures/characters')).toBeVisible()

  await found(page, 'assets/textures/characters').dblclick()

  await expect(box(page)).toHaveValue('')
  await expect(results(page)).toBeHidden()
  await expect(page.getByTestId('assets-breadcrumb')).toContainText('characters')
  await expect(page.getByTestId('assets-icons').locator(`[data-asset-path="${SLIME}"]`)).toBeVisible()
})

test('the search survives dragging the panel somewhere else', async ({ page }) => {
  await box(page).fill('slime')
  await expect(results(page)).toBeVisible()

  const tab = page.locator('.dv-tab', { hasText: 'Assets' })
  const target = page.getByTestId('outliner-panel')
  await tab.dragTo(target)

  await expect(box(page)).toHaveValue('slime')
  await expect(found(page, SLIME)).toBeVisible()
})

test('leaves a picture of a search behind', async ({ page }, testInfo) => {
  await box(page).fill('knight')
  await expect(found(page, RUN)).toBeVisible()

  await page.getByTestId('assets-panel').screenshot({ path: testInfo.outputPath('assets-search.png') })
})
