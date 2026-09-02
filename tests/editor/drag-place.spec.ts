import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { parsedWhenWhole } from './parse-when-whole.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { cameraScale, openScene, outlineCentre, outlinerRow, settled, viewport } from './scene-view.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Placing an entity by dragging it in the picture, against the real editor, the
 * real service, the real project folder and the real renderer.
 *
 * One test per acceptance, in the units they were written in
 * (`editor-verification` V1), and not one of them compares a pixel: where a
 * sprite was drawn comes from the renderer's report, and where it *is* comes
 * from the Inspector and from the file on disk.
 *
 * The load-bearing one is the zoom-invariance test. An implementation that
 * forgets the camera and treats one screen pixel as one level unit passes every
 * other test in this file, because everything else happens at the zoom a scene
 * opens at.
 */

const LEVEL_ONE = 'scenes/level-01.json'

/** The human's budget, from "within a second". */
const WITHIN_A_SECOND = 1_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

// --- reading what happened -------------------------------------------------

/** Where the entity is, as the Inspector reads it — the level's own units. */
async function position(page: Page): Promise<{ x: number; y: number }> {
  return {
    x: Number(await page.getByTestId('entity-x-control').inputValue()),
    y: Number(await page.getByTestId('entity-y-control').inputValue()),
  }
}

async function stageBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('viewport-stage').boundingBox()
  expect(box).not.toBeNull()
  return box ?? { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * A left-drag from a point, settled before it returns.
 *
 * The settle is load-bearing: a drag is dispatched as a series of moves, and
 * reading as soon as anything has changed catches the gesture partway through,
 * which reads exactly like the placement arithmetic being wrong (W13).
 */
async function dragFrom(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  options: { ctrl?: boolean } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // After the button, never before it: a press with Ctrl already held means
  // "take this out of the selection" and starts no drag at all.
  if (options.ctrl === true) await page.keyboard.down('Control')
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
  await page.mouse.up()
  if (options.ctrl === true) await page.keyboard.up('Control')

  await expect(viewport(page)).toHaveAttribute('data-scene-dragging', '')
}

/** A point in the picture that is not on any entity. */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const stage = await stageBox(page)
  return { x: stage.x + stage.width - 12, y: stage.y + 12 }
}

// --- acceptance: clicking in the picture ------------------------------------

test('clicking a sprite selects it, in the picture and in the Outliner', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await expect(page.getByTestId('scene-selected-bounds')).toHaveCount(0)

  // Pick the Slime out of the list first only to find out where it is on
  // screen; the click under test is the one in the picture.
  await outlinerRow(page, 'Slime').click()
  const at = await outlineCentre(page)
  await outlinerRow(page, 'Knight').click()

  await page.mouse.click(at.x, at.y)

  await expect(page.getByTestId('entity-name-control')).toHaveValue('Slime')
  await expect(outlinerRow(page, 'Slime')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('scene-selected-bounds')).toHaveCount(1)
})

test('clicking empty space selects nothing', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Knight').click()
  await expect(page.getByTestId('scene-selected-bounds')).toHaveCount(1)

  await page.mouse.click(...(Object.values(await emptySpot(page)) as [number, number]))

  await expect(page.getByTestId('scene-selected-bounds')).toHaveCount(0)
  await expect(page.getByTestId('inspector-panel')).toContainText('Select')
})

test('where two sprites overlap, the one in front is picked', async ({ page }) => {
  await openScene(page, LEVEL_ONE)

  // The Knight stands on the Ground, and the Ground is drawn first — so where
  // they overlap, the Knight is the one being pointed at.
  await outlinerRow(page, 'Knight').click()
  const knight = await page.getByTestId('scene-selected-bounds').boundingBox()
  expect(knight).not.toBeNull()

  const onBoth = { x: (knight?.x ?? 0) + (knight?.width ?? 0) / 2, y: (knight?.y ?? 0) + (knight?.height ?? 0) - 2 }
  await page.mouse.click(...(Object.values(await emptySpot(page)) as [number, number]))
  await page.mouse.click(onBoth.x, onBoth.y)

  await expect(page.getByTestId('entity-name-control')).toHaveValue('Knight')
})

// --- acceptance: dragging ---------------------------------------------------

test('dragging a sprite moves it, and it lands on whole level units', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  await dragFrom(page, await outlineCentre(page), 7 * scale, 0)

  const after = await position(page)
  expect(after.x).toBe(before.x + 7)
  expect(after.y).toBe(before.y)
  expect(Number.isInteger(after.x)).toBe(true)
})

