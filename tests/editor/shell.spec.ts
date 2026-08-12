import { expect, test, type Locator, type Page } from '@playwright/test'

import { EDITOR_TEST_PROJECT_NAME, editorTestProjectDisplayPath } from './test-project.js'

const PANEL_TITLES = ['Viewport', 'Texture', 'Hierarchy', 'Inspector', 'Assets'] as const

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
    await expect(page.getByTestId('hierarchy-panel')).toBeVisible()
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
    const hierarchy = page.getByTestId('hierarchy-panel')
    const before = await boxOf(hierarchy)

    const divider = await dividerRightOf(page, before.x + before.width)
    expect(divider, 'a draggable divider on the right edge of the Hierarchy panel').not.toBeNull()
    if (divider === null) return

    await page.mouse.move(divider.x, divider.y)
    await page.mouse.down()
    await page.mouse.move(divider.x + 120, divider.y, { steps: 12 })
    await page.mouse.up()

    const after = await boxOf(hierarchy)
    expect(after.width).toBeGreaterThan(before.width + 80)
  })

  test('panels re-dock by dragging their tab onto another panel', async ({ page }) => {
    const inspectorTab = page.getByRole('tab', { name: 'Inspector', exact: true })
    const hierarchyTab = page.getByRole('tab', { name: 'Hierarchy', exact: true })
    const groupHoldingBoth = page
      .locator('.dv-groupview')
      .filter({ has: page.getByRole('tab', { name: 'Hierarchy', exact: true }) })
      .filter({ has: page.getByRole('tab', { name: 'Inspector', exact: true }) })

    await expect(groupHoldingBoth).toHaveCount(0)

    await inspectorTab.dragTo(hierarchyTab)

    await expect(groupHoldingBoth).toHaveCount(1)
    await expect(page.getByTestId('inspector-panel')).toBeVisible()
  })

  // Not an assertion — a picture of the shell as it actually rendered, kept so
  // a visual change can be looked at rather than guessed at.
  test('leaves a picture of itself behind', async ({ page }, testInfo) => {
    await page.screenshot({ path: testInfo.outputPath('editor-shell.png') })
  })
})

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('Expected the element to be on screen and measurable.')
  return box
}

/**
 * The vertical divider sitting on a given x, if it is draggable. Dockview marks
 * a divider disabled when the panels either side are already at their limits,
 * and a disabled one would fail the drag for an uninteresting reason.
 */
async function dividerRightOf(page: Page, x: number): Promise<{ x: number; y: number } | null> {
  const sashes = page.locator('.dv-sash:not(.dv-disabled)')

  for (let index = 0; index < (await sashes.count()); index += 1) {
    const box = await sashes.nth(index).boundingBox()
    if (box === null) continue
    const isVertical = box.height > box.width
    if (isVertical && Math.abs(box.x + box.width / 2 - x) < 12) {
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
  }

  return null
}

