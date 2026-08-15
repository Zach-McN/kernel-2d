import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'

/**
 * Selecting several entities, and removing them together.
 *
 * The acceptances, in the units they were asked for (`editor-verification` V1):
 * Shift adds to the selection and Ctrl takes away, in the Outliner *and* in the
 * picture; Delete removes everything selected; and **one press of Ctrl-Z brings
 * all of them back** — which is the criterion the human chose, and the reason
 * the delete is one transaction rather than one per entity.
 *
 * Nothing here asserts on a selection *store*. What is selected is read as the
 * highlighted rows, the outlines the renderer's report puts on screen, and what
 * the level ends up holding — behaviour, not structure (`editor-verification`
 * V1). The two negative tests are the load-bearing ones: a Delete key that fires
 * while somebody is renaming an entity, or while a level is running, passes
 * every positive test in this file.
 *
 * These tests change the shared sample project, so every file is snapshotted and
 * put back afterwards (V14).
 */

const LEVEL_ONE = 'scenes/level-01.json'
const ALL_FIVE = ['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon']

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

// --- reading what is selected ----------------------------------------------

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')
const outliner = (page: Page): Locator => page.getByTestId('outliner-panel')
const rows = (page: Page): Locator => outliner(page).locator('[data-entity-id]')
const row = (page: Page, name: string): Locator =>
  outliner(page).locator('[data-entity-id]').filter({ hasText: name }).first()

/** The rows the Outliner is highlighting. */
const highlighted = (page: Page): Locator => outliner(page).locator('[data-selected="true"]')

/** How many entities the picture says are selected. */
async function selectedCount(page: Page): Promise<number> {
  return Number(await viewport(page).getAttribute('data-scene-selected-count'))
}

async function names(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((buttons) =>
    buttons.map((button) => button.querySelector('.entity-row__name')?.textContent ?? ''),
  )
}

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

async function openScene(page: Page): Promise<void> {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await settled(page)
}

/**
 * Where an entity is drawn, in window coordinates.
 *
 * Found by selecting it on its own and reading the outline the renderer
 * reported, which is the same trick `drag-place.spec.ts` uses: nothing here
 * works out where a sprite ought to be a second time.
 */
async function spotOf(page: Page, name: string): Promise<{ x: number; y: number }> {
  await row(page, name).click()
  await expect(page.getByTestId('scene-selected-bounds')).toHaveCount(1)
  const box = await page.getByTestId('scene-selected-bounds').boundingBox()
  expect(box).not.toBeNull()
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
}

/**
 * A click in the picture, optionally with a modifier held.
 *
 * The key is held around the press by hand rather than passed as an option:
 * `mouse.click` takes no modifiers — only `locator.click` does — and a modifier
 * handed to it is accepted and silently ignored, which reads exactly like the
 * feature not working. The same shape `drag-place.spec.ts` uses for Alt.
 */
async function clickIn(
  page: Page,
  at: { x: number; y: number },
  modifier?: 'Shift' | 'Control',
): Promise<void> {
  if (modifier !== undefined) await page.keyboard.down(modifier)
  await page.mouse.click(at.x, at.y)
  if (modifier !== undefined) await page.keyboard.up(modifier)
}

/** A point in the picture that is not on any entity. */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('viewport-stage').boundingBox()
  expect(box).not.toBeNull()
  return { x: (box?.x ?? 0) + (box?.width ?? 0) - 12, y: (box?.y ?? 0) + 12 }
}

// --- acceptance: building a selection in the Outliner -----------------------

