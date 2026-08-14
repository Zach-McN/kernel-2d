import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'

/**
 * Opening a scene, and changing what is in it.
 *
 * Acceptance criteria 1, 3 and 6 of this feature, in the units they were written
 * in (editor-verification V1): the Outliner lists what is in the scene, an
 * entity can be selected, and adding, deleting and reordering all work — with
 * Ctrl-Z covering every one of them, which is the whole claim of document-level
 * undo.
 *
 * These tests change the shared sample project, so every file is snapshotted and
 * put back afterwards (V14).
 */

const LEVEL_ONE = 'scenes/level-01.json'
const LEVEL_TWO = 'scenes/level-02.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

const rows = (page: Page): Locator => outliner(page).locator('[data-entity-id]')
const outliner = (page: Page): Locator => page.getByTestId('outliner-panel')
const row = (page: Page, name: string): Locator =>
  outliner(page).locator('[data-entity-id]').filter({ hasText: name }).first()

async function names(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((buttons) =>
    buttons.map((button) => button.querySelector('.entity-row__name')?.textContent ?? ''),
  )
}

async function openScene(page: Page, scenePath: string): Promise<void> {
  await selectAsset(page, scenePath)
  await expect(outliner(page)).toHaveAttribute('data-scene', scenePath)
}

/**
 * Hold the pointer over the top or bottom quarter of a row — never its middle.
 * A row is divided at its midline into "before" and "after", and a boundary is
 * not a location; a test standing on it is measuring rounding (`editor-ui`
 * UG11, one panel over).
 */
async function moveOverRow(page: Page, target: string, edge: 'before' | 'after'): Promise<void> {
  const box = await row(page, target).boundingBox()
  if (box === null) throw new Error(`no row for ${target}`)
  const spot = {
    x: box.x + box.width / 2,
    y: box.y + box.height * (edge === 'before' ? 0.25 : 0.75),
  }
  // Two moves: the first advances the drag, the second is the one that is read.
  await page.mouse.move(spot.x, spot.y, { steps: 6 })
  await page.mouse.move(spot.x, spot.y)
}

/** Pick a row up and hold it over another, without letting go. */
async function carryRow(page: Page, dragged: string, target: string, edge: 'before' | 'after'): Promise<void> {
  await row(page, dragged).hover()
  await page.mouse.down()
  await moveOverRow(page, target, edge)
}

/** Drag one row and let it go on the near side of another. */
async function dragRow(page: Page, dragged: string, target: string, edge: 'before' | 'after'): Promise<void> {
  await carryRow(page, dragged, target, edge)
  await page.mouse.up()
}

test.describe('opening a scene', () => {
  test('lists what is in it and draws it', async ({ page }) => {
    await expect(page.getByTestId('outliner-message')).toContainText('No scene is open')

    await openScene(page, LEVEL_ONE)

    await expect(rows(page)).toHaveCount(5)
    await expect(outliner(page)).toContainText('Knight')
    await expect(outliner(page)).toContainText('Slime')
    // Drawn, not merely listed: the count comes from the renderer's report of
    // what it actually put on screen.
    await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-scene-showing', LEVEL_ONE)
    await expect.poll(() => page.getByTestId('viewport-panel').getAttribute('data-scene-drawn')).toBe('5')
  })

  test('says the order things are drawn in, so the list means something', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    await expect(outliner(page)).toContainText('The last one in the list is drawn in front')
  })

  test('opening a second one replaces the first', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await expect(rows(page)).toHaveCount(5)

    await openScene(page, LEVEL_TWO)

    await expect(rows(page)).toHaveCount(4)
    await expect(outliner(page)).toContainText('Cave floor')
  })
})

