import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { showPanel } from './panels.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { assetRow, openFolder, selectAsset, showTree } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Selecting several files in the Assets panel, and the one verb the plural
 * buys — Delete over all of them — against the real editor, service and folder.
 *
 * Every deletion here is of a copy the test made a moment earlier, because a
 * PNG the browser suite deletes stays deleted for the rest of the run
 * (`editor-verification` W14): the sample's own art is never touched.
 */

const UI = 'assets/textures/ui'
const HEART = `${UI}/icon-heart.png`
const BUTTON_IDLE = `${UI}/button-idle.png`
const BUTTON_HOVER = `${UI}/button-hover.png`
const SPARE_A = `${UI}/spare-a.png`
const SPARE_B = `${UI}/spare-b.png`

/** The human's budget, from "within a second". */
const WITHIN_A_SECOND = 1_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test.afterEach(() => {
  for (const spare of [SPARE_A, SPARE_B]) fs.rmSync(fileIn(spare), { force: true })
})

// --- reading and driving ----------------------------------------------------

function fileIn(relative: string): string {
  return path.join(editorTestProjectPath(), relative.replaceAll('/', path.sep))
}

const selectedRows = (page: Page): Locator => page.locator('[data-asset-path][data-selected="true"]')

async function selectedPaths(page: Page): Promise<string[]> {
  return selectedRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-asset-path') ?? ''))
}

/** Puts two copies of the heart into the ui folder and waits until the panel shows them. */
async function makeSpares(page: Page): Promise<void> {
  fs.copyFileSync(fileIn(HEART), fileIn(SPARE_A))
  fs.copyFileSync(fileIn(HEART), fileIn(SPARE_B))
  await showTree(page)
  await openFolder(page, 'assets')
  await openFolder(page, 'assets/textures')
  await openFolder(page, UI)
  await expect(assetRow(page, SPARE_A)).toBeVisible({ timeout: WITHIN_A_SECOND + 2_000 })
  await expect(assetRow(page, SPARE_B)).toBeVisible()
}

// --- acceptance: selecting several -----------------------------------------

test('Ctrl-click adds a second file, and the Inspector says how many rather than describing one', async ({
  page,
}) => {
  await selectAsset(page, HEART)
  await assetRow(page, BUTTON_IDLE).click({ modifiers: ['Control'] })

  expect((await selectedPaths(page)).sort()).toEqual([BUTTON_IDLE, HEART].sort())
  await expect(page.getByTestId('inspector-many-files')).toHaveText('2 files selected — pick one to edit its settings.')

  // Ctrl-click again takes it out; back to one, and the Inspector describes it.
  await assetRow(page, BUTTON_IDLE).click({ modifiers: ['Control'] })
  await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting', HEART)
})

test('Shift-click selects the rows between, in the tree’s own order, and a plain click collapses', async ({
  page,
}) => {
  await selectAsset(page, BUTTON_HOVER)
  await assetRow(page, HEART).click({ modifiers: ['Shift'] })

  // button-hover, button-idle, icon-heart — the three files of that folder in order.
  expect(await selectedPaths(page)).toEqual([BUTTON_HOVER, BUTTON_IDLE, HEART])

  await assetRow(page, BUTTON_IDLE).click()
  expect(await selectedPaths(page)).toEqual([BUTTON_IDLE])
})

test('Shift-click in the icon view ranges over that folder’s tiles', async ({ page }) => {
  await selectAsset(page, HEART)
  await page.getByTestId('assets-settings').click()
  await page.getByTestId('assets-view-icons').click()
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'icons')
  // The grid shows the selected file's folder after the switch.
  const grid = page.getByTestId('assets-icons')
  await expect(grid.locator(`[data-asset-path="${BUTTON_HOVER}"]`)).toBeVisible()

  await grid.locator(`[data-asset-path="${BUTTON_HOVER}"]`).click({ modifiers: ['Shift'] })
  expect(await selectedPaths(page)).toEqual([BUTTON_HOVER, BUTTON_IDLE, HEART])
})

test('a folder always selects alone', async ({ page }) => {
  await selectAsset(page, HEART)
  await assetRow(page, UI).click({ modifiers: ['Control'] })
  expect(await selectedPaths(page)).toEqual([UI])
  await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting', UI)
})

// --- acceptance: deleting several -------------------------------------------