test.describe('the Outliner', () => {
  test('Shift-click adds to the selection, in the list and in the picture', async ({ page }) => {
    await openScene(page)

    await row(page, 'Ground').click()
    await expect(highlighted(page)).toHaveCount(1)

    await row(page, 'Knight').click({ modifiers: ['Shift'] })
    await row(page, 'Slime').click({ modifiers: ['Shift'] })

    await expect(highlighted(page)).toHaveCount(3)
    // The picture agrees, and it agrees by drawing three outlines rather than by
    // being told a number — one panel, one object (`editor-ui` U12).
    await expect.poll(() => selectedCount(page)).toBe(3)
    await expect(page.getByTestId('scene-selected')).toHaveCount(3)
  })

  test('Ctrl-click takes one back out', async ({ page }) => {
    await openScene(page)
    await row(page, 'Ground').click()
    await row(page, 'Knight').click({ modifiers: ['Shift'] })
    await row(page, 'Slime').click({ modifiers: ['Shift'] })
    await expect(highlighted(page)).toHaveCount(3)

    await row(page, 'Knight').click({ modifiers: ['ControlOrMeta'] })

    await expect(highlighted(page)).toHaveCount(2)
    await expect(row(page, 'Knight')).toHaveAttribute('data-selected', 'false')
    await expect.poll(() => selectedCount(page)).toBe(2)
  })

  test('a plain click starts again with one', async ({ page }) => {
    await openScene(page)
    await row(page, 'Ground').click()
    await row(page, 'Knight').click({ modifiers: ['Shift'] })
    await expect(highlighted(page)).toHaveCount(2)

    await row(page, 'Slime').click()

    await expect(highlighted(page)).toHaveCount(1)
    await expect(row(page, 'Slime')).toHaveAttribute('data-selected', 'true')
  })

  test('the Inspector says which one of several it is describing', async ({ page }) => {
    await openScene(page)
    await row(page, 'Ground').click()
    await row(page, 'Knight').click({ modifiers: ['Shift'] })
    await row(page, 'Slime').click({ modifiers: ['Shift'] })

    // The last one clicked is the one described, and the panel says so rather
    // than showing one entity's fields under a selection of three.
    await expect(page.getByTestId('inspector-name')).toHaveText('Slime')
    await expect(page.getByTestId('inspector-also-selected')).toContainText('3 selected')
    await expect(page.getByTestId('inspector-also-selected')).toContainText('Slime')
  })

  test('the Delete button says how many it would remove', async ({ page }) => {
    await openScene(page)
    await row(page, 'Ground').click()
    await expect(page.getByTestId('entity-delete')).toHaveText('Delete')

    await row(page, 'Knight').click({ modifiers: ['Shift'] })
    await row(page, 'Slime').click({ modifiers: ['Shift'] })

    await expect(page.getByTestId('entity-delete')).toHaveText('Delete 3')
  })
})

// --- acceptance: building a selection in the picture ------------------------

test.describe('the picture', () => {
  test('Shift-click on a sprite adds it to the selection', async ({ page }) => {
    await openScene(page)
    const knight = await spotOf(page, 'Knight')
    const slime = await spotOf(page, 'Slime')

    await clickIn(page, knight)
    await expect.poll(() => selectedCount(page)).toBe(1)

    await clickIn(page, slime, 'Shift')

    await expect.poll(() => selectedCount(page)).toBe(2)
    // And the Outliner agrees, which is the same one-object claim from the
    // other side.
    await expect(highlighted(page)).toHaveCount(2)
  })

  test('Ctrl-click on a sprite takes it back out', async ({ page }) => {
    await openScene(page)
    const knight = await spotOf(page, 'Knight')
    const slime = await spotOf(page, 'Slime')

    await clickIn(page, knight)
    await clickIn(page, slime, 'Shift')
    await expect.poll(() => selectedCount(page)).toBe(2)

    await clickIn(page, slime, 'Control')

    await expect.poll(() => selectedCount(page)).toBe(1)
    await expect(row(page, 'Knight')).toHaveAttribute('data-selected', 'true')
  })

  /**
   * The one that makes the feature usable rather than merely present. A
   * selection built over six careful clicks, lost to a seventh that missed, is a
   * selection nobody attempts a second time.
   */
  test('a Shift-click that misses everything leaves the selection alone', async ({ page }) => {
    await openScene(page)
    const knight = await spotOf(page, 'Knight')
    const slime = await spotOf(page, 'Slime')
    await clickIn(page, knight)
    await clickIn(page, slime, 'Shift')
    await expect.poll(() => selectedCount(page)).toBe(2)

    const nowhere = await emptySpot(page)
    await clickIn(page, nowhere, 'Shift')

    await expect.poll(() => selectedCount(page)).toBe(2)

    // A *plain* click on nothing still clears, which is how a selection is let
    // go — the modifier is what makes the difference, not the empty space.
    await clickIn(page, nowhere)
    await expect.poll(() => selectedCount(page)).toBe(0)
  })

  test('leaves a picture of three entities selected at once', async ({ page }, testInfo) => {
    await openScene(page)
    const knight = await spotOf(page, 'Knight')
    const slime = await spotOf(page, 'Slime')
    const ground = await spotOf(page, 'Ground')

    await clickIn(page, knight)
    await clickIn(page, slime, 'Shift')
    await clickIn(page, ground, 'Shift')
    await expect.poll(() => selectedCount(page)).toBe(3)

    await viewport(page).screenshot({ path: testInfo.outputPath('multi-select.png') })
  })
})

