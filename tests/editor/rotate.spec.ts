import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { openScene, outlinerRow, viewport } from './scene-view.js'

/**
 * Turning entities with `R`: the gizmo, the angle, and the two ways out.
 *
 * One test per acceptance, in the units they were asked for
 * (`editor-verification` V1), against the real editor and the real renderer.
 * Nothing here compares a pixel — how far something turned comes from the
 * Inspector and from the panel's own attributes.
 *
 * The arithmetic is not tested here. It is in `tests/shell/rotate.test.ts`,
 * where the sign, the orbit-and-spin and the measured-not-accumulated angle each
 * get an assertion that fails for them and nothing else — a browser test can
 * only ever sample a rotation, and all three of those failures look like a
 * correct implementation dragged somewhere slightly different.
 *
 * What this file is for is everything the arithmetic cannot answer: that the key
 * starts it, that the gizmo is on screen, that a click keeps it and `Esc` does
 * not, that the whole turn is one press of Ctrl-Z, and that it is refused where
 * it should be.
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
async function transform(page: Page): Promise<{ x: number; y: number; rotation: number }> {
  return {
    x: Number(await page.getByTestId('entity-x-control').inputValue()),
    y: Number(await page.getByTestId('entity-y-control').inputValue()),
    rotation: Number(await page.getByTestId('entity-rotation-control').inputValue()),
  }
}

/** The middle of the selected entity's outline, in window coordinates. */
async function outlineCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('scene-selected-bounds').first().boundingBox()
  expect(box).not.toBeNull()
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
}

/** How far round the turn in progress has come, as the panel reports it. */
async function turnedBy(page: Page): Promise<number> {
  return Number(await viewport(page).getAttribute('data-scene-turn-degrees'))
}

/**
 * Start a turn and take the pointer round to a bearing.
 *
 * **The pivot is read off the gizmo rather than guessed**, and that is the whole
 * reason this helper exists. A group turns about the mean of its entities, which
 * is not where any one outline is — a test that circled one sprite's middle
 * would sweep a different angle about the real pivot and report the feature as
 * off by thirty degrees. Asking the editor where it is turning about is also the
 * honest instrument: it is a number the feature published, not one re-derived.
 *
 * The first pointer sighting after `R` is what the bearing is measured from, so
 * the hand is taken to a known zero — due right of the pivot — before it goes
 * anywhere. Screen y counts down, so a positive scene angle is *up* the screen.
 *
 * `Ctrl` is left **held** when asked for, because releasing it re-places the
 * entity under the toggle — which is correct behaviour and would undo the very
 * thing a caller passing `ctrl` is about to assert.
 */
async function turnTo(
  page: Page,
  degrees: number,
  options: { reach?: number; ctrl?: boolean } = {},
): Promise<void> {
  const reach = options.reach ?? 90

  await page.keyboard.press('r')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-turning', '')

  const mark = await page.getByTestId('scene-turn-pivot').boundingBox()
  expect(mark).not.toBeNull()
  const pivot = {
    x: (mark?.x ?? 0) + (mark?.width ?? 0) / 2,
    y: (mark?.y ?? 0) + (mark?.height ?? 0) / 2,
  }

  await page.mouse.move(pivot.x + reach, pivot.y)
  if (options.ctrl === true) await page.keyboard.down('Control')

  const radians = (degrees * Math.PI) / 180
  await page.mouse.move(pivot.x + reach * Math.cos(radians), pivot.y - reach * Math.sin(radians), {
    steps: 10,
  })
}

// --- acceptance: the gesture ------------------------------------------------

test('R turns the selected entity, and a click keeps it', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await turnTo(page, 90)
  await page.mouse.down()
  await page.mouse.up()

  await expect(viewport(page)).toHaveAttribute('data-scene-turning', '')
  const after = await transform(page)
  expect(after.rotation).toBeCloseTo(before.rotation + 90, 0)
  // One entity is its own pivot, so it turned on the spot.
  expect(after.x).toBeCloseTo(before.x, 1)
  expect(after.y).toBeCloseTo(before.y, 1)
})

test('the gizmo and its line are on screen while it turns, and gone afterwards', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  await turnTo(page, 60)

  await expect(page.getByTestId('scene-turn')).toBeVisible()
  await expect(page.getByTestId('scene-turn-gizmo')).toBeVisible()
  await expect(page.getByTestId('scene-turn-sweep')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('scene-turn')).toHaveCount(0)
})

