import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import {
  carryRow,
  carrying,
  dragRow,
  fillUntilItScrolls,
  moveOverRow,
  outlinerList,
  scrollTop,
} from './carry-row.js'
import { parsedWhenWhole } from './parse-when-whole.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { cameraScale, openScene, outlinerRow, outlinerRows, viewport } from './scene-view.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Attaching one entity to another (editor-kernel D37), as the human meets it:
 * a row dropped onto another row becomes its child, the Inspector's numbers
 * become an offset, and moving or turning the parent carries the child — in the
 * picture and in Play.
 *
 * Where things are is read from `data-scene-units`, the renderer's own report in
 * the level's units (`editor-verification` V17): the assertion "the child did not
 * move when it was attached" is about where it was *drawn*, not about a number
 * this feature wrote. The sample level has Knight at (100, 16) and Slime at
 * (200, 16), so Slime attached to Knight is an offset of exactly (100, 0), and a
 * quarter turn of Knight puts Slime at (100, 116).
 */

const LEVEL_ONE = 'scenes/level-01.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

// --- reading what happened -------------------------------------------------

const outliner = (page: Page) => page.getByTestId('outliner-panel')

async function names(page: Page): Promise<string[]> {
  return outlinerRows(page).locator('.entity-row__name').allTextContents()
}

/** How far in a row is drawn: 0 at the top level, 1 for a child. */
async function depthOf(page: Page, name: string): Promise<number> {
  return Number(await outlinerRow(page, name).locator('..').getAttribute('data-depth'))
}

/** The middle of the primary selected entity's outline — the first of them, when several are selected. */
async function outlineCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('scene-selected-bounds').first().boundingBox()
  if (box === null) throw new Error('nothing is outlined')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** What the Inspector says about the selected entity — an offset, for a child. */
async function position(page: Page): Promise<{ x: number; y: number }> {
  return {
    x: Number(await page.getByTestId('entity-x-control').inputValue()),
    y: Number(await page.getByTestId('entity-y-control').inputValue()),
  }
}

/** Where each entity was drawn, by name, in level units, from the renderer's report. */
async function drawnAt(page: Page, name: string): Promise<{ x: number; y: number }> {
  const id = await outlinerRow(page, name).getAttribute('data-entity-id')
  const units = JSON.parse((await viewport(page).getAttribute('data-scene-units')) ?? '[]') as Array<{
    id: string
    x: number
    y: number
  }>
  const found = units.find((one) => one.id === id)
  if (found === undefined) throw new Error(`${name} was not drawn`)
  return { x: found.x, y: found.y }
}

interface SavedEntity {
  id: string
  name: string
  parent?: string
  transform: { x: number; y: number; rotation: number }
}

function savedLevel(): SavedEntity[] | undefined {
  return parsedWhenWhole<{ entities: SavedEntity[] }>(path.join(editorTestProjectPath(), LEVEL_ONE))?.entities
}

// --- driving the Outliner ----------------------------------------------------

/** Slime attached to Knight — the starting point of most of what follows. */
async function attachSlimeToKnight(page: Page): Promise<void> {
  await dragRow(page, 'Slime', 'Knight', 'into')
  await expect(outlinerRow(page, 'Slime').locator('..')).toHaveAttribute('data-depth', '1')
}

async function grabFrom(page: Page, from: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.keyboard.press('g')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-grabbing', '')
}

/** `R`, then the pointer taken round to a bearing about the gizmo's own pivot. */
async function turnTo(page: Page, degrees: number): Promise<void> {
  await page.keyboard.press('r')
  await expect(viewport(page)).not.toHaveAttribute('data-scene-turning', '')
  const mark = await page.getByTestId('scene-turn-pivot').boundingBox()
  if (mark === null) throw new Error('no pivot')
  const pivot = { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 }
  const reach = 90
  await page.mouse.move(pivot.x + reach, pivot.y)
  const radians = (degrees * Math.PI) / 180
  await page.mouse.move(pivot.x + reach * Math.cos(radians), pivot.y - reach * Math.sin(radians), { steps: 10 })
}

// --- attaching and detaching ---------------------------------------------------