// --- acceptance: the Delete key ---------------------------------------------

test.describe('the Delete key', () => {
  test('removes the one selected entity', async ({ page }) => {
    await openScene(page)
    await row(page, 'Slime').click()

    await page.keyboard.press('Delete')

    await expect(rows(page)).toHaveCount(4)
    expect(await names(page)).not.toContain('Slime')
  })

  test('removes everything selected, and one Ctrl-Z brings it all back', async ({ page }) => {
    await openScene(page)
    await row(page, 'Knight').click()
    await row(page, 'Slime').click({ modifiers: ['Shift'] })
    await row(page, 'Health icon').click({ modifiers: ['Shift'] })

    await page.keyboard.press('Delete')

    await expect(rows(page)).toHaveCount(2)
    expect(await names(page)).toEqual(['Ground', 'Knight running'])

    // **One** press, not three. Three entities removed in three transactions
    // would take three presses and pass the level through two states nobody
    // asked for on the way back.
    await page.keyboard.press('ControlOrMeta+z')

    await expect(rows(page)).toHaveCount(5)
    expect(await names(page)).toEqual(ALL_FIVE)
    // Everything the entities had, not merely their names — the patches the
    // transaction recorded put the whole entity back.
    await expect(row(page, 'Slime')).toContainText('slime.png')
  })

  test('works from the picture, on a selection built there', async ({ page }) => {
    await openScene(page)
    const knight = await spotOf(page, 'Knight')
    const slime = await spotOf(page, 'Slime')

    await clickIn(page, knight)
    await clickIn(page, slime, 'Shift')
    await expect.poll(() => selectedCount(page)).toBe(2)

    await page.keyboard.press('Delete')

    await expect(rows(page)).toHaveCount(3)
    expect(await names(page)).toEqual(['Ground', 'Knight running', 'Health icon'])

    await page.keyboard.press('ControlOrMeta+z')
    expect(await names(page)).toEqual(ALL_FIVE)
  })

  /**
   * The two that a positive-only suite would miss entirely. Both are the same
   * mistake — a bare key that fires somewhere it has no business firing — and
   * both are silent: the entity is simply gone, with nothing on screen saying
   * why.
   */
  test('does not delete anything while a name is being typed', async ({ page }) => {
    await openScene(page)
    await row(page, 'Slime').click()

    const name = page.getByTestId('entity-name-control')
    await name.click()
    await name.press('Home')
    await name.press('Delete')

    // The character went; the entity did not.
    await expect(rows(page)).toHaveCount(5)
    await expect(name).toHaveValue('lime')
  })

  test('does not delete anything while a level is running', async ({ page }) => {
    await openScene(page)
    await row(page, 'Slime').click()
    await expect(page.getByTestId('play-start')).toBeEnabled()
    await page.getByTestId('play-start').click()
    await expect(viewport(page)).toHaveAttribute('data-play-state', 'running')

    await page.keyboard.press('Delete')

    await page.getByTestId('play-stop').click()
    await expect(viewport(page)).toHaveAttribute('data-play-state', 'stopped')
    await expect(rows(page)).toHaveCount(5)
    expect(await names(page)).toEqual(ALL_FIVE)
  })

  test('does nothing when nothing is selected', async ({ page }) => {
    await openScene(page)

    await page.keyboard.press('Delete')

    await expect(rows(page)).toHaveCount(5)
  })
})