test('Enter puts it down as well as a click', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await turnTo(page, 90)
  await page.keyboard.press('Enter')

  await expect(viewport(page)).toHaveAttribute('data-scene-turning', '')
  expect((await transform(page)).rotation).toBeCloseTo(before.rotation + 90, 0)
})

/**
 * Cancelling has to put everything back **and leave the history exactly as it
 * was** — the second half is what an implementation that "undid" by writing the
 * old rotation back would fail, and it fails invisibly: the entity ends up in
 * the right place and the next Ctrl-Z spends itself on a step that changes
 * nothing (`editor-verification` V30).
 */
test('Esc puts it back and leaves no step behind', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  // A change to reverse *before* the cancelled turn, so the next Ctrl-Z has
  // something of its own to take back.
  await page.getByTestId('entity-x-control').fill('123')
  await expect.poll(async () => (await transform(page)).x).toBe(123)
  // Focus back out of the field, or `r` is typed into it rather than starting a
  // turn — which is the typing guard working, and would read here as `R` being
  // broken.
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  await turnTo(page, 90)
  await expect.poll(() => turnedBy(page)).not.toBe(0)
  await page.keyboard.press('Escape')

  expect(await transform(page)).toEqual(before)

  // The press lands on the *earlier* edit, which is the whole assertion.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await transform(page)).x).not.toBe(123)
})

test('the whole turn is one press of Ctrl-Z', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)

  // Taken round in stages, so the gesture writes many times over.
  const pivot = await outlineCentre(page)
  await page.mouse.move(pivot.x + 90, pivot.y)
  await page.keyboard.press('r')
  await page.mouse.move(pivot.x + 90, pivot.y)
  for (const degrees of [20, 40, 60, 80, 100]) {
    const radians = (degrees * Math.PI) / 180
    await page.mouse.move(pivot.x + 90 * Math.cos(radians), pivot.y - 90 * Math.sin(radians))
  }
  await page.mouse.down()
  await page.mouse.up()
  expect((await transform(page)).rotation).not.toBeCloseTo(before.rotation, 0)

  await page.keyboard.press('ControlOrMeta+z')

  await expect.poll(async () => (await transform(page)).rotation).toBeCloseTo(before.rotation, 1)
})

// --- acceptance: a group ----------------------------------------------------

/**
 * Several selected turn as one rigid group about the mean of their positions:
 * each one swings round the pivot *and* turns on its own axis. An implementation
 * that only spins them leaves the positions alone, so both are asserted.
 */
test('several selected swing round their middle and each one turns', async ({ page }) => {
  await openScene(page, LEVEL_ONE)

  await outlinerRow(page, 'Knight').click()
  const knightBefore = await transform(page)
  await outlinerRow(page, 'Slime').click()
  const slimeBefore = await transform(page)

  await outlinerRow(page, 'Knight').click()
  await outlinerRow(page, 'Slime').click({ modifiers: ['Shift'] })
  await expect(viewport(page)).toHaveAttribute('data-scene-selected-count', '2')

  await turnTo(page, 90)
  await page.mouse.down()
  await page.mouse.up()

  // The Inspector describes the last one clicked, which is the Slime.
  const slimeAfter = await transform(page)
  expect(slimeAfter.rotation).toBeCloseTo(slimeBefore.rotation + 90, 0)

  await outlinerRow(page, 'Knight').click()
  const knightAfter = await transform(page)
  expect(knightAfter.rotation).toBeCloseTo(knightBefore.rotation + 90, 0)

  // And they moved, which is the half a spin-in-place implementation skips.
  const moved =
    Math.abs(knightAfter.x - knightBefore.x) > 1 || Math.abs(knightAfter.y - knightBefore.y) > 1
  expect(moved).toBe(true)
})

test('turning several is still one press of Ctrl-Z', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Knight').click()
  const before = await transform(page)
  await outlinerRow(page, 'Slime').click({ modifiers: ['Shift'] })

  await turnTo(page, 90)
  await page.mouse.down()
  await page.mouse.up()

  await page.keyboard.press('ControlOrMeta+z')

  await outlinerRow(page, 'Knight').click()
  await expect.poll(async () => (await transform(page)).rotation).toBeCloseTo(before.rotation, 1)
  await expect.poll(async () => (await transform(page)).x).toBeCloseTo(before.x, 1)
})

