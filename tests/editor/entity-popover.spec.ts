import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'

/**
 * The right-click window: a right-click on an entity in the picture opens a
 * small window next to it holding the entity's position, and the browser's own
 * context menu never appears over the picture.
 *
 * Position is asserted through the Inspector's fields, which read the same
 * document — the point of the window is that it is the same field in a second
 * place, not a second copy of the value.
 */

const LEVEL_ONE = 'scenes/level-01.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test('right-clicking an entity opens the window on it, selected', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')

  await page.mouse.click(spot.x, spot.y, { button: 'right' })

  const popover = page.getByTestId('entity-popover')
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('Knight')
  await expect(page.getByTestId('inspector-name')).toHaveText('Knight')

  // Next to the click rather than somewhere fixed: the window's box starts
  // near the spot that was pressed.
  const box = await popover.boundingBox()
  expect(box).not.toBeNull()
  expect(Math.abs((box?.x ?? 0) - spot.x)).toBeLessThan(80)
  expect(Math.abs((box?.y ?? 0) - spot.y)).toBeLessThan(80)
})

test('the window edits the position, and the Inspector agrees', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(page.getByTestId('entity-popover')).toBeVisible()

  await page.getByTestId('popover-x-control').fill('123')

  await expect(page.getByTestId('entity-x-control')).toHaveValue('123')
})

test('one edit is one press of Ctrl-Z', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')

  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  // The right-click selected it, so the Inspector is on it — read the value
  // there before the window changes it.
  const before = await page.getByTestId('entity-x-control').inputValue()
  await page.getByTestId('popover-x-control').fill('321')
  await expect(page.getByTestId('entity-x-control')).toHaveValue('321')

  await page.keyboard.press('ControlOrMeta+z')

  await expect(page.getByTestId('entity-x-control')).toHaveValue(before)
})

test('Esc closes it, and the picture has the keys again', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(page.getByTestId('entity-popover')).toBeVisible()

  // Esc lands in the window's own field first, because opening it put the
  // cursor there ready to type.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('entity-popover')).toBeHidden()

  // Focus went back to the picture: F frames the selection without a click.
  await page.keyboard.press('f')
  await expect(page.getByTestId('scene-selected-bounds')).toBeVisible()
})

test('a right-click on empty space closes it and opens nothing', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(page.getByTestId('entity-popover')).toBeVisible()

  const empty = await emptySpot(page)
  await page.mouse.click(empty.x, empty.y, { button: 'right' })

  await expect(page.getByTestId('entity-popover')).toBeHidden()
})

test('a press somewhere else in the picture closes it', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(page.getByTestId('entity-popover')).toBeVisible()

  const empty = await emptySpot(page)
  await page.mouse.click(empty.x, empty.y)

  await expect(page.getByTestId('entity-popover')).toBeHidden()
})

test('a press inside the window does not reach the picture', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(page.getByTestId('entity-popover')).toBeVisible()

  // Clicking the field is a press inside the stage's bounds. If it reached the
  // gesture layer it would be read as a pick — most likely of nothing, which
  // would deselect Knight and close the window under the cursor.
  await page.getByTestId('popover-y-control').click()

  await expect(page.getByTestId('entity-popover')).toBeVisible()
  await expect(page.getByTestId('inspector-name')).toHaveText('Knight')
})

test('the browser context menu never opens over the picture', async ({ page }) => {
  // Listening at the window, on the bubble, which runs after the stage's own
  // listener has decided: defaultPrevented is the browser being told no.
  await page.evaluate(() => {
    const flags = { seen: 0, prevented: 0 }
    ;(window as unknown as { __contextMenu: typeof flags }).__contextMenu = flags
    window.addEventListener('contextmenu', (event) => {
      flags.seen += 1
      if (event.defaultPrevented) flags.prevented += 1
    })
  })

  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  const empty = await emptySpot(page)
  await page.mouse.click(empty.x, empty.y, { button: 'right' })

  const flags = await page.evaluate(
    () => (window as unknown as { __contextMenu: { seen: number; prevented: number } }).__contextMenu,
  )
  expect(flags.seen).toBeGreaterThanOrEqual(2)
  expect(flags.prevented).toBe(flags.seen)
})

test('leaves a picture of the window over the picture', async ({ page }, testInfo) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(page.getByTestId('entity-popover')).toBeVisible()
  await page.getByTestId('viewport-panel').screenshot({ path: testInfo.outputPath('entity-popover.png') })
})

// --- driving ---------------------------------------------------------------

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')

const row = (page: Page, name: string): Locator =>
  page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: name }).first()

/** The camera, once it has stopped moving — opening a scene frames it a beat later. */
async function settled(page: Page): Promise<void> {
  let previous = Number.NaN
  await expect
    .poll(
      async () => {
        const now = Number(await viewport(page).getAttribute('data-scene-scale'))
        const same = now === previous
        previous = now
        return same && Number.isFinite(now)
      },
      { intervals: [120, 120, 120, 120, 120, 120, 120, 120] },
    )
    .toBe(true)
}

/**
 * The middle of the named entity's sprite on screen, found by selecting it in
 * the Outliner and reading the outline the renderer reported. The selection is
 * then cleared with a click on empty space, so the right-click being tested is
 * what selects it.
 */
async function entitySpot(page: Page, name: string): Promise<{ x: number; y: number }> {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await settled(page)

  await row(page, name).click()
  const box = await page.getByTestId('scene-selected-bounds').boundingBox()
  expect(box).not.toBeNull()
  const spot = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }

  const empty = await emptySpot(page)
  await page.mouse.click(empty.x, empty.y)
  await expect(page.getByTestId('scene-selected-bounds')).toBeHidden()

  return spot
}

/** A point in the picture that is not on any entity. */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('viewport-stage').boundingBox()
  expect(box).not.toBeNull()
  return { x: (box?.x ?? 0) + (box?.width ?? 0) - 12, y: (box?.y ?? 0) + 12 }
}
