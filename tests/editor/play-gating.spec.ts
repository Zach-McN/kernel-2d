import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'

/**
 * When Play can be pressed, and — the point of this file — when it stays
 * unpressable.
 *
 * A level runs *from the file*, so it must not be startable in the middle of a
 * move: the entity being carried has a position that is still being decided, and
 * half of the gesture would be in the file the runtime opened. The button was
 * already greyed during a drag, but only as a side effect of the picture on
 * screen not yet being a picture of the level as it is — a signal that is *true
 * again* in every pause between mouse movements. So the button flickered, worst
 * of all during a `G` grab, where the hand is routinely still for seconds at a
 * time while the eye decides.
 *
 * **Every test here waits.** The bug is invisible to any assertion made straight
 * after starting a gesture, because the button is correctly greyed on that
 * frame; it is the frame a second later that used to go wrong. A version of this
 * file without the waits passes against the bug it was written for.
 *
 * These tests change the shared sample project, so every file is snapshotted and
 * put back afterwards (`editor-verification` V14).
 */

const LEVEL_ONE = 'scenes/level-01.json'

/**
 * Long enough for the renderer to have drawn the level and reported it several
 * times over — the state the flicker needed in order to appear. A fixed wait
 * rather than a poll, deliberately: there is nothing to wait *for*, and the
 * assertion is that a certain amount of time passing changes nothing (W23's
 * counterpart — usually a timer is the wrong instrument, and here the absence of
 * an event is the whole claim).
 */
const LONG_ENOUGH_TO_SETTLE = 1_500

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')
const play = (page: Page): Locator => page.getByTestId('play-start')
const row = (page: Page, name: string): Locator =>
  page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: name }).first()

/** The camera, once it has stopped moving — opening a scene frames it a beat later. */
async function settled(page: Page): Promise<number> {
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
  return previous
}

async function openScene(page: Page): Promise<void> {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await settled(page)
  await expect(play(page)).toBeEnabled()
}

/** The middle of the selected entity's outline, in window coordinates. */
async function outlineCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('scene-selected-bounds').boundingBox()
  expect(box).not.toBeNull()
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
}

test('stays greyed for the whole of a keyboard grab, however long the hand is still', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()

  await page.getByTestId('viewport-stage').click({ position: { x: 4, y: 4 } })
  await row(page, 'Slime').click()
  await page.keyboard.press('g')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-grabbing', '')

  // The whole bug. The grab is running and nothing is moving, which is exactly
  // the state the old condition read as "the picture is up to date, so Play is
  // fine" — and it is the state a grab spends most of its life in.
  await expect(play(page)).toBeDisabled()
  await page.waitForTimeout(LONG_ENOUGH_TO_SETTLE)
  await expect(play(page)).toBeDisabled()

  await page.keyboard.press('Escape')
  await expect(viewport(page)).toHaveAttribute('data-scene-grabbing', '')
  await expect(play(page)).toBeEnabled()
})

test('stays greyed through a pause in the middle of a drag', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()

  const from = await outlineCentre(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y, { steps: 8 })
  await expect(viewport(page)).not.toHaveAttribute('data-scene-dragging', '')

  // Held still with the button down: the renderer catches up, and the old
  // condition let go of the button while the sprite was still in the hand.
  await expect(play(page)).toBeDisabled()
  await page.waitForTimeout(LONG_ENOUGH_TO_SETTLE)
  await expect(play(page)).toBeDisabled()

  await page.mouse.up()
  await expect(viewport(page)).toHaveAttribute('data-scene-dragging', '')
  await expect(play(page)).toBeEnabled()
})

/**
 * The other half: the gating must not become a button that never comes back.
 * A grab that ends by putting the entity down re-enables Play just as `Esc` does.
 */
test('comes back once the entity is put down', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  await page.keyboard.press('g')
  await expect(play(page)).toBeDisabled()

  await page.keyboard.press('Enter')

  await expect(viewport(page)).toHaveAttribute('data-scene-grabbing', '')
  await expect(play(page)).toBeEnabled()
})

test('says why it is greyed rather than blaming the level for still opening', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  await page.keyboard.press('g')

  await expect(play(page)).toHaveAttribute('title', /still being moved/)
})
