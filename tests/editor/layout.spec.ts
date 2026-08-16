import fs from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { showTree } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * The window remembering how it was arranged — the panels, the Assets view and
 * the folder — across a reload, and Reset layout putting it all back.
 *
 * Every test gets a fresh browser context, so nothing here leaks into another
 * spec; what a test remembers, it remembers only across its own reloads.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-panel')).toBeVisible()
})

const tab = (page: Page, title: string) => page.getByRole('tab', { name: title, exact: true })

/** The group that holds both these tabs, if any. */
const groupWith = (page: Page, a: string, b: string) =>
  page.locator('.dv-groupview').filter({ has: tab(page, a) }).filter({ has: tab(page, b) })

/** Closes a tab. Brought to the front first: the close mark only shows on the front tab. */
async function closeTab(page: Page, title: string): Promise<void> {
  await tab(page, title).click()
  await tab(page, title).locator('.dv-default-tab-action').click()
  await expect(tab(page, title)).toHaveCount(0)
}

async function reload(page: Page): Promise<void> {
  await page.reload()
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-panel')).toBeVisible()
}

test('a closed panel, a re-docked panel, the Assets view and the folder are all still there after a reload', async ({
  page,
}) => {
  await closeTab(page, 'Texture')

  // Drag the Inspector's tab into the Outliner's group (the recipe from
  // shell.spec: a quarter of the way across, off the dividing line).
  await tab(page, 'Inspector').dragTo(tab(page, 'Outliner'), { targetPosition: { x: 20, y: 12 } })
  await expect(groupWith(page, 'Inspector', 'Outliner')).toHaveCount(1)

  // The Assets panel: the tree, standing in a folder.
  await showTree(page)
  await page.getByTestId('assets-settings').click()
  await page.getByTestId('assets-view-split').click()
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'split')
  // Into a folder by way of the grid's tiles: two levels down.
  const grid = page.getByTestId('assets-icons')
  await grid.locator('[data-asset-path="assets"]').dblclick()
  await grid.locator('[data-asset-path="assets/textures"]').dblclick()
  await expect(grid.locator('[data-asset-path="assets/textures/ui"]')).toBeVisible()

  // Give the debounced save a beat, then reload.
  await page.waitForTimeout(500)
  await reload(page)

  await expect(tab(page, 'Texture')).toHaveCount(0)
  await expect(groupWith(page, 'Inspector', 'Outliner')).toHaveCount(1)
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'split')
  await expect(page.getByTestId('assets-icons').locator('[data-asset-path="assets/textures/ui"]')).toBeVisible()
  await expect(page.locator('[data-crumb-path="assets/textures"]')).toHaveCount(1)

  await page.screenshot({ path: test.info().outputPath('layout-remembered.png') })
})

test('Reset layout puts everything back, and the default is what a later reload finds', async ({ page }) => {
  await closeTab(page, 'Texture')
  await showTree(page)
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'list')
  await page.waitForTimeout(500)

  await page.getByTestId('windows-menu-button').click()
  await page.getByTestId('windows-reset-layout').click()

  await expect(page.getByTestId('windows-menu')).toBeHidden()
  await expect(tab(page, 'Texture')).toHaveCount(1)
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'icons')
  await expect(page.locator('[data-crumb-path=""]')).toHaveCount(1)

  await page.waitForTimeout(500)
  await reload(page)
  await expect(tab(page, 'Texture')).toHaveCount(1)
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'icons')
})

test('a remembered layout that no longer parses is discarded for the default, never an error', async ({
  page,
}) => {
  await page.evaluate(() => {
    const { localStorage } = globalThis as unknown as { localStorage: Storage }
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('kernel2d:layout:') && key !== 'kernel2d:layout:last-project') {
        localStorage.setItem(key, '{"format":"kernel2d.layout","version":1,"dock":{"grid":"nonsense"}}')
      }
    }
  })
  await reload(page)
  // Every default panel is there, and the editor works.
  await expect(tab(page, 'Texture')).toHaveCount(1)
  await expect(tab(page, 'Outliner')).toHaveCount(1)
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test('nothing about the layout is written into the project folder', async ({ page }) => {
  const before = fs.readdirSync(editorTestProjectPath()).sort()
  await closeTab(page, 'Texture')
  await page.waitForTimeout(500)
  // The only place it lives is this browser.
  const keys = await page.evaluate(() =>
    Object.keys((globalThis as unknown as { localStorage: Storage }).localStorage).filter((key) =>
      key.startsWith('kernel2d:layout:'),
    ),
  )
  expect(keys.length).toBeGreaterThanOrEqual(2)
  expect(fs.readdirSync(editorTestProjectPath()).sort()).toEqual(before)
})