test('a drag that would land between units is snapped to one', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await position(page)

  // Deliberately not a whole number of level units at this zoom.
  const scale = await cameraScale(page)
  await dragFrom(page, await outlineCentre(page), 5 * scale + Math.floor(scale / 2), 0)

  const after = await position(page)
  expect(Number.isInteger(after.x)).toBe(true)
  expect(after.x).not.toBe(before.x)
})

test('holding Ctrl places it between whole units', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  // Zoomed in far enough that one screen pixel is a fraction of a level unit,
  // which is the only zoom at which a free position is even expressible.
  await page.mouse.move(...(Object.values(await outlineCentre(page)) as [number, number]))
  for (let step = 0; step < 3; step += 1) await page.mouse.wheel(0, -120)
  await settled(page)

  await dragFrom(page, await outlineCentre(page), 13, 0, { ctrl: true })

  const after = await position(page)
  expect(Number.isInteger(after.x)).toBe(false)
})

test('a drag is one press of Ctrl-Z, not one per wobble', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  await dragFrom(page, await outlineCentre(page), 20 * scale, 0)
  expect((await position(page)).x).not.toBe(before.x)

  await page.keyboard.press('ControlOrMeta+z')

  await expect(page.getByTestId('entity-x-control')).toHaveValue(String(before.x))
})

test('the dropped position is in the scene file within a second', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await position(page)

  const scale = await cameraScale(page)
  await dragFrom(page, await outlineCentre(page), 12 * scale, 0)
  const after = await position(page)

  const file = path.join(editorTestProjectPath(), LEVEL_ONE.replaceAll('/', path.sep))
  await expect
    .poll(
      () =>
        parsedWhenWhole<{ entities: { name: string; transform: { x: number } }[] }>(
          file,
        )?.entities.find((one) => one.name === 'Slime')?.transform.x,
      { timeout: WITHIN_A_SECOND + 1_000 },
    )
    .toBe(after.x)
  expect(after.x).toBe(before.x + 12)
})

/**
 * The one that catches an implementation that never learned about the camera.
 *
 * Treating one screen pixel as one level unit is right at 1× and wrong
 * everywhere else, and every other test in this file happens at whatever zoom
 * the scene opened at.
 */
test('the same drag moves the same number of level units at any zoom', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  const scale = await cameraScale(page)
  const start = await position(page)
  await dragFrom(page, await outlineCentre(page), 10 * scale, 0)
  expect((await position(page)).x).toBe(start.x + 10)

  // Much closer, using the framing key rather than the zoom button, because it
  // also puts the slime in the middle of the panel — zooming about the centre
  // of a level pushes an entity near its edge off the panel entirely, and then
  // the second press of this test would land on nothing.
  await page.keyboard.press('f')
  await expect.poll(() => cameraScale(page)).toBeGreaterThan(scale)
  const closer = await settled(page)

  const middle = await position(page)
  await dragFrom(page, await outlineCentre(page), 10 * closer, 0)
  expect((await position(page)).x).toBe(middle.x + 10)
})

// --- acceptance: the camera still has its gestures --------------------------

test('space-drag over a sprite pans the level and moves nothing', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await position(page)
  const originBefore = Number(await page.getByTestId('scene-origin').getAttribute('data-origin-x'))

  const at = await outlineCentre(page)
  await page.keyboard.down('Space')
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x - 60, at.y, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await settled(page)

  // The level moved under the pointer; the entity did not move in the level.
  await expect
    .poll(async () => Number(await page.getByTestId('scene-origin').getAttribute('data-origin-x')))
    .toBeLessThan(originBefore)
  expect(await position(page)).toEqual(before)
})

test('a click does not nudge what it selects', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await position(page)

  await page.mouse.click(...(Object.values(await outlineCentre(page)) as [number, number]))

  expect(await position(page)).toEqual(before)
})

test('pressing F after clicking in the picture frames, rather than typing an f', async ({ page }) => {
  await openScene(page, LEVEL_ONE)

  // Focus starts in a text field, which is the situation that makes this real:
  // without the press moving focus out, F would land in the name.
  await outlinerRow(page, 'Slime').click()
  await page.getByTestId('entity-name-control').click()

  await page.mouse.click(...(Object.values(await outlineCentre(page)) as [number, number]))
  const before = await cameraScale(page)
  await page.keyboard.press('f')

  await expect.poll(() => cameraScale(page)).toBeGreaterThan(before)
  await expect(page.getByTestId('entity-name-control')).toHaveValue('Slime')
})

test('a picture of a drag in progress', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  const at = await outlineCentre(page)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 40, at.y - 20, { steps: 8 })

  await expect(page.getByTestId('viewport-dragging')).toContainText('Slime')
  await page.screenshot({ path: 'test-results/drag-place.png', fullPage: false })

  await page.mouse.up()
})
