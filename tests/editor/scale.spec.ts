import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { openScene, outlinerRow, viewport } from './scene-view.js'

/**
 * Scaling entities with `S`: the gizmo, the factor, the axis lock, and the two
 * ways out.
 *
 * `rotate.spec.ts`'s sibling, and split from the arithmetic for the same reason:
 * a browser test can only *sample* a scale, and the ways the maths can be wrong
 * — growing without spreading, accumulating instead of measuring, the lock on
 * the wrong component — all look like a correct implementation dragged somewhere
 * slightly different. Those are `tests/shell/scale.test.ts`.
 *
 * What this file is for is everything the arithmetic cannot answer: that the key
 * starts it, that the gizmo is on screen, that `X` holds it to the sprite's own
 * side, that a click keeps it and `Esc` does not, that the whole gesture is one
 * press of Ctrl-Z, and that it is refused where it should be.
 *
 * These tests change the shared sample project, so every file is snapshotted and
 * put back afterwards (V14).
 */

const LEVEL_ONE = 'scenes/level-01.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

// --- reading what happened -------------------------------------------------

/** What the Inspector says about the selected entity, in the level's own units. */
async function transform(
  page: Page,
): Promise<{ x: number; y: number; scaleX: number; scaleY: number }> {
  return {
    x: Number(await page.getByTestId('entity-x-control').inputValue()),
    y: Number(await page.getByTestId('entity-y-control').inputValue()),
    scaleX: Number(await page.getByTestId('entity-scale-x-control').inputValue()),
    scaleY: Number(await page.getByTestId('entity-scale-y-control').inputValue()),
  }
}

/** How much bigger the scale in progress has got, as the panel reports it. */
async function scaledBy(page: Page): Promise<{ x: number; y: number }> {
  return {
    x: Number(await viewport(page).getAttribute('data-scene-scale-x')),
    y: Number(await viewport(page).getAttribute('data-scene-scale-y')),
  }
}

/**
 * Start a scale and take the pointer to a multiple of the reach it began at.
 *
 * **The pivot is read off the gizmo rather than guessed**, for the reason the
 * turn's helper gives: a group scales away from the mean of its entities, which
 * is not where any one outline is. Asking the editor where it is scaling from is
 * also the honest instrument — a number the feature published, not one this test
 * re-derived.
 *
 * The first pointer sighting after `S` is the reach everything is measured
 * against, so the hand is taken to a known distance — due right of the pivot —
 * before it goes anywhere. `want` is then the factor asked for: the pointer ends
 * up that many times as far out.
 *
 * `Ctrl` is left **held** when asked for, because releasing it re-applies the
 * scale under the toggle — correct behaviour, and it would undo the very thing a
 * caller passing `ctrl` is about to assert.
 */
async function scaleTo(
  page: Page,
  want: number,
  options: { reach?: number; ctrl?: boolean } = {},
): Promise<void> {
  const reach = options.reach ?? 90

  await page.keyboard.press('s')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-scaling', '')

  const mark = await page.getByTestId('scene-scaling-pivot').boundingBox()
  expect(mark).not.toBeNull()
  const pivot = {
    x: (mark?.x ?? 0) + (mark?.width ?? 0) / 2,
    y: (mark?.y ?? 0) + (mark?.height ?? 0) / 2,
  }

  await page.mouse.move(pivot.x + reach, pivot.y)
  if (options.ctrl === true) await page.keyboard.down('Control')

  await page.mouse.move(pivot.x + reach * want, pivot.y, { steps: 10 })
}

// --- acceptance: the gesture ------------------------------------------------

test('S scales the selected entity, and a click keeps it', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await scaleTo(page, 2)
  await page.mouse.down()
  await page.mouse.up()

  await expect(viewport(page)).toHaveAttribute('data-scene-scaling', '')
  const after = await transform(page)
  expect(after.scaleX).toBeCloseTo(before.scaleX * 2, 1)
  expect(after.scaleY).toBeCloseTo(before.scaleY * 2, 1)
  // One entity is its own pivot, so it grew on the spot.
  expect(after.x).toBeCloseTo(before.x, 1)
  expect(after.y).toBeCloseTo(before.y, 1)
})

test('taking the pointer in makes it smaller', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await scaleTo(page, 0.5)
  await page.mouse.down()
  await page.mouse.up()

  expect((await transform(page)).scaleX).toBeCloseTo(before.scaleX * 0.5, 1)
})

test('the gizmo, its line and the mark it started from are on screen, and gone afterwards', async ({
  page,
}) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  await scaleTo(page, 1.6)

  await expect(page.getByTestId('scene-scaling')).toBeVisible()
  await expect(page.getByTestId('scene-scaling-gizmo')).toBeVisible()
  await expect(page.getByTestId('scene-scaling-from')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('scene-scaling')).toHaveCount(0)
})

