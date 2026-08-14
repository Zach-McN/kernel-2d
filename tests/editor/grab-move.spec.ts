import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'

/**
 * Moving an entity with the keyboard: `G` to pick it up, `X` and `Y` to hold it
 * to an axis, `Esc` to put it back — and `Shift-D` for another one.
 *
 * One test per acceptance, in the units they were written in
 * (`editor-verification` V1), against the real editor, the real service and the
 * real renderer. Nothing here compares a pixel: where the entity *is* comes from
 * the Inspector, and what the gesture is doing comes from the panel's own
 * attributes.
 *
 * Two are load-bearing and would each pass a plausible wrong implementation:
 *
 *   - **the grab with the pointer nowhere near the sprite**, which is the whole
 *     reason the gesture exists and the one an implementation that quietly
 *     needed a press over the entity would fail;
 *   - **cancelling leaves the undo stack as it was**, which an implementation
 *     that put the entity back by writing the old position would fail — it ends
 *     at the right place, and eats the next press of Ctrl-Z.
 */

const LEVEL_ONE = 'scenes/level-01.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

// --- reading what happened -------------------------------------------------

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')

const row = (page: Page, name: string): Locator =>
  page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: name }).first()

async function cameraScale(page: Page): Promise<number> {
  return Number(await viewport(page).getAttribute('data-scene-scale'))
}

/** The camera, once it has stopped moving — opening a scene frames it a beat later. */
async function settled(page: Page): Promise<number> {
  let previous = Number.NaN
  await expect
    .poll(
      async () => {
        const now = await cameraScale(page)
        const same = now === previous
        previous = now
        return same && Number.isFinite(now)
      },
      { intervals: [120, 120, 120, 120, 120, 120, 120, 120] },
    )
    .toBe(true)
  return previous
}

async function openScene(page: Page): Promise<void> {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await settled(page)
}

/** Where the selected entity is, as the Inspector reads it — the level's own units. */
async function position(page: Page): Promise<{ x: number; y: number }> {
  return {
    x: Number(await page.getByTestId('entity-x-control').inputValue()),
    y: Number(await page.getByTestId('entity-y-control').inputValue()),
  }
}

/** The middle of the selected entity's outline, in window coordinates. */
async function outlineCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('scene-selected-bounds').boundingBox()
  expect(box).not.toBeNull()
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
}

async function stageBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('viewport-stage').boundingBox()
  expect(box).not.toBeNull()
  return box ?? { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * Start a grab with the pointer somewhere, and settle before returning.
 *
 * The pointer is moved *before* the key, because that is what the gesture
 * measures its travel from: the settle then makes the panel's own attribute the
 * signal that the grab has begun, rather than a guess about React's timing.
 */
async function grabFrom(page: Page, from: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.keyboard.press('g')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-grabbing', '')
}

/** How far the entity travels for a given screen distance at this zoom. */
async function moveTo(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
}

// --- acceptance: the grab ---------------------------------------------------

test('pressing G moves the selected entity with the pointer, and a click puts it down', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await grabFrom(page, at)
  await moveTo(page, at, 9 * scale, 0)
  await page.mouse.down()
  await page.mouse.up()

  await expect(viewport(page)).toHaveAttribute('data-scene-grabbing', '')
  expect(await position(page)).toEqual({ x: before.x + 9, y: before.y })
})

/**
 * The reason the gesture exists. An implementation that quietly required the
 * press to start on the sprite would pass every other test in this file.
 */
test('G grabs the selection with the pointer nowhere near it', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  // A corner of the panel with nothing in it, deliberately far from the sprite.
  const stage = await stageBox(page)
  const away = { x: stage.x + stage.width - 20, y: stage.y + 20 }

  const scale = await cameraScale(page)
  await grabFrom(page, away)
  await moveTo(page, away, 0, 6 * scale)
  await page.mouse.down()
  await page.mouse.up()

  // Screen y counts down and the level's counts up.
  expect(await position(page)).toEqual({ x: before.x, y: before.y - 6 })
})

test('pressing X holds it to the X axis, from where it started', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await grabFrom(page, at)
  await moveTo(page, at, 5 * scale, 7 * scale)
  await page.keyboard.press('x')
  await expect(viewport(page)).toHaveAttribute('data-scene-grab-axis', 'x')
  await page.mouse.down()
  await page.mouse.up()

  expect(await position(page)).toEqual({ x: before.x + 5, y: before.y })
})

test('pressing Y holds it to the Y axis, from where it started', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await grabFrom(page, at)
  await moveTo(page, at, 5 * scale, 7 * scale)
  await page.keyboard.press('y')
  await page.mouse.down()
  await page.mouse.up()

  expect(await position(page)).toEqual({ x: before.x, y: before.y - 7 })
})

