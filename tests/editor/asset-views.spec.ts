import { expect, test, type Locator, type Page } from '@playwright/test'

import { EDITOR_TEST_PROJECT_NAME } from './test-project.js'

/**
 * Spelled here rather than imported from the editor: this suite is in the Node
 * TypeScript project, whose resolution cannot follow the browser half's
 * extensionless imports (`editor-ui` U4).
 */
type AssetView = 'list' | 'icons' | 'split'

/**
 * The three ways of looking at the project folder: the tree, the icon grid, and
 * both at once.
 *
 * Everything here is addressed *inside* the half it is supposed to be in, never
 * by path alone. In the split view the same file has a row and a tile, so a bare
 * `[data-asset-path]` matches two things — and a test that happened to pass on
 * the first of them would be asserting about whichever half the DOM order put
 * first rather than about the one it names.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test.describe('the Assets panel views', () => {
  test('opens on the tree, with no breadcrumb, because a tree is not in one folder', async ({ page }) => {
    await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'list')
    await expect(page.getByTestId('assets-list')).toBeVisible()
    await expect(page.getByTestId('assets-icons')).toBeHidden()
    await expect(page.getByTestId('assets-breadcrumb')).toBeHidden()
  })

  test('the cog offers the three views and marks the one you are in', async ({ page }) => {
    await page.getByTestId('assets-settings').click()

    const menu = page.getByTestId('assets-settings-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText('Icon view')
    await expect(menu).toContainText('Folder view')
    await expect(menu).toContainText('Split view')
    await expect(page.getByTestId('assets-view-list')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('assets-view-icons')).toHaveAttribute('aria-checked', 'false')
  })

  test('the cog menu closes on Escape without changing anything', async ({ page }) => {
    await page.getByTestId('assets-settings').click()
    await expect(page.getByTestId('assets-settings-menu')).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.getByTestId('assets-settings-menu')).toBeHidden()
    await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'list')
  })

  test('the icon view replaces the tree with tiles of the top of the project', async ({ page }) => {
    await chooseView(page, 'icons')

    await expect(page.getByTestId('assets-list')).toBeHidden()
    const grid = page.getByTestId('assets-grid')
    for (const name of ['assets', 'data', 'prefabs', 'scenes', 'project.json']) {
      await expect(grid.locator(`[data-asset-path="${name}"]`)).toBeVisible()
    }
  })

  test('double-clicking a folder opens it, and the breadcrumb says where you are', async ({ page }) => {
    await chooseView(page, 'icons')

    await tile(page, 'assets').dblclick()
    await expect(tile(page, 'assets/textures')).toBeVisible()

    await tile(page, 'assets/textures').dblclick()
    await expect(tile(page, 'assets/textures/characters')).toBeVisible()

    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets', 'textures'])
    await expect(page.locator('[data-crumb-path="assets/textures"]')).toHaveAttribute('aria-current', 'true')
  })

  test('a single press selects without opening, so a folder can be inspected', async ({ page }) => {
    await chooseView(page, 'icons')

    await tile(page, 'scenes').click()

    await expect(tile(page, 'scenes')).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting', 'scenes')
    // Still at the top of the project: one press does not walk into anything.
    await expect(tile(page, 'assets')).toBeVisible()
  })

  test('a breadcrumb step goes back up to that folder', async ({ page }) => {
    await chooseView(page, 'icons')
    await tile(page, 'assets').dblclick()
    await tile(page, 'assets/audio').dblclick()
    await expect(tile(page, 'assets/audio/sfx')).toBeVisible()

    await page.locator('[data-crumb-path="assets"]').click()

    await expect(tile(page, 'assets/textures')).toBeVisible()
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets'])
  })

  test('a file keeps its import settings badge on its tile', async ({ page }) => {
    await chooseView(page, 'icons')
    await tile(page, 'assets').dblclick()
    await tile(page, 'assets/textures').dblclick()
    await tile(page, 'assets/textures/characters').dblclick()

    const knight = tile(page, 'assets/textures/characters/knight-idle.png')
    await expect(knight).toBeVisible()
    await expect(knight).toHaveAttribute('data-has-settings', 'true')
    // The sidecar is folded into the file's tile, exactly as it is into its row.
    await expect(tile(page, 'assets/textures/characters/knight-idle.png.meta')).toBeHidden()
  })

  test('the split view shows both halves, and picking a folder on the left jumps the right', async ({
    page,
  }) => {
    await chooseView(page, 'split')

    await expect(page.getByTestId('assets-list')).toBeVisible()
    await expect(page.getByTestId('assets-icons')).toBeVisible()

    await row(page, 'assets').click()
    await expect(tile(page, 'assets/textures')).toBeVisible()
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets'])

    await row(page, 'assets/audio').click()
    await expect(tile(page, 'assets/audio/music')).toBeVisible()
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets', 'audio'])
  })

  test('walking into a folder on the right opens the way to it on the left', async ({ page }) => {
    await chooseView(page, 'split')

    await tile(page, 'assets').dblclick()
    await tile(page, 'assets/textures').dblclick()

    await expect(row(page, 'assets/textures/characters')).toBeVisible()
  })

  test('the view survives dragging the panel somewhere else', async ({ page }) => {
    await chooseView(page, 'icons')
    await tile(page, 'assets').dblclick()

    // Off-centre on purpose: the middle of a tab is the line between "before"
    // and "after" and a drop on it is discarded in silence (`editor-ui` UG11).
    await page
      .getByRole('tab', { name: 'Assets', exact: true })
      .dragTo(page.getByRole('tab', { name: 'Outliner', exact: true }), {
        targetPosition: { x: 20, y: 12 },
      })

    await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'icons')
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets'])
  })

  test('leaves a picture of each view behind', async ({ page }, testInfo) => {
    await chooseView(page, 'icons')
    await tile(page, 'assets').dblclick()
    await tile(page, 'assets/textures').dblclick()
    await page.screenshot({ path: testInfo.outputPath('assets-icon-view.png') })

    await chooseView(page, 'split')
    await page.screenshot({ path: testInfo.outputPath('assets-split-view.png') })
  })
})

async function chooseView(page: Page, view: AssetView): Promise<void> {
  await page.getByTestId('assets-settings').click()
  await page.getByTestId(`assets-view-${view}`).click()
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', view)
}

/** A tile in the icon half, addressed by the path it is about. */
function tile(page: Page, assetPath: string): Locator {
  return page.getByTestId('assets-icons').locator(`[data-asset-path="${assetPath}"]`)
}

/** A row in the tree half, addressed the same way. */
function row(page: Page, assetPath: string): Locator {
  return page.getByTestId('assets-list').locator(`[data-asset-path="${assetPath}"]`)
}

function crumbs(page: Page): Locator {
  return page.getByTestId('assets-breadcrumb').locator('.breadcrumb__crumb')
}