test.describe('selecting an entity', () => {
  test('shows its properties and marks it in the picture', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    await row(page, 'Knight').click()

    await expect(page.getByTestId('inspector-name')).toHaveText('Knight')
    await expect(page.getByTestId('entity-x-control')).toHaveValue('100')
    // The Viewport marks it as the selected one, at the rectangle the renderer
    // reported drawing rather than one worked out a second time.
    await expect(page.getByTestId('scene-selected-bounds')).toBeVisible()
  })

  test('marks a different one when a different one is clicked', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await row(page, 'Knight').click()
    const knight = await page.getByTestId('scene-selected').getAttribute('data-selected-entity')

    await row(page, 'Slime').click()

    await expect(page.getByTestId('inspector-name')).toHaveText('Slime')
    await expect(page.getByTestId('scene-selected')).not.toHaveAttribute('data-selected-entity', knight ?? '')
  })
})

test.describe('changing what is in the scene', () => {
  test('adds an entity, gives it a texture, and it appears', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    // Read once the renderer has caught up, not the moment the scene opens: a
    // count captured a frame early is a number that is true and then isn't,
    // and the failure surfaces in the comparison rather than here (V18).
    await expect
      .poll(() => page.getByTestId('viewport-panel').getAttribute('data-scene-drawn'))
      .toBe('5')

    await page.getByTestId('entity-add').click()

    await expect(rows(page)).toHaveCount(6)
    // A new entity has no sprite, so the count of things actually drawn has not
    // moved yet — which is exactly what "and it appears" is about to test.
    await expect(page.getByTestId('inspector-name')).toHaveText('Entity 6')

    await page
      .getByTestId('entity-texture-control')
      .selectOption('assets/textures/ui/icon-heart.png')

    await expect
      .poll(() => page.getByTestId('viewport-panel').getAttribute('data-scene-drawn'))
      .toBe('6')
  })

  test('duplicates one, on top of the original and just in front of it', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await row(page, 'Slime').click()
    const before = {
      x: await page.getByTestId('entity-x-control').inputValue(),
      y: await page.getByTestId('entity-y-control').inputValue(),
    }

    await page.getByTestId('entity-duplicate').click()

    await expect(rows(page)).toHaveCount(6)
    // Directly after the original rather than at the end: list order is draw
    // order, so appending would quietly put the copy in front of the level.
    expect(await names(page)).toEqual([
      'Ground',
      'Knight',
      'Slime',
      'Slime 2',
      'Knight running',
      'Health icon',
    ])

    // The copy is what is selected, and it is exactly where the original is —
    // which is what makes one drag enough to separate them.
    await expect(page.getByTestId('inspector-name')).toHaveText('Slime 2')
    await expect(page.getByTestId('entity-x-control')).toHaveValue(before.x)
    await expect(page.getByTestId('entity-y-control')).toHaveValue(before.y)
  })

  test('the copy draws the same sprite, so there really are two of them', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await expect
      .poll(() => page.getByTestId('viewport-panel').getAttribute('data-scene-drawn'))
      .toBe('5')

    await row(page, 'Slime').click()
    await page.getByTestId('entity-duplicate').click()

    await expect
      .poll(() => page.getByTestId('viewport-panel').getAttribute('data-scene-drawn'))
      .toBe('6')
  })

  test('duplicating is not offered until something is selected', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    await expect(page.getByTestId('entity-duplicate')).toBeDisabled()
    await row(page, 'Slime').click()
    await expect(page.getByTestId('entity-duplicate')).toBeEnabled()
  })

  test('deletes one and it goes', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await row(page, 'Slime').click()

    await page.getByTestId('entity-delete').click()

    await expect(rows(page)).toHaveCount(4)
    expect(await names(page)).not.toContain('Slime')
  })

  test('moves one down the list and what is drawn in front changes', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])

    await row(page, 'Knight').first().click()
    await page.getByTestId('entity-move-down').click()

    // The list *is* the draw order, so this is the whole of "bring it forward".
    expect(await names(page)).toEqual(['Ground', 'Slime', 'Knight', 'Knight running', 'Health icon'])
  })

  test('will not move the first one back or the last one forward', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    await row(page, 'Ground').click()
    await expect(page.getByTestId('entity-move-up')).toBeDisabled()

    await row(page, 'Health icon').click()
    await expect(page.getByTestId('entity-move-down')).toBeDisabled()
  })
})

