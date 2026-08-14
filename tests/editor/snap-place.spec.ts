import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Setting what a placement lands on, and putting one down for every click —
 * against the real editor, the real service, the real project folder and the
 * real renderer.
 *
 * The two features are one file because they are one job: twenty-six careful
 * drags become twenty-six clicks, and the clicks are only worth anything if
 * they line up. One test per acceptance, in the units they were written in
 * (`editor-verification` V1), and not one of them compares a pixel.
 *
 * The load-bearing ones are at the bottom: a click has to land where the
 * *camera* says it landed, and an offset grid has to reach the positions a
 * tiled board actually uses.
 */

const LEVEL_ONE = 'scenes/level-01.json'
const SLIME_PREFAB = 'prefabs/enemy-slime.json'

/** The human's budget, from "within a second". */
const WITHIN_A_SECOND = 1_000

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

const rows = (page: Page): Locator => page.getByTestId('outliner-panel').locator('[data-entity-id]')

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

/** The scene point in the middle of the canvas, which is where the camera is looking. */
async function focus(page: Page): Promise<{ x: number; y: number }> {
  return {
    x: Number(await viewport(page).getAttribute('data-scene-focus-x')),
    y: Number(await viewport(page).getAttribute('data-scene-focus-y')),
  }
}

async function outlineCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('scene-selected-bounds').boundingBox()
  expect(box).not.toBeNull()
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }
}

/** The canvas itself, so a click can be aimed at its exact middle. */
async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('viewport-stage').locator('canvas').boundingBox()
  expect(box).not.toBeNull()
  return box ?? { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * Setting the grid, and waiting until the panel says it has taken it.
 *
 * The wait is the point: a click on a control resolves when the click was
 * dispatched, not when React has re-rendered (W8), and every assertion in this
 * file is about what a *later* gesture did.
 */
async function setSnap(page: Page, step: number, offset: number): Promise<void> {
  await page.getByTestId('scene-snap-step').fill(String(step))
  await page.getByTestId('scene-snap-offset').fill(String(offset))
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-step', String(step))
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-offset', String(offset))
}

async function dragFrom(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  options: { alt?: boolean } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  if (options.alt === true) await page.keyboard.down('Alt')
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
  await page.mouse.up()
  if (options.alt === true) await page.keyboard.up('Alt')

  await expect(viewport(page)).toHaveAttribute('data-scene-dragging', '')
}

/** Turn on repeat-placing for the slime prefab, from the prefab's own panel. */
async function placeByClicking(page: Page): Promise<void> {
  await selectAsset(page, SLIME_PREFAB)
  await page.getByTestId('prefab-place-by-clicking').click()
  await expect(page.getByTestId('viewport-stamping')).toContainText('Placing')
}

/** The level as it is on disk, once the entity count has caught up. */
async function levelOnDisk(entities: number): Promise<{ name: string; transform: { x: number; y: number } }[]> {
  const file = path.join(editorTestProjectPath(), LEVEL_ONE.replaceAll('/', path.sep))
  await expect
    .poll(
      () => {
        const scene = JSON.parse(fs.readFileSync(file, 'utf8')) as { entities: unknown[] }
        return scene.entities.length
      },
      { timeout: WITHIN_A_SECOND + 1_000 },
    )
    .toBe(entities)

  const scene = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    entities: { name: string; transform: { x: number; y: number } }[]
  }
  return scene.entities
}

// --- acceptance: the snap ---------------------------------------------------

test('with the snap set to 16, a drag lands on a multiple of 16', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 0)
  await row(page, 'Slime').click()

  const before = await position(page)
  const scale = await cameraScale(page)
  await dragFrom(page, await outlineCentre(page), 20 * scale, 0)

  const after = await position(page)
  expect(after.x % 16).toBe(0)
  expect(after.x).not.toBe(before.x)
})

/**
 * The one that decides whether the feature is worth having.
 *
 * A tile sprite hangs off the middle of its position, so a board of 16-unit
 * tiles has its tiles at 8, 24, 40 — positions a grid through the origin cannot
 * reach. A step without an offset would be a snap that quietly puts every new
 * tile half a cell away from the ones already drawn.
 */