test('Delete on a right-clicked group names how many, and the second press removes them all', async ({
  page,
}) => {
  await makeSpares(page)
  await assetRow(page, SPARE_A).click()
  await assetRow(page, SPARE_B).click({ modifiers: ['Control'] })
  await assetRow(page, SPARE_B).click({ button: 'right' })

  const menu = page.getByTestId('assets-file-menu')
  await expect(menu).toHaveAttribute('data-file-count', '2')
  await expect(page.getByTestId('assets-file-menu-name')).toHaveText('2 files')
  // Rename and Move are one file at a time, and the menu says so.
  await expect(page.getByTestId('move-file-single-only')).toContainText('one file at a time')
  await expect(page.getByTestId('move-file-name')).toHaveCount(0)

  await page.getByTestId('move-file-delete').click()
  await expect(page.getByTestId('move-file-uses')).toContainText('these 2 files')
  await expect(page.getByTestId('move-file-delete')).toHaveText('Delete all 2 anyway')
  expect(fs.existsSync(fileIn(SPARE_A))).toBe(true)

  await page.getByTestId('move-file-delete').click()
  await expect.poll(() => fs.existsSync(fileIn(SPARE_A)) || fs.existsSync(fileIn(SPARE_B))).toBe(false)
  await expect(assetRow(page, SPARE_A)).toHaveCount(0, { timeout: WITHIN_A_SECOND + 2_000 })
  await expect(assetRow(page, SPARE_B)).toHaveCount(0)
  await expect(page.getByTestId('assets-file-menu')).toHaveCount(0)

  // Not undoable, exactly as one file's delete is not.
  await page.keyboard.press('ControlOrMeta+z')
  expect(fs.existsSync(fileIn(SPARE_A))).toBe(false)
})

test('right-clicking a file outside the group makes it the only selection', async ({ page }) => {
  await selectAsset(page, HEART)
  await assetRow(page, BUTTON_IDLE).click({ modifiers: ['Control'] })
  await assetRow(page, BUTTON_HOVER).click({ button: 'right' })

  await expect(page.getByTestId('assets-file-menu')).toHaveAttribute('data-file-count', '1')
  expect(await selectedPaths(page)).toEqual([BUTTON_HOVER])
})

// --- acceptance: the group and the folder listing ---------------------------

test('a file arriving elsewhere keeps the group, and one leaving drops out of it', async ({ page }) => {
  await makeSpares(page)
  await assetRow(page, SPARE_A).click()
  await assetRow(page, SPARE_B).click({ modifiers: ['Control'] })
  await assetRow(page, HEART).click({ modifiers: ['Control'] })
  expect(await selectedPaths(page)).toHaveLength(3)

  // Something new far away: the group is untouched.
  fs.copyFileSync(fileIn(HEART), fileIn('assets/textures/tiles/spare-c.png'))
  await expect(assetRow(page, 'assets/textures/tiles')).toBeVisible()
  await expect(page.getByTestId('inspector-many-files')).toHaveAttribute('data-inspecting-count', '3')
  fs.rmSync(fileIn('assets/textures/tiles/spare-c.png'), { force: true })

  // One of the group deleted outside the editor: it leaves the group.
  fs.rmSync(fileIn(SPARE_B))
  await expect(assetRow(page, SPARE_B)).toHaveCount(0, { timeout: WITHIN_A_SECOND + 2_000 })
  await expect(page.getByTestId('inspector-many-files')).toHaveAttribute('data-inspecting-count', '2')
  expect((await selectedPaths(page)).sort()).toEqual([HEART, SPARE_A].sort())
})

test('dragging one of a group into the level places that one file only', async ({ page }) => {
  await selectAsset(page, 'scenes/level-01.json')
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-scene-showing', 'scenes/level-01.json')
  const before = await page.getByTestId('outliner-panel').locator('[data-entity-id]').count()

  await selectAsset(page, HEART)
  await assetRow(page, BUTTON_IDLE).click({ modifiers: ['Control'] })
  // Selecting a texture brings the Texture tab forward over the Viewport
  // (`editor-verification` W12); the level has to be in front to be dropped on.
  await showPanel(page, 'Viewport')
  await assetRow(page, BUTTON_IDLE).dragTo(page.getByTestId('viewport-stage'))

  const rows = page.getByTestId('outliner-panel').locator('[data-entity-id]')
  await expect(rows).toHaveCount(before + 1)
  await expect(rows.last()).toContainText('button-idle')
})

test('a picture of a group with its menu open', async ({ page }, testInfo) => {
  await selectAsset(page, BUTTON_HOVER)
  await assetRow(page, HEART).click({ modifiers: ['Shift'] })
  await assetRow(page, HEART).click({ button: 'right' })
  await expect(page.getByTestId('assets-file-menu')).toHaveAttribute('data-file-count', '3')
  await page.getByTestId('assets-panel').screenshot({ path: testInfo.outputPath('assets-multi-select.png') })
})