/**
 * The arrows' alternative: pick a row up and let it go where it should sit.
 * Same list, same draw-order meaning, same single transaction — the drag is a
 * second door on the reorder the arrows already own.
 */
test.describe('dragging a row to reorder', () => {
  test('a row let go below another lands after it', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])

    await dragRow(page, 'Knight', 'Slime', 'after')

    expect(await names(page)).toEqual(['Ground', 'Slime', 'Knight', 'Knight running', 'Health icon'])
  })

  test('a row let go above another lands before it', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    await dragRow(page, 'Health icon', 'Knight', 'before')

    expect(await names(page)).toEqual(['Ground', 'Health icon', 'Knight', 'Slime', 'Knight running'])
  })

  test('a line shows where the row would land, and no line where nothing would change', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    // Held over the lower half of Slime: the line marks the slot after it.
    await carryRow(page, 'Knight', 'Slime', 'after')
    await expect(outliner(page).locator('[data-drop-line]')).toHaveCount(1)

    // Held over its own upper half: letting go would change nothing, so
    // nothing promises anything.
    await moveOverRow(page, 'Knight', 'before')
    await expect(outliner(page).locator('[data-drop-line]')).toHaveCount(0)

    await page.mouse.up()
    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
  })

  test('one drag is one press of Ctrl-Z', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    await dragRow(page, 'Knight', 'Knight running', 'after')
    expect(await names(page)).toEqual(['Ground', 'Slime', 'Knight running', 'Knight', 'Health icon'])

    await page.keyboard.press('ControlOrMeta+z')

    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
  })

  test('leaves a picture of a row held over the list', async ({ page }, testInfo) => {
    await openScene(page, LEVEL_ONE)
    await carryRow(page, 'Knight', 'Slime', 'after')
    await expect(outliner(page).locator('[data-drop-line]')).toHaveCount(1)
    await outliner(page).screenshot({ path: testInfo.outputPath('outliner-drag.png') })
    await page.mouse.up()
  })
})

/**
 * The point of the whole transaction API, said as behaviour: nobody wrote a
 * line of undo code for any of these, and one press takes each of them back.
 */
test.describe('undo covers all of it', () => {
  test('takes back an add', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await page.getByTestId('entity-add').click()
    await expect(rows(page)).toHaveCount(6)

    await page.keyboard.press('ControlOrMeta+z')

    await expect(rows(page)).toHaveCount(5)
  })

  test('takes back a delete, with everything the entity had', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await row(page, 'Slime').click()
    await page.getByTestId('entity-delete').click()
    await expect(rows(page)).toHaveCount(4)

    await page.keyboard.press('ControlOrMeta+z')

    await expect(rows(page)).toHaveCount(5)
    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
    await expect(row(page, 'Slime')).toContainText('slime.png')
  })

  test('takes back a duplicate', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await row(page, 'Slime').click()
    await page.getByTestId('entity-duplicate').click()
    await expect(rows(page)).toHaveCount(6)

    await page.keyboard.press('ControlOrMeta+z')

    await expect(rows(page)).toHaveCount(5)
    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
  })

  test('takes back a reorder', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await row(page, 'Knight').first().click()
    await page.getByTestId('entity-move-down').click()
    expect(await names(page)).toEqual(['Ground', 'Slime', 'Knight', 'Knight running', 'Health icon'])

    await page.keyboard.press('ControlOrMeta+z')

    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
  })
})

test('an empty scene says it is empty rather than showing nothing', async ({ page }) => {
  await openScene(page, LEVEL_TWO)

  for (const name of ['Cave floor', 'Slime', 'Tilted slime', 'Continue button']) {
    await row(page, name).click()
    await page.getByTestId('entity-delete').click()
  }

  await expect(page.getByTestId('outliner-message')).toContainText('This scene is empty')
})
