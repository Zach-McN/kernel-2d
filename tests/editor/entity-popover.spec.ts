import { expect, test, type Locator, type Page } from '@playwright/test'

import { gapFrom } from './floating.js'
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
 *
 * **It has two doors**: a right-click on the sprite, and a right-click on the
 * entity's row in the Outliner. The second half of this file is about the list,
 * and about the one thing two doors into one window has to guarantee — that
 * only one of them is ever open.
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

  // Next to the click rather than somewhere fixed. Measured as "how far is the
  // press from the window", not "how far is the press from its top-left corner"
  // — near an edge the window flips to the other side of the press, which is
  // adjacent and would read as 130 pixels away to a corner-based assertion.
  expect(await gapFrom(popover, spot)).toBeLessThan(40)
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
  // `globalThis` rather than `window`, because this spec is compiled by the
  // Node half of the repo, which has no DOM globals (`editor-ui` U4).
  await page.evaluate(() => {
    const flags = { seen: 0, prevented: 0 }
    const host = globalThis as unknown as {
      __contextMenu?: typeof flags
      addEventListener: (type: string, listener: (event: { defaultPrevented: boolean }) => void) => void
    }
    host.__contextMenu = flags
    host.addEventListener('contextmenu', (event) => {
      flags.seen += 1
      if (event.defaultPrevented) flags.prevented += 1
    })
  })

  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  const empty = await emptySpot(page)
  await page.mouse.click(empty.x, empty.y, { button: 'right' })

  const flags = await page.evaluate(
    () =>
      (globalThis as unknown as { __contextMenu: { seen: number; prevented: number } }).__contextMenu,
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

// --- the four verbs --------------------------------------------------------

test('renaming in it renames everywhere, and one rename is one press of Ctrl-Z', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })

  await page.getByTestId('popover-name-control').fill('Paladin')

  // The Inspector, the Outliner's row and the window's own title all follow.
  await expect(page.getByTestId('inspector-name')).toHaveText('Paladin')
  await expect(row(page, 'Paladin')).toBeVisible()
  await expect(page.getByTestId('entity-popover')).toContainText('Paladin')

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByTestId('inspector-name')).toHaveText('Knight')
})

test('Frame puts the camera on it', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  const before = await page.getByTestId('viewport-panel').getAttribute('data-scene-focus-x')

  await page.getByTestId('popover-frame').click()

  await expect
    .poll(() => page.getByTestId('viewport-panel').getAttribute('data-scene-focus-x'))
    .not.toBe(before)
})

/**
 * Framing moves the camera, and the window is anchored to a spot on the screen
 * — so over the picture it closes itself, which is the ways-out rule it has
 * always had rather than anything this button does.
 */
test('Frame closes the window it was pressed in, because the picture moved', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })

  await page.getByTestId('popover-frame').click()

  await expect(page.getByTestId('entity-popover')).toBeHidden()
})

test('Duplicate makes the same copy Shift-D does, and moves on to it', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  const before = await rows(page).count()

  await page.getByTestId('popover-duplicate').click()

  await expect(rows(page)).toHaveCount(before + 1)
  // The copy is what is selected now, so the window has moved off its entity
  // and put itself away.
  await expect(page.getByTestId('entity-popover')).toBeHidden()
  await expect(page.getByTestId('inspector-name')).toHaveText('Knight 2')

  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows(page)).toHaveCount(before)
})

test('Delete removes that one entity and Ctrl-Z brings it back', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  const before = await rows(page).count()

  await page.getByTestId('popover-delete').click()

  await expect(rows(page)).toHaveCount(before - 1)
  await expect(exactRow(page, 'Knight')).toHaveCount(0)
  await expect(page.getByTestId('entity-popover')).toBeHidden()

  await page.keyboard.press('ControlOrMeta+z')
  await expect(exactRow(page, 'Knight')).toHaveCount(1)
})

/**
 * Delete acts on the selection, and opening the window is what makes the
 * selection this one entity — so a window opened on a sprite that was *not* in a
 * multi-selection must not take the rest of that selection with it. This is the
 * assertion standing between the button and somebody losing five entities.
 */
test('Delete takes only the entity the window is about', async ({ page }) => {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await settled(page)

  await row(page, 'Knight').click()
  await row(page, 'Slime').click({ modifiers: ['Shift'] })
  await expect(viewport(page)).toHaveAttribute('data-scene-selected-count', '2')
  const before = await rows(page).count()

  await row(page, 'Knight').click({ button: 'right' })
  await page.getByTestId('popover-delete').click()

  await expect(rows(page)).toHaveCount(before - 1)
  await expect(row(page, 'Slime')).toBeVisible()
})