test.describe('dropping a row onto another', () => {
  test('makes it a child: indented under its parent, and not moved in the picture', async ({ page }, testInfo) => {
    await openScene(page, LEVEL_ONE)
    const before = await drawnAt(page, 'Slime')

    await attachSlimeToKnight(page)

    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
    expect(await depthOf(page, 'Knight')).toBe(0)
    expect(await depthOf(page, 'Slime')).toBe(1)
    expect(await drawnAt(page, 'Slime')).toEqual(before)
    // The one genuinely new picture in the list: a row indented under another.
    await outliner(page).screenshot({ path: testInfo.outputPath('outliner-indented.png') })
  })

  test('shows the child’s numbers as an offset from its parent, and says so', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await outlinerRow(page, 'Slime').click()

    await expect(page.getByTestId('inspector-panel').getByText('Transform — offset from Knight')).toBeVisible()
    await expect(page.getByTestId('entity-transform-offset')).toContainText('Knight')
    expect(await position(page)).toEqual({ x: 100, y: 0 })
  })

  test('typing an offset places the child relative to its parent', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await outlinerRow(page, 'Slime').click()

    await page.getByTestId('entity-y-control').fill('20')
    await page.getByTestId('entity-y-control').blur()

    await expect.poll(async () => (await drawnAt(page, 'Slime')).y).toBe(36)
  })

  test('writes a parent onto that one entity and nothing else', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)

    await expect.poll(() => savedLevel()?.find((one) => one.name === 'Slime')?.parent).toBeTruthy()
    const saved = savedLevel() ?? []
    const knight = saved.find((one) => one.name === 'Knight')
    expect(saved.find((one) => one.name === 'Slime')?.parent).toBe(knight?.id)
    expect(saved.filter((one) => 'parent' in one)).toHaveLength(1)
    expect(saved.find((one) => one.name === 'Slime')?.transform).toMatchObject({ x: 100, y: 0 })
  })

  test('refuses to attach a row to itself or to its own child — no line, no change', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)

    await carryRow(page, 'Knight', 'Slime', 'into')
    await expect(outliner(page).locator('[data-drop-line]')).toHaveCount(0)
    await page.mouse.up()

    expect(await depthOf(page, 'Knight')).toBe(0)
    expect(await depthOf(page, 'Slime')).toBe(1)
  })

  test('a row held over the middle of another is marked as its future parent', async ({ page }, testInfo) => {
    await openScene(page, LEVEL_ONE)
    await carryRow(page, 'Slime', 'Knight', 'into')

    await expect(outlinerRow(page, 'Knight').locator('..')).toHaveAttribute('data-drop-line', 'into')
    await outliner(page).screenshot({ path: testInfo.outputPath('outliner-drop-into.png') })
    await page.mouse.up()
  })
})

test.describe('dragging a child back out', () => {
  test('between two top-level rows puts it at the top level, where it appeared', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    const before = await drawnAt(page, 'Slime')

    await dragRow(page, 'Slime', 'Health icon', 'before')

    expect(await names(page)).toEqual(['Ground', 'Knight', 'Knight running', 'Slime', 'Health icon'])
    expect(await depthOf(page, 'Slime')).toBe(0)
    expect(await drawnAt(page, 'Slime')).toEqual(before)
    await outlinerRow(page, 'Slime').click()
    expect(await position(page)).toEqual({ x: 200, y: 16 })
  })

  test('is one press of Ctrl-Z, as attaching was', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await dragRow(page, 'Slime', 'Health icon', 'before')

    await page.keyboard.press('ControlOrMeta+z')
    expect(await depthOf(page, 'Slime')).toBe(1)
    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])

    await page.keyboard.press('ControlOrMeta+z')
    expect(await depthOf(page, 'Slime')).toBe(0)
    await outlinerRow(page, 'Slime').click()
    expect(await position(page)).toEqual({ x: 200, y: 16 })
  })
})

// --- reaching a row that is off screen -------------------------------------------

/*
 * The reason the gesture is the editor's own rather than the browser's drag
 * (`editor-ui` U37, amended): in a level with more rows than fit, the entity
 * you mean to attach to is usually not on screen when you pick the child up,
 * and a native drag never lets the wheel reach the page. So the test builds
 * that level, picks up the last row, and scrolls with the wheel while holding
 * it.
 */