test('an offset moves the grid, so 16 from 8 reaches 8, 24 and 40', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 8)
  await row(page, 'Slime').click()

  const scale = await cameraScale(page)
  await dragFrom(page, await outlineCentre(page), 20 * scale, 0)

  const after = await position(page)
  expect((after.x - 8) % 16).toBe(0)
  expect((after.y - 8) % 16).toBe(0)
})

test('Alt still places it anywhere, whatever the snap is', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 8)
  await row(page, 'Slime').click()

  // Zoomed in far enough that one screen pixel is a fraction of a level unit,
  // which is the only zoom at which a free position is even expressible.
  await page.mouse.move(...(Object.values(await outlineCentre(page)) as [number, number]))
  for (let step = 0; step < 3; step += 1) await page.mouse.wheel(0, -120)
  await settled(page)

  await dragFrom(page, await outlineCentre(page), 13, 0, { alt: true })

  expect(Number.isInteger((await position(page)).x)).toBe(false)
})

/**
 * The snap is a fact about this window, not about the level (`editor-ui` U8) —
 * the same rule the camera and the selection follow. A reload is the observable
 * form of it: nothing anywhere on disk remembers.
 */
test('the snap is not saved into the level, and a reload puts it back', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 8)

  await page.reload()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
  await openScene(page)

  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-step', '1')
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-offset', '0')
})

// --- acceptance: placing by clicking ----------------------------------------

test('with it on, every click in the level puts another one down', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()
  await placeByClicking(page)

  const canvas = await canvasBox(page)
  for (const across of [0.3, 0.5, 0.7]) {
    await page.mouse.click(canvas.x + canvas.width * across, canvas.y + canvas.height / 2)
  }

  await expect(rows(page)).toHaveCount(before + 3)
})

/**
 * The acceptance that a single press can never show, stated the way U24 states
 * it: press it repeatedly *without touching anything else*. Placing has always
 * selected what it placed, which would move the Inspector off the prefab on the
 * first click and leave the second one with nothing to press.
 */
test('three clicks in a row change nothing about what is selected', async ({ page }) => {
  await openScene(page)
  await placeByClicking(page)

  const canvas = await canvasBox(page)
  for (const across of [0.3, 0.5, 0.7]) {
    await page.mouse.click(canvas.x + canvas.width * across, canvas.y + canvas.height / 2)
    // Still the prefab's own panel, still offering the switch that is on.
    await expect(page.getByTestId('prefab-place-by-clicking')).toHaveAttribute('aria-pressed', 'true')
  }

  await expect(page.getByTestId('scene-selected-bounds')).toHaveCount(0)
})

/**
 * A board being drawn is covered by its own backdrop, so nearly every press that
 * means "another one here" lands on top of something. A mode that placed only
 * where the level was empty would place nothing at all.
 */
test('a click on top of an existing sprite places rather than selects it', async ({ page }) => {
  await openScene(page)
  await row(page, 'Slime').click()
  const onTheSlime = await outlineCentre(page)
  const before = await rows(page).count()

  await placeByClicking(page)
  await page.mouse.click(onTheSlime.x, onTheSlime.y)

  await expect(rows(page)).toHaveCount(before + 1)
  await expect(page.getByTestId('prefab-name-control')).toBeVisible()
})

test('each click is its own press of Ctrl-Z', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()
  await placeByClicking(page)

  const canvas = await canvasBox(page)
  for (const across of [0.3, 0.5, 0.7]) {
    await page.mouse.click(canvas.x + canvas.width * across, canvas.y + canvas.height / 2)
  }
  await expect(rows(page)).toHaveCount(before + 3)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows(page)).toHaveCount(before + 2)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows(page)).toHaveCount(before + 1)
})

test('Esc stops it, and the next click selects again', async ({ page }) => {
  await openScene(page)
  await placeByClicking(page)

  const canvas = await canvasBox(page)
  await page.mouse.click(canvas.x + canvas.width * 0.3, canvas.y + canvas.height / 2)
  const placed = await rows(page).count()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('viewport-stamping')).toHaveCount(0)
  await expect(page.getByTestId('prefab-place-by-clicking')).toHaveAttribute('aria-pressed', 'false')

  await page.mouse.click(canvas.x + canvas.width * 0.3, canvas.y + canvas.height / 2)
  await expect(rows(page)).toHaveCount(placed)
})