// --- the Outliner's door ---------------------------------------------------

test('right-clicking a row opens the same window, on that entity', async ({ page }) => {
  await openLevel(page)

  await row(page, 'Knight').click({ button: 'right' })

  const popover = inOutliner(page)
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('Knight')
  // Selected as well as asked about, exactly as the picture's right-click does.
  await expect(page.getByTestId('inspector-name')).toHaveText('Knight')
})

test('the row window edits the position, and the Inspector agrees', async ({ page }) => {
  await openLevel(page)
  await row(page, 'Knight').click({ button: 'right' })
  await expect(inOutliner(page)).toBeVisible()

  await inOutliner(page).getByTestId('popover-x-control').fill('456')

  await expect(page.getByTestId('entity-x-control')).toHaveValue('456')
})

test('Esc closes the row window and the row has the keys again', async ({ page }) => {
  await openLevel(page)
  await row(page, 'Knight').click({ button: 'right' })
  await expect(inOutliner(page)).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(inOutliner(page)).toBeHidden()
  await expect(row(page, 'Knight')).toBeFocused()
})

test('selecting another row closes it', async ({ page }) => {
  await openLevel(page)
  await row(page, 'Knight').click({ button: 'right' })
  await expect(inOutliner(page)).toBeVisible()

  await row(page, 'Ground').click()

  await expect(inOutliner(page)).toBeHidden()
})

test('the browser context menu never opens over a row', async ({ page }) => {
  await openLevel(page)
  await page.evaluate(() => {
    const flags = { seen: 0, prevented: 0 }
    const host = globalThis as unknown as {
      __rowMenu?: typeof flags
      addEventListener: (type: string, listener: (event: { defaultPrevented: boolean }) => void) => void
    }
    host.__rowMenu = flags
    host.addEventListener('contextmenu', (event) => {
      flags.seen += 1
      if (event.defaultPrevented) flags.prevented += 1
    })
  })

  await row(page, 'Knight').click({ button: 'right' })

  const flags = await page.evaluate(
    () => (globalThis as unknown as { __rowMenu: { seen: number; prevented: number } }).__rowMenu,
  )
  expect(flags.seen).toBeGreaterThanOrEqual(1)
  expect(flags.prevented).toBe(flags.seen)
})

test('only one window is ever open, whichever door was used last', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await page.mouse.click(spot.x, spot.y, { button: 'right' })
  await expect(inViewport(page)).toBeVisible()

  // The same entity, from the other door: the picture's window is not left
  // standing beside the list's — it is one window that moved.
  await row(page, 'Knight').click({ button: 'right' })

  await expect(inOutliner(page)).toBeVisible()
  await expect(inViewport(page)).toBeHidden()
  await expect(page.getByTestId('entity-popover')).toHaveCount(1)
})

test('the picture takes it back again', async ({ page }) => {
  const spot = await entitySpot(page, 'Knight')
  await row(page, 'Knight').click({ button: 'right' })
  await expect(inOutliner(page)).toBeVisible()

  await page.mouse.click(spot.x, spot.y, { button: 'right' })

  await expect(inViewport(page)).toBeVisible()
  await expect(inOutliner(page)).toBeHidden()
})

test('leaves a picture of the window over the list', async ({ page }, testInfo) => {
  await openLevel(page)
  await row(page, 'Knight').click({ button: 'right' })
  await expect(inOutliner(page)).toBeVisible()
  await page
    .getByTestId('outliner-panel')
    .screenshot({ path: testInfo.outputPath('outliner-popover.png') })
})

// --- driving ---------------------------------------------------------------

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')

const inViewport = (page: Page): Locator => viewport(page).getByTestId('entity-popover')

const inOutliner = (page: Page): Locator =>
  page.getByTestId('outliner-panel').getByTestId('entity-popover')

/** The level open and drawn, which is all the list's own tests need. */
async function openLevel(page: Page): Promise<void> {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await settled(page)
}

const rows = (page: Page): Locator =>
  page.getByTestId('outliner-panel').locator('[data-entity-id]')

const row = (page: Page, name: string): Locator =>
  rows(page).filter({ hasText: name }).first()

/**
 * The row of the entity called *exactly* this.
 *
 * `row` matches on substring and takes the first, which is right for reaching a
 * row and wrong for counting them: the sample level holds both `Knight` and
 * `Knight running`, so "the Knight row is gone" is a question only an exact
 * match can answer.
 */
const exactRow = (page: Page, name: string): Locator =>
  rows(page).filter({ has: page.locator('.entity-row__name', { hasText: new RegExp(`^${name}$`) }) })

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