test('pressing the same axis again frees it, without starting over', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await grabFrom(page, at)
  await moveTo(page, at, 5 * scale, 7 * scale)
  await page.keyboard.press('x')
  await page.keyboard.press('x')
  await expect(viewport(page)).toHaveAttribute('data-scene-grab-axis', '')
  await page.mouse.down()
  await page.mouse.up()

  expect(await position(page)).toEqual({ x: before.x + 5, y: before.y - 7 })
})

test('Esc puts it back exactly where it was', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await grabFrom(page, at)
  await moveTo(page, at, 11 * scale, 4 * scale)
  expect(await position(page)).not.toEqual(before)

  await page.keyboard.press('Escape')

  await expect(viewport(page)).toHaveAttribute('data-scene-grabbing', '')
  expect(await position(page)).toEqual(before)
})

/**
 * The one that catches "put it back by writing the old position": that ends at
 * the right place and leaves a step on the stack that reverses nothing, so this
 * press of Ctrl-Z would appear to do nothing at all.
 */
test('a cancelled grab leaves the undo history as it was', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  // A change to reverse, made before the grab and nothing to do with it.
  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 5 * scale, at.y, { steps: 8 })
  await page.mouse.up()
  await expect(viewport(page)).toHaveAttribute('data-scene-dragging', '')
  const dragged = await position(page)
  expect(dragged.x).toBe(before.x + 5)

  const from = await outlineCentre(page)
  await grabFrom(page, from)
  await moveTo(page, from, 11 * scale, 0)
  await page.keyboard.press('Escape')
  expect(await position(page)).toEqual(dragged)

  // If the cancel had put the entity back by writing the old position, this
  // press would spend itself on a step that changes nothing.
  await page.keyboard.press('ControlOrMeta+z')

  await expect(page.getByTestId('entity-x-control')).toHaveValue(String(before.x))
})

test('a whole grab is one press of Ctrl-Z', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await grabFrom(page, at)
  await moveTo(page, at, 6 * scale, 0)
  await moveTo(page, at, 14 * scale, 0)
  await page.mouse.down()
  await page.mouse.up()
  expect((await position(page)).x).toBe(before.x + 14)

  await page.keyboard.press('ControlOrMeta+z')

  await expect(page.getByTestId('entity-x-control')).toHaveValue(String(before.x))
})

test('the bar says what is being moved and how to get out of it', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()

  const at = await outlineCentre(page)
  await grabFrom(page, at)
  await moveTo(page, at, 30, -20)

  await expect(page.getByTestId('viewport-grabbing')).toContainText('Slime')
  await expect(page.getByTestId('viewport-grabbing')).toContainText('Esc')

  await page.keyboard.press('x')
  await expect(page.getByTestId('scene-axis')).toHaveCount(1)
  await expect(page.getByTestId('viewport-grabbing')).toContainText('Locked to X')
  await page.screenshot({ path: 'test-results/grab-move.png', fullPage: false })

  await page.keyboard.press('Escape')
})

test('G with nothing selected does nothing at all', async ({ page }) => {
  await openScene(page)
  await page.keyboard.press('g')

  await expect(viewport(page)).toHaveAttribute('data-scene-grabbing', '')
})

test('a grab takes the wheel and the framing keys with it', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()

  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await grabFrom(page, at)

  await page.mouse.wheel(0, -120)
  await page.keyboard.press('Home')

  expect(await cameraScale(page)).toBe(scale)
  await page.keyboard.press('Escape')
})

// --- acceptance: duplicating ------------------------------------------------

test('Shift-D copies the selected entity in place and selects the copy', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  // Focus in the picture, which is where a hand that has been dragging is.
  await page.mouse.click(...(Object.values(await outlineCentre(page)) as [number, number]))
  await page.keyboard.press('Shift+d')

  await expect(page.getByTestId('entity-name-control')).toHaveValue('Slime 2')
  await expect(row(page, 'Slime 2')).toHaveAttribute('data-selected', 'true')
  expect(await position(page)).toEqual(before)
})

test('the copy is the one that moves, and the original stays', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  const at = await outlineCentre(page)
  await page.mouse.click(at.x, at.y)
  await page.keyboard.press('Shift+d')

  await grabFrom(page, at)
  await moveTo(page, at, 20 * scale, 0)
  await page.mouse.down()
  await page.mouse.up()

  expect((await position(page)).x).toBe(before.x + 20)
  await row(page, 'Slime').first().click()
  expect(await position(page)).toEqual(before)
})

test('Shift-D typed into a name is a D', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()

  await page.getByTestId('entity-name-control').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+D')

  await expect(page.getByTestId('entity-name-control')).toHaveValue('SlimeD')
  await expect(row(page, 'Slime 2')).toHaveCount(0)
})