/**
 * The mode belongs to the window, not to whatever the Inspector happens to be
 * showing — which is the whole reason it can be used twenty times.
 */
test('it keeps placing the same prefab after something else is selected', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()
  await placeByClicking(page)

  await row(page, 'Knight').click()
  await expect(page.getByTestId('entity-name-control')).toHaveValue('Knight')

  const canvas = await canvasBox(page)
  await page.mouse.click(canvas.x + canvas.width * 0.3, canvas.y + canvas.height / 2)

  await expect(rows(page)).toHaveCount(before + 1)
  // The click placed; it did not move the Knight and did not select what it made.
  await expect(page.getByTestId('entity-name-control')).toHaveValue('Knight')
})

test('what a click puts down lands on the snap', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()
  await setSnap(page, 16, 8)
  await placeByClicking(page)

  const canvas = await canvasBox(page)
  for (const across of [0.3, 0.5, 0.7]) {
    await page.mouse.click(canvas.x + canvas.width * across, canvas.y + canvas.height / 2)
  }

  const entities = await levelOnDisk(before + 3)
  for (const placed of entities.slice(before)) {
    expect((placed.transform.x - 8) % 16).toBe(0)
    expect((placed.transform.y - 8) % 16).toBe(0)
  }
})

/**
 * The one that catches an implementation that never learned about the camera.
 *
 * A click in the exact middle of the canvas is a click on the point the camera
 * is looking at, whatever the zoom — so the placement has to be that point,
 * snapped. Treating the click's screen pixels as level units passes nothing
 * here and everything elsewhere in the file.
 */
test('a click lands where the camera says it landed, at any zoom', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()
  await setSnap(page, 16, 8)
  await placeByClicking(page)

  const near = await focus(page)
  const first = await canvasBox(page)
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
  await expect(rows(page)).toHaveCount(before + 1)

  // Much closer, and looking somewhere else: the middle of the canvas is now a
  // different point in the level, and one screen pixel is a fraction of a unit.
  await page.getByTestId('scene-zoom-in').click()
  await expect.poll(() => cameraScale(page)).toBeGreaterThan(0)
  const closer = await settled(page)
  expect(closer).toBeGreaterThan(0)

  const far = await focus(page)
  const second = await canvasBox(page)
  await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2)

  const entities = await levelOnDisk(before + 2)
  const [firstPlaced, secondPlaced] = entities.slice(before)
  expectNear(firstPlaced?.transform, near)
  expectNear(secondPlaced?.transform, far)
})

/**
 * Landed on the grid, and on one of the two grid positions either side of where
 * the camera was looking.
 *
 * Not "on the snap of the focus exactly", which is what this asserted until the
 * day a stylesheet changed the panel's width. The middle of the canvas can land
 * exactly on the line between two grid positions — the fixture's camera sits at
 * x=160 with a grid of 8, 24, … 152, 168, so the middle is 160, precisely
 * halfway — and which side a click on a boundary falls to is then decided by
 * the canvas being an odd number of pixels wide. Rounding, not behaviour.
 *
 * What the test is actually for survives at this width: an implementation that
 * treated the click's screen pixels as level units would be out by hundreds of
 * units, not by one step.
 */
function expectNear(
  transform: { x: number; y: number } | undefined,
  point: { x: number; y: number },
): void {
  expect(transform).toBeDefined()
  const onGrid = (value: number): boolean => (value - 8) % 16 === 0
  expect(onGrid(transform?.x ?? 1), 'x is on the grid').toBe(true)
  expect(onGrid(transform?.y ?? 1), 'y is on the grid').toBe(true)
  expect(Math.abs((transform?.x ?? 0) - point.x)).toBeLessThanOrEqual(16)
  expect(Math.abs((transform?.y ?? 0) - point.y)).toBeLessThanOrEqual(16)
}