test('Enter puts it down as well as a click', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await scaleTo(page, 2)
  await page.keyboard.press('Enter')

  await expect(viewport(page)).toHaveAttribute('data-scene-scaling', '')
  expect((await transform(page)).scaleX).toBeCloseTo(before.scaleX * 2, 1)
})

/**
 * Cancelling has to put everything back **and leave the history exactly as it
 * was** — the second half is what an implementation that "undid" by writing the
 * old size back would fail, and it fails invisibly (`editor-verification` V30).
 */
test('Esc puts it back and leaves no step behind', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  // A change to reverse *before* the cancelled scale, so the next Ctrl-Z has
  // something of its own to take back.
  await page.getByTestId('entity-x-control').fill('123')
  await expect.poll(async () => (await transform(page)).x).toBe(123)
  // Focus back out of the field, or `s` is typed into it rather than starting a
  // scale — the typing guard working, which would read here as `S` being broken.
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await scaleTo(page, 2)
  await expect.poll(async () => (await scaledBy(page)).x).not.toBe(1)
  await page.keyboard.press('Escape')

  expect(await transform(page)).toEqual(before)

  // The press lands on the *earlier* edit, which is the whole assertion.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await transform(page)).x).not.toBe(123)
})

test('the whole scale is one press of Ctrl-Z', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await page.keyboard.press('s')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-scaling', '')
  const mark = await page.getByTestId('scene-scaling-pivot').boundingBox()
  const pivot = {
    x: (mark?.x ?? 0) + (mark?.width ?? 0) / 2,
    y: (mark?.y ?? 0) + (mark?.height ?? 0) / 2,
  }
  // Taken out in stages, so the gesture writes many times over.
  await page.mouse.move(pivot.x + 60, pivot.y)
  for (const reach of [80, 100, 120, 140, 160]) {
    await page.mouse.move(pivot.x + reach, pivot.y)
  }
  await page.mouse.down()
  await page.mouse.up()
  expect((await transform(page)).scaleX).not.toBeCloseTo(before.scaleX, 1)

  await page.keyboard.press('ControlOrMeta+z')

  await expect.poll(async () => (await transform(page)).scaleX).toBeCloseTo(before.scaleX, 1)
})

// --- acceptance: the axis lock ----------------------------------------------

test('X stretches one side only, and pressing it again frees both', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await scaleTo(page, 2)
  await page.keyboard.press('x')

  await expect(viewport(page)).toHaveAttribute('data-scene-scale-axis', 'x')
  // Applied on the keypress rather than on the next wobble: the hand is still.
  await expect.poll(async () => (await scaledBy(page)).y).toBe(1)
  expect((await scaledBy(page)).x).toBeCloseTo(2, 1)

  await page.keyboard.press('x')
  await expect(viewport(page)).toHaveAttribute('data-scene-scale-axis', '')
  await expect.poll(async () => (await scaledBy(page)).y).toBeCloseTo(2, 1)

  await page.keyboard.press('Escape')
  expect(await transform(page)).toEqual(before)
})

test('a scale held to X leaves the height exactly as it was', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await scaleTo(page, 2)
  await page.keyboard.press('x')
  await page.mouse.down()
  await page.mouse.up()

  const after = await transform(page)
  expect(after.scaleX).toBeCloseTo(before.scaleX * 2, 1)
  expect(after.scaleY).toBeCloseTo(before.scaleY, 3)
})

test('Y is the other side', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await scaleTo(page, 2)
  await page.keyboard.press('y')
  await page.mouse.down()
  await page.mouse.up()

  const after = await transform(page)
  expect(after.scaleY).toBeCloseTo(before.scaleY * 2, 1)
  expect(after.scaleX).toBeCloseTo(before.scaleX, 3)
})

// --- acceptance: a group ----------------------------------------------------

/**
 * Several selected scale as one rigid group about the mean of their positions:
 * each one grows *and* moves away from the middle. An implementation that only
 * grows them leaves the positions alone, so both are asserted.
 */
test('several selected grow and spread apart from their middle', async ({ page }) => {
  await openScene(page, LEVEL_ONE)

  await outlinerRow(page, 'Knight').click()
  const knightBefore = await transform(page)
  await outlinerRow(page, 'Slime').click()
  const slimeBefore = await transform(page)

  await outlinerRow(page, 'Knight').click()
  await outlinerRow(page, 'Slime').click({ modifiers: ['Shift'] })
  await expect(viewport(page)).toHaveAttribute('data-scene-selected-count', '2')

  await scaleTo(page, 2)
  await page.mouse.down()
  await page.mouse.up()

  // The Inspector describes the last one clicked, which is the Slime.
  expect((await transform(page)).scaleX).toBeCloseTo(slimeBefore.scaleX * 2, 1)

  await outlinerRow(page, 'Knight').click()
  const knightAfter = await transform(page)
  expect(knightAfter.scaleX).toBeCloseTo(knightBefore.scaleX * 2, 1)

  // And they moved apart, which is the half a grow-in-place implementation skips.
  const moved =
    Math.abs(knightAfter.x - knightBefore.x) > 1 || Math.abs(knightAfter.y - knightBefore.y) > 1
  expect(moved).toBe(true)
})