test.describe('carrying a row while the list scrolls', () => {
  test('the wheel scrolls the list mid-carry, and the row lands on what it brought into view', async ({
    page,
  }, testInfo) => {
    await openScene(page, LEVEL_ONE)
    await fillUntilItScrolls(page)
    const rows = await names(page)
    const last = rows[rows.length - 1] ?? ''

    // To the bottom of the list, where Ground is out of sight.
    await outlinerList(page).hover()
    await page.mouse.wheel(0, 2000)
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0)

    // Pick the last row up, then wheel back to the top while still holding it.
    const held = await outlinerRow(page, last).getAttribute('data-entity-id')
    await outlinerRow(page, last).hover()
    await page.mouse.down()
    const from = await outlinerRow(page, last).boundingBox()
    await page.mouse.move((from?.x ?? 0) + 40, (from?.y ?? 0) + 10, { steps: 4 })
    expect(await carrying(page)).toBe(held)

    await page.mouse.wheel(0, -2000)
    await expect.poll(() => scrollTop(page)).toBe(0)
    expect(await carrying(page)).toBe(held)

    await moveOverRow(page, 'Ground', 'into')
    await expect(page.locator('.entity-row[data-drop-line="into"]')).toHaveCount(1)
    await page.getByTestId('outliner-panel').screenshot({ path: testInfo.outputPath('carry-scrolled.png') })
    await page.mouse.up()

    expect(await depthOf(page, last)).toBe(1)
    const ground = await outlinerRow(page, 'Ground').getAttribute('data-entity-id')
    await expect.poll(() => savedLevel()?.find((one) => one.name === last)?.parent).toBe(ground)
  })

  test('Esc while carrying puts the row back, and one drop is still one Ctrl-Z', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    const before = await names(page)

    await carryRow(page, 'Slime', 'Knight', 'into')
    await page.keyboard.press('Escape')
    await page.mouse.up()

    expect(await names(page)).toEqual(before)
    expect(await depthOf(page, 'Slime')).toBe(0)

    await dragRow(page, 'Slime', 'Knight', 'into')
    expect(await depthOf(page, 'Slime')).toBe(1)
    await page.keyboard.press('ControlOrMeta+z')
    expect(await depthOf(page, 'Slime')).toBe(0)
  })

  test('a press that does not move is still a plain click that selects', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    await outlinerRow(page, 'Slime').click()

    await expect(page.getByTestId('inspector-name')).toHaveText('Slime')
    expect(await carrying(page)).toBe('')
    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
  })
})

// --- the parent carries the child ---------------------------------------------

test.describe('moving a parent', () => {
  test('carries its child by the same distance in the picture', async ({ page }, testInfo) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await outlinerRow(page, 'Knight').click()
    const slimeBefore = await drawnAt(page, 'Slime')
    await page.getByTestId('viewport-panel').screenshot({ path: testInfo.outputPath('parent-before-move.png') })

    const scale = await cameraScale(page)
    const at = await outlineCentre(page)
    await grabFrom(page, at)
    await page.mouse.move(at.x + 9 * scale, at.y - 4 * scale, { steps: 8 })
    await page.mouse.down()
    await page.mouse.up()
    await expect(viewport(page)).toHaveAttribute('data-scene-grabbing', '')

    expect(await position(page)).toEqual({ x: 109, y: 20 })
    await expect.poll(async () => drawnAt(page, 'Slime')).toEqual({ x: slimeBefore.x + 9, y: slimeBefore.y + 4 })
    await page.getByTestId('viewport-panel').screenshot({ path: testInfo.outputPath('parent-after-move.png') })
  })

  test('with its child also selected moves the pair once, not the child twice', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await outlinerRow(page, 'Knight').click()
    await outlinerRow(page, 'Slime').click({ modifiers: ['Shift'] })
    const slimeBefore = await drawnAt(page, 'Slime')

    const scale = await cameraScale(page)
    const at = await outlineCentre(page)
    await grabFrom(page, at)
    await page.mouse.move(at.x + 6 * scale, at.y, { steps: 8 })
    await page.mouse.down()
    await page.mouse.up()
    await expect(viewport(page)).toHaveAttribute('data-scene-grabbing', '')

    await expect.poll(async () => (await drawnAt(page, 'Slime')).x).toBe(slimeBefore.x + 6)
  })

  test('undoes in one step, child and all', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await outlinerRow(page, 'Knight').click()
    const slimeBefore = await drawnAt(page, 'Slime')

    const scale = await cameraScale(page)
    const at = await outlineCentre(page)
    await grabFrom(page, at)
    await page.mouse.move(at.x + 9 * scale, at.y, { steps: 8 })
    await page.mouse.down()
    await page.mouse.up()
    await expect.poll(async () => (await drawnAt(page, 'Slime')).x).toBe(slimeBefore.x + 9)

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => drawnAt(page, 'Slime')).toEqual(slimeBefore)
  })
})

