import { expect, test, type Locator } from '@playwright/test'

import { verticalDividerNear } from './dividers.js'
import { EDITOR_TEST_PROJECT_NAME, editorTestProjectDisplayPath } from './test-project.js'

const PANEL_TITLES = ['Viewport', 'Texture', 'Outliner', 'Inspector', 'Assets'] as const

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test.describe('the editor shell', () => {
  test('opens with every panel docked and named', async ({ page }) => {
    for (const title of PANEL_TITLES) {
      await expect(page.getByRole('tab', { name: title, exact: true })).toBeVisible()
    }

    // Every panel has a body now. The Texture tab shares the Viewport's group,
    // so it is behind it until a texture is selected — which is the one panel
    // that is not on screen at rest.
    await expect(page.getByTestId('assets-panel')).toBeVisible()
    await expect(page.getByTestId('inspector-panel')).toBeVisible()
    await expect(page.getByTestId('outliner-panel')).toBeVisible()
    await expect(page.getByTestId('viewport-panel')).toBeVisible()
  })

  test('says which project folder it is connected to', async ({ page }) => {
    await expect(page.getByTestId('status-strip')).toHaveAttribute('data-connection', 'connected')
    await expect(page.getByTestId('status-project')).toHaveText(EDITOR_TEST_PROJECT_NAME)
    await expect(page.getByTestId('status-path')).toHaveText(editorTestProjectDisplayPath())
    await expect(page.getByTestId('status-connection')).toHaveText('Connected')
  })

  test('names the project in the window title, so two open editors can be told apart', async ({ page }) => {
    await expect(page).toHaveTitle(`${EDITOR_TEST_PROJECT_NAME} — kernel-2d`)
  })

  test('says so plainly when the sidecar is not answering, rather than showing a stale name', async ({
    page,
  }) => {
    // Anchor on the working case first: the strip is only meaningful as a
    // warning if it is known to say "connected" when things are fine.
    await expect(page.getByTestId('status-strip')).toHaveAttribute('data-connection', 'connected')

    await page.route('**/api/', (route) => route.abort())
    await page.reload()

    await expect(page.getByTestId('status-strip')).toHaveAttribute('data-connection', 'unavailable')
    await expect(page.getByTestId('status-connection')).toContainText('No sidecar answering')
    await expect(page.getByTestId('status-project')).toHaveText('no project')
  })

  test('fills the window rather than sitting in a corner of it', async ({ page }) => {
    const layout = await page.locator('.dv-dockview').first().boundingBox()
    const viewport = page.viewportSize()

    expect(layout).not.toBeNull()
    expect(viewport).not.toBeNull()
    if (layout === null || viewport === null) return

    expect(layout.width).toBeGreaterThan(viewport.width * 0.9)
  })

  test('panels resize by dragging the divider between them', async ({ page }) => {
    const outliner = page.getByTestId('outliner-panel')
    const before = await boxOf(outliner)

    const divider = await verticalDividerNear(page, before.x + before.width)
    expect(divider, 'a draggable divider on the right edge of the Outliner panel').not.toBeNull()
    if (divider === null) return

    await page.mouse.move(divider.x, divider.y)
    await page.mouse.down()
    await page.mouse.move(divider.x + 120, divider.y, { steps: 12 })
    await page.mouse.up()

    const after = await boxOf(outliner)
    expect(after.width).toBeGreaterThan(before.width + 80)
  })

  test('panels re-dock by dragging their tab onto another panel', async ({ page }) => {
    const inspectorTab = page.getByRole('tab', { name: 'Inspector', exact: true })
    const outlinerTab = page.getByRole('tab', { name: 'Outliner', exact: true })
    const groupHoldingBoth = page
      .locator('.dv-groupview')
      .filter({ has: page.getByRole('tab', { name: 'Outliner', exact: true }) })
      .filter({ has: page.getByRole('tab', { name: 'Inspector', exact: true }) })

    await expect(groupHoldingBoth).toHaveCount(0)

    /*
     * Dropped a quarter of the way across the tab rather than on its middle,
     * which is where `dragTo` aims by default.
     *
     * Dockview splits a tab 50/50 into "insert before this one" and "insert
     * after it", and the comparisons either side are strict — so a drop on the
     * dividing line itself resolves to neither, no overlay appears, and the
     * drop is discarded. The middle of an element is exactly that line, and
     * whether it rounds to one side depends on the tab's sub-pixel width, which
     * is to say on the font. A test aimed there passes or fails on typography.
     */
    await inspectorTab.dragTo(outlinerTab, { targetPosition: { x: 20, y: 12 } })

    await expect(groupHoldingBoth).toHaveCount(1)
    await expect(page.getByTestId('inspector-panel')).toBeVisible()
  })

  // Not an assertion — a picture of the shell as it actually rendered, kept so
  // a visual change can be looked at rather than guessed at.
  test('leaves a picture of itself behind', async ({ page }, testInfo) => {
    await page.screenshot({ path: testInfo.outputPath('editor-shell.png') })
  })
})

/**
 * The way back for a closed panel. Every tab has a close button and the layout
 * is not saved, so before this menu existed a closed panel was gone until the
 * page was reloaded — a dead end with nothing on screen explaining it.
 */
test.describe('the Windows menu', () => {
  test('lists every panel and marks the ones already open', async ({ page }, testInfo) => {
    await page.getByTestId('windows-menu-button').click()

    const menu = page.getByTestId('windows-menu')
    await expect(menu).toBeVisible()
    for (const title of PANEL_TITLES) {
      await expect(menu.getByText(title, { exact: true })).toBeVisible()
    }
    // Nothing has been closed, so every mark says open.
    await expect(menu.locator('[data-panel-open="true"]')).toHaveCount(PANEL_TITLES.length)

    await page.screenshot({ path: testInfo.outputPath('windows-menu.png') })
  })

  test('brings a closed panel back', async ({ page }) => {
    await expect(page.getByTestId('outliner-panel')).toBeVisible()
    await page
      .getByRole('tab', { name: 'Outliner', exact: true })
      .locator('.dv-default-tab-action')
      .click()
    await expect(page.getByTestId('outliner-panel')).toBeHidden()

    await page.getByTestId('windows-menu-button').click()
    await expect(page.getByTestId('windows-open-outliner')).toHaveAttribute('data-panel-open', 'false')
    await page.getByTestId('windows-open-outliner').click()

    await expect(page.getByTestId('windows-menu')).toBeHidden()
    await expect(page.getByTestId('outliner-panel')).toBeVisible()
  })

  test('picking an open panel brings its tab forward rather than making a second one', async ({ page }) => {
    // The Texture tab shares the Viewport's group and starts behind it.
    await expect(page.getByTestId('viewport-panel')).toBeVisible()

    await page.getByTestId('windows-menu-button').click()
    await page.getByTestId('windows-open-texture').click()

    await expect(page.getByTestId('texture-panel')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Texture', exact: true })).toHaveCount(1)
  })

  test('the menu closes on Escape and on a press elsewhere', async ({ page }) => {
    await page.getByTestId('windows-menu-button').click()
    await expect(page.getByTestId('windows-menu')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('windows-menu')).toBeHidden()

    await page.getByTestId('windows-menu-button').click()
    await expect(page.getByTestId('windows-menu')).toBeVisible()
    await page.getByTestId('status-strip').click({ position: { x: 4, y: 4 } })
    await expect(page.getByTestId('windows-menu')).toBeHidden()
  })
})

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('Expected the element to be on screen and measurable.')
  return box
}