// --- acceptance: the angle snap ---------------------------------------------

async function setSnapping(page: Page, on: boolean): Promise<void> {
  const showing = await page.getByTestId('scene-snap').getAttribute('data-snap-on')
  if (showing !== String(on)) await page.getByTestId('scene-snap-toggle').click()
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-on', String(on))
}

test('with snapping on the angle lands on a multiple of 15', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await setSnapping(page, true)
  await outlinerRow(page, 'Slime').click()

  await turnTo(page, 37)

  expect((await turnedBy(page)) % 15).toBe(0)
  await page.keyboard.press('Escape')
})

test('holding Ctrl turns freely while snapping is on', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await setSnapping(page, true)
  await outlinerRow(page, 'Slime').click()

  await turnTo(page, 37, { ctrl: true })

  expect((await turnedBy(page)) % 15).not.toBe(0)

  // Letting go re-places it under the toggle, on the spot — the other half of
  // the modifier, and worth asserting here since the key is already down.
  await page.keyboard.up('Control')
  await expect.poll(async () => (await turnedBy(page)) % 15).toBe(0)

  await page.keyboard.press('Escape')
})

/** The half that catches an inversion written backwards. */
test('holding Ctrl lands on 15° steps while snapping is off', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await setSnapping(page, false)
  await outlinerRow(page, 'Slime').click()

  await turnTo(page, 37)
  expect((await turnedBy(page)) % 15).not.toBe(0)

  // Pressed without moving the mouse: the angle has to change on the keypress,
  // which is the half of the modifier a wobble-driven implementation misses.
  await page.keyboard.down('Control')
  await expect.poll(async () => (await turnedBy(page)) % 15).toBe(0)
  await page.keyboard.up('Control')

  await page.keyboard.press('Escape')
})

// --- acceptance: where it is refused ----------------------------------------

test('does nothing with nothing selected', async ({ page }) => {
  await openScene(page, LEVEL_ONE)

  await page.getByTestId('viewport-stage').click({ position: { x: 6, y: 6 } })
  await expect(viewport(page)).toHaveAttribute('data-scene-selected-count', '0')
  await page.keyboard.press('r')

  await expect(viewport(page)).toHaveAttribute('data-scene-turning', '')
})

test('does nothing while a level is running', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()
  const before = await transform(page)
  await expect(page.getByTestId('play-start')).toBeEnabled()
  await page.getByTestId('play-start').click()
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'running')

  await page.keyboard.press('r')
  await expect(viewport(page)).toHaveAttribute('data-scene-turning', '')

  await page.getByTestId('play-stop').click()
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'stopped')
  expect(await transform(page)).toEqual(before)
})

/** One modal gesture at a time: a grab keeps the picture and `R` bounces off. */
test('does not start on top of a grab', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  await page.keyboard.press('g')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-grabbing', '')

  await page.keyboard.press('r')

  await expect(viewport(page)).toHaveAttribute('data-scene-turning', '')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-grabbing', '')
  await page.keyboard.press('Escape')
})

/**
 * Play is greyed for the whole turn, *including* while the pointer is still —
 * the wait is the assertion (`editor-ui` U43): the button is correctly greyed on
 * the frame the gesture starts, and it is the frame a second later that used to
 * go wrong.
 */
test('Play stays greyed for the whole turn', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Slime').click()

  await turnTo(page, 45)

  await expect(page.getByTestId('play-start')).toBeDisabled()
  await page.waitForTimeout(1_500)
  await expect(page.getByTestId('play-start')).toBeDisabled()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('play-start')).toBeEnabled()
})

test('leaves a picture of a turn in progress', async ({ page }, testInfo) => {
  await openScene(page, LEVEL_ONE)
  await outlinerRow(page, 'Knight').click()
  await outlinerRow(page, 'Slime').click({ modifiers: ['Shift'] })

  await turnTo(page, 50)
  await expect(page.getByTestId('scene-turn')).toBeVisible()

  await viewport(page).screenshot({ path: testInfo.outputPath('rotate.png') })
  await page.keyboard.press('Escape')
})