test.describe('turning a parent', () => {
  test('swings its child round it, and Play draws the same picture', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await outlinerRow(page, 'Knight').click()

    await turnTo(page, 90)
    await page.mouse.down()
    await page.mouse.up()
    await expect(viewport(page)).toHaveAttribute('data-scene-turning', '')

    // Knight at (100, 16), Slime 100 to its right: a quarter turn puts Slime
    // 100 above it.
    const slime = await drawnAt(page, 'Slime')
    expect(slime.x).toBeCloseTo(100, 0)
    expect(slime.y).toBeCloseTo(116, 0)

    await expect(page.getByTestId('play-start')).toBeEnabled()
    await page.getByTestId('play-start').click()
    await expect(viewport(page)).toHaveAttribute('data-play-state', 'running')
    await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')
    await page.getByTestId('play-stop').click()
    await expect(viewport(page)).toHaveAttribute('data-play-state', 'stopped')
  })
})

// --- duplicate and delete carry the children -------------------------------------

test.describe('a parent’s copy and a parent’s delete', () => {
  test('Shift-D copies the parent with its child, attached to the copy', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await outlinerRow(page, 'Knight').click()

    await page.keyboard.press('Shift+D')

    expect(await names(page)).toEqual([
      'Ground',
      'Knight',
      'Slime',
      'Knight 2',
      'Slime 2',
      'Knight running',
      'Health icon',
    ])
    expect(await depthOf(page, 'Slime 2')).toBe(1)
    await expect.poll(() => savedLevel()?.find((one) => one.name === 'Slime 2')?.parent).toBeTruthy()
    const saved = savedLevel() ?? []
    expect(saved.find((one) => one.name === 'Slime 2')?.parent).toBe(saved.find((one) => one.name === 'Knight 2')?.id)
  })

  test('Delete takes the parent and its child, and Ctrl-Z brings both back', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await attachSlimeToKnight(page)
    await outlinerRow(page, 'Knight').click()
    await expect(page.getByTestId('entity-delete')).toHaveAttribute('data-delete-count', '2')

    await page.keyboard.press('Delete')
    expect(await names(page)).toEqual(['Ground', 'Knight running', 'Health icon'])

    await page.keyboard.press('ControlOrMeta+z')
    expect(await names(page)).toEqual(['Ground', 'Knight', 'Slime', 'Knight running', 'Health icon'])
    expect(await depthOf(page, 'Slime')).toBe(1)
  })
})

// --- a parent that is not there ----------------------------------------------------

test.describe('a level naming a parent that is not in it', () => {
  test('opens, draws the entity by its own numbers, and says so on the row and under the picture', async ({
    page,
  }) => {
    const file = path.join(editorTestProjectPath(), LEVEL_ONE)
    const level = JSON.parse(fs.readFileSync(file, 'utf8')) as { entities: SavedEntity[] }
    const heart = level.entities.find((one) => one.name === 'Health icon')
    if (heart === undefined) throw new Error('no Health icon in the sample level')
    heart.parent = 'ffffffffffffffff'
    fs.writeFileSync(file, `${JSON.stringify(level, null, 2)}\n`)

    await openScene(page, LEVEL_ONE)

    await expect(outlinerRows(page)).toHaveCount(5)
    await expect(outlinerRow(page, 'Health icon')).toHaveAttribute('data-entity-problem', 'missing parent')
    expect(await drawnAt(page, 'Health icon')).toEqual({ x: 28, y: 180 })
    await expect(viewport(page).getByTestId('viewport-problem').first()).toContainText('Health icon')
  })
})

// --- what the arrows do now ----------------------------------------------------------

test('the arrows move a child among its parent’s children and never out of them', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await attachSlimeToKnight(page)
  await outlinerRow(page, 'Slime').click()

  await expect(page.getByTestId('entity-move-up')).toBeDisabled()
  await expect(page.getByTestId('entity-move-down')).toBeDisabled()

  await outlinerRow(page, 'Knight').click()
  await page.getByTestId('entity-move-down').click()
  expect(await names(page)).toEqual(['Ground', 'Knight running', 'Knight', 'Slime', 'Health icon'])
  expect(await depthOf(page, 'Slime')).toBe(1)
})