test('scaling several is still one press of Ctrl-Z', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Knight').click()
  const before = await transform(page)
  await outlinerRow(page, 'Slime').click({ modifiers: ['Shift'] })

  await scaleTo(page, 2)
  await page.mouse.down()
  await page.mouse.up()

  await page.keyboard.press('ControlOrMeta+z')

  await outlinerRow(page, 'Knight').click()
  await expect.poll(async () => (await transform(page)).scaleX).toBeCloseTo(before.scaleX, 1)
  await expect.poll(async () => (await transform(page)).x).toBeCloseTo(before.x, 1)
})

// --- acceptance: the snap ---------------------------------------------------

async function setSnapping(page: Page, on: boolean): Promise<void> {
  const showing = await page.getByTestId('scene-snap').getAttribute('data-snap-on')
  if (showing !== String(on)) await page.getByTestId('scene-snap-toggle').click()
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-on', String(on))
}

/** A tenth, in whole tenths — the arithmetic of "is this on the step". */
function onStep(factor: number): boolean {
  return Math.abs(Math.round(factor * 10) - factor * 10) < 1e-6
}

test('with snapping on the factor lands on a tenth', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await setSnapping(page, true)
  await outlinerRow(page, 'Slime').click()

  await scaleTo(page, 1.37)

  expect(onStep((await scaledBy(page)).x)).toBe(true)
  await page.keyboard.press('Escape')
})

test('holding Ctrl scales freely while snapping is on', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await setSnapping(page, true)
  await outlinerRow(page, 'Slime').click()

  await scaleTo(page, 1.37, { ctrl: true })

  expect(onStep((await scaledBy(page)).x)).toBe(false)

  // Letting go re-applies it under the toggle, on the spot — the other half of
  // the modifier, and worth asserting here since the key is already down.
  await page.keyboard.up('Control')
  await expect.poll(async () => onStep((await scaledBy(page)).x)).toBe(true)

  await page.keyboard.press('Escape')
})

/** The half that catches an inversion written backwards. */
test('holding Ctrl lands on tenths while snapping is off', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await setSnapping(page, false)
  await outlinerRow(page, 'Slime').click()

  await scaleTo(page, 1.37)
  expect(onStep((await scaledBy(page)).x)).toBe(false)

  // Pressed without moving the mouse: the factor has to change on the keypress,
  // which is the half of the modifier a wobble-driven implementation misses.
  await page.keyboard.down('Control')
  await expect.poll(async () => onStep((await scaledBy(page)).x)).toBe(true)
  await page.keyboard.up('Control')

  await page.keyboard.press('Escape')
})

// --- acceptance: where it is refused ----------------------------------------

test('does nothing with nothing selected', async ({ page }) => {
  await openScene(page, LEVEL_ONE)

  await page.getByTestId('viewport-stage').click({ position: { x: 6, y: 6 } })
  await expect(viewport(page)).toHaveAttribute('data-scene-selected-count', '0')
  await page.keyboard.press('s')

  await expect(viewport(page)).toHaveAttribute('data-scene-scaling', '')
})

test('does nothing while a level is running', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)
  await expect(page.getByTestId('play-start')).toBeEnabled()
  await page.getByTestId('play-start').click()
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'running')

  await page.keyboard.press('s')
  await expect(viewport(page)).toHaveAttribute('data-scene-scaling', '')

  await page.getByTestId('play-stop').click()
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'stopped')
  expect(await transform(page)).toEqual(before)
})

/** One modal gesture at a time, in both directions. */
test('does not start on top of a grab, and a turn does not start on top of it', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  await page.keyboard.press('g')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-grabbing', '')
  await page.keyboard.press('s')
  await expect(viewport(page)).toHaveAttribute('data-scene-scaling', '')
  await page.keyboard.press('Escape')

  await page.keyboard.press('s')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-scaling', '')
  await page.keyboard.press('r')
  await expect(viewport(page)).toHaveAttribute('data-scene-turning', '')
  await page.keyboard.press('Escape')
})

/**
 * Play is greyed for the whole scale, *including* while the pointer is still —
 * the wait is the assertion (`editor-ui` U43).
 */
test('Play stays greyed for the whole scale', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  await scaleTo(page, 1.5)

  await expect(page.getByTestId('play-start')).toBeDisabled()
  await page.waitForTimeout(1_500)
  await expect(page.getByTestId('play-start')).toBeDisabled()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('play-start')).toBeEnabled()
})

test('leaves a picture of a scale in progress', async ({ page }, testInfo) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Knight').click()
  await outlinerRow(page, 'Slime').click({ modifiers: ['Shift'] })

  await scaleTo(page, 1.6)
  await expect(page.getByTestId('scene-scaling')).toBeVisible()

  await viewport(page).screenshot({ path: testInfo.outputPath('scale.png') })
  await page.keyboard.press('Escape')
})
