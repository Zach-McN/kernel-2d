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

/**
 * Turn snapping on or off, and wait until the panel says it has taken it.
 *
 * The switch is pressed only when it is not already where it is wanted, so a
 * test that asks for the state it is in does not silently toggle it away.
 */
async function setSnapping(page: Page, on: boolean): Promise<void> {
  const showing = await page.getByTestId('scene-snap').getAttribute('data-snap-on')
  if (showing !== String(on)) await page.getByTestId('scene-snap-toggle').click()
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-on', String(on))
}

/**
 * A drag, optionally with `Ctrl` held for its middle.
 *
 * The key goes down *after* the button, which is not tidiness — a press with
 * `Ctrl` already held means "take this out of the selection" and starts no drag
 * at all, so a test that held it first would be testing nothing.
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
  if (options.ctrl === true) await page.keyboard.down('Control')
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
  await page.mouse.up()
  if (options.ctrl === true) await page.keyboard.up('Control')

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

/**
 * Zoom in until one screen pixel is a fraction of a level unit, which is the
 * only zoom at which a free position is even expressible — at 1x every drag
 * lands on a whole number whether anything snapped it or not.
 */
async function zoomInHard(page: Page): Promise<void> {
  await page.mouse.move(...(Object.values(await outlineCentre(page)) as [number, number]))
  for (let step = 0; step < 3; step += 1) await page.mouse.wheel(0, -120)
  await settled(page)
}

test('Ctrl places it anywhere while snapping is on', async ({ page }) => {
  await openScene(page)
  await setSnapping(page, true)
  await setSnap(page, 16, 8)
  await row(page, 'Slime').click()
  await zoomInHard(page)

  await dragFrom(page, await outlineCentre(page), 13, 0, { ctrl: true })

  expect(Number.isInteger((await position(page)).x)).toBe(false)
})

test('the switch turns the grid off, and a drag then lands anywhere', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 8)
  await row(page, 'Slime').click()
  await zoomInHard(page)

  await setSnapping(page, false)
  await dragFrom(page, await outlineCentre(page), 13, 0)

  expect(Number.isInteger((await position(page)).x)).toBe(false)
})

/**
 * The half that catches an inversion written backwards.
 *
 * `Ctrl` is not "place freely" — it is *the other thing*. An implementation that
 * kept the old meaning passes every other test in this file and fails only here,
 * silently: the entity lands where it would have landed anyway.
 */
test('Ctrl lands it on the grid while snapping is off', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 8)
  await row(page, 'Slime').click()
  await zoomInHard(page)
  await setSnapping(page, false)

  // Freely first, so the entity is provably off the grid before the key is held.
  await dragFrom(page, await outlineCentre(page), 13, 0)
  expect(Number.isInteger((await position(page)).x)).toBe(false)

  await dragFrom(page, await outlineCentre(page), 13, 0, { ctrl: true })

  const after = await position(page)
  expect((after.x - 8) % 16).toBe(0)
})

/** Switching off must not throw the grid away, or setting one up is two steps
 *  that undo each other. */
test('the spacing survives being switched off and on again', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 8)

  await setSnapping(page, false)
  await setSnapping(page, true)

  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-step', '16')
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-offset', '8')
})

/**
 * One asserting-nothing picture of the new control row, in both states, to look
 * at when somebody reports the switch as looking wrong (`editor-verification`
 * V31).
 */
test('leaves a picture of the snap controls, on and off', async ({ page }, testInfo) => {
  await openScene(page)
  await setSnap(page, 16, 8)

  await setSnapping(page, true)
  await page.getByTestId('scene-snap').screenshot({ path: testInfo.outputPath('snap-on.png') })

  await setSnapping(page, false)
  await page.getByTestId('scene-snap').screenshot({ path: testInfo.outputPath('snap-off.png') })
})

/** The interval offers a list and still takes anything typed over it. */
test('the interval has presets to pick from, and accepts a number that is not one', async ({ page }) => {
  await openScene(page)

  const presets = page.getByTestId('scene-snap-step-presets').locator('option')
  // Read as an attribute rather than through `HTMLOptionElement`, which the
  // test project's lib does not carry.
  expect(await presets.evaluateAll((options) => options.map((one) => one.getAttribute('value')))).toEqual([
    '1',
    '2',
    '4',
    '8',
    '16',
    '32',
    '64',
    '128',
  ])

  await setSnap(page, 24, 0)
  await row(page, 'Slime').click()
  const scale = await cameraScale(page)
  await dragFrom(page, await outlineCentre(page), 30 * scale, 0)

  expect((await position(page)).x % 24).toBe(0)
})

/**
 * The snap is a fact about this window, not about the level (`editor-ui` U8) —
 * the same rule the camera and the selection follow. A reload is the observable
 * form of it: nothing anywhere on disk remembers.
 */
test('the snap is not saved into the level, and a reload puts it back', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 8)
  // The switch is part of the same window state, so it has to be moved off its
  // default too — otherwise this only proves the two numbers reset.
  await setSnapping(page, false)

  await page.reload()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
  await openScene(page)

  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-on', 'true')
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-step', '1')
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-offset', '0')
})

// --- acceptance: the grid you can see ---------------------------------------

/**
 * The grid is drawn from the renderer's own report, so there is no line to count
 * from out here — what it *is* is published as numbers on the mark itself. That
 * is the whole of what these read.
 */
const grid = (page: Page): Locator => page.getByTestId('scene-grid')

test('the grid is drawn while snapping is on, and goes when the switch goes off', async ({ page }) => {
  await openScene(page)
  await setSnap(page, 16, 0)

  await setSnapping(page, true)
  await expect(grid(page)).toHaveAttribute('data-grid-step', '16')

  await setSnapping(page, false)
  await expect(grid(page)).toHaveCount(0)
})

test('the cells are the interval, so the grid changes size with the number typed', async ({ page }) => {
  await openScene(page)
  await setSnapping(page, true)
  const scale = await cameraScale(page)

  await setSnap(page, 16, 0)
  expect(Number(await grid(page).getAttribute('data-grid-cell'))).toBeCloseTo(16 * scale, 3)

  await setSnap(page, 32, 0)
  expect(Number(await grid(page).getAttribute('data-grid-cell'))).toBeCloseTo(32 * scale, 3)
})

/**
 * A grid finer than the eye can separate is not a grid, it is a grey wash over
 * the level — so nothing is drawn, and the way back is the same control that got
 * there. Worth an acceptance because "I turned snapping on and saw nothing" is
 * otherwise indistinguishable from the feature being broken.
 */
test('a grid too fine to see is not drawn, and a wider interval brings it back', async ({ page }) => {
  await openScene(page)
  await setSnapping(page, true)

  await setSnap(page, 0.001, 0)
  await expect(grid(page)).toHaveCount(0)

  await setSnap(page, 128, 0)
  await expect(grid(page)).toHaveAttribute('data-grid-step', '128')
})

test('leaves a picture of the level on its grid', async ({ page }, testInfo) => {
  await openScene(page)
  await setSnapping(page, true)
  await setSnap(page, 16, 8)
  await expect(grid(page)).toBeVisible()

  await page.getByTestId('viewport-stage').screenshot({ path: testInfo.outputPath('scene-grid.png') })
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
  // Panned as well as zoomed, because a click on the very cell that already
  // holds one is declined (a click is a stroke of one), and zooming about the
  // middle would leave the middle on the same cell.
  await page.getByTestId('scene-zoom-in').click()
  await expect.poll(() => cameraScale(page)).toBeGreaterThan(0)
  const closer = await settled(page)
  expect(closer).toBeGreaterThan(0)
  await page.keyboard.down('Space')
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(first.x + first.width / 2 + 90, first.y + first.height / 2 + 50, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await settled(page)

  const far = await focus(page)
  expect(far).not.toEqual(near)
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

// --- acceptance: painting by dragging ---------------------------------------

/**
 * A stroke: press while the mode is on, and drag. One copy per grid cell the
 * pointer crosses, one press of Ctrl-Z for the lot. Everything below is stated
 * in cells — a drag of `n` cells' worth of screen pixels is `n` more entities —
 * so it holds at whatever zoom the scene opened at.
 */
const STEP = 16

/** How many screen pixels one grid cell is, at the current zoom. */
async function cellPixels(page: Page): Promise<number> {
  return STEP * (await cameraScale(page))
}

/** Arm the mode on a 16-from-8 grid, and answer where a stroke can start. */
async function readyToPaint(page: Page): Promise<{ x: number; y: number }> {
  await openScene(page)
  await setSnapping(page, true)
  await setSnap(page, STEP, 8)
  await placeByClicking(page)
  const canvas = await canvasBox(page)
  return { x: canvas.x + canvas.width * 0.25, y: canvas.y + canvas.height * 0.5 }
}

test('a drag across five cells with the snap on places six, one in each cell', async ({ page }) => {
  const from = await readyToPaint(page)
  const before = await rows(page).count()
  const cell = await cellPixels(page)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 5 * cell, from.y, { steps: 10 })
  await page.mouse.up()

  await expect(rows(page)).toHaveCount(before + 6)
  const level = await levelOnDisk(before + 6)
  const placed = level.slice(-6)
  // Six different cells, every one on the grid, all in one row.
  expect(new Set(placed.map((entity) => `${entity.transform.x},${entity.transform.y}`)).size).toBe(6)
  for (const entity of placed) {
    expect(Math.abs((entity.transform.x - 8) % STEP)).toBe(0)
    expect(entity.transform.y).toBe(placed[0]?.transform.y)
  }
})

test('one Ctrl-Z takes the whole stroke back, and one Ctrl-Y puts it all back', async ({ page }) => {
  const from = await readyToPaint(page)
  const before = await rows(page).count()
  const cell = await cellPixels(page)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 4 * cell, from.y, { steps: 6 })
  await page.mouse.up()
  await expect(rows(page)).toHaveCount(before + 5)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows(page)).toHaveCount(before)
  await page.keyboard.press('ControlOrMeta+y')
  await expect(rows(page)).toHaveCount(before + 5)
  // And a stroke is one step however slowly it was drawn: undo again is the
  // whole thing, not the last cell.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows(page)).toHaveCount(before)
})

test('a fast sweep fills the cells in between, with no gaps', async ({ page }) => {
  const from = await readyToPaint(page)
  const before = await rows(page).count()
  const cell = await cellPixels(page)

  // One sample at each end and nothing between: every cell along the way is
  // still stamped.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8 * cell, from.y, { steps: 1 })
  await page.mouse.up()

  await expect(rows(page)).toHaveCount(before + 9)
})

test('painting over the same row again adds nothing, and a slow stroke does not double a cell', async ({
  page,
}) => {
  const from = await readyToPaint(page)
  const before = await rows(page).count()
  const cell = await cellPixels(page)

  // Back and forth within one stroke: a cell crossed twice gets one copy.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 3 * cell, from.y, { steps: 6 })
  await page.mouse.move(from.x, from.y, { steps: 6 })
  await page.mouse.up()
  await expect(rows(page)).toHaveCount(before + 4)

  // The same row again, as a second stroke: nothing new, and nothing to undo but
  // the first stroke.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 3 * cell, from.y, { steps: 6 })
  await page.mouse.up()
  await expect(rows(page)).toHaveCount(before + 4)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows(page)).toHaveCount(before)
})

test('the Outliner fills as the stroke goes, not only when the button comes up', async ({ page }) => {
  const from = await readyToPaint(page)
  const before = await rows(page).count()
  const cell = await cellPixels(page)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await expect(rows(page)).toHaveCount(before + 1)
  await page.mouse.move(from.x + 2 * cell, from.y, { steps: 4 })
  await expect(rows(page)).toHaveCount(before + 3)
  await page.mouse.up()
  await expect(rows(page)).toHaveCount(before + 3)
})

test('Esc mid-stroke ends it and keeps what was placed, as one step', async ({ page }) => {
  const from = await readyToPaint(page)
  const before = await rows(page).count()
  const cell = await cellPixels(page)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 2 * cell, from.y, { steps: 4 })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('viewport-stamping')).toHaveCount(0)
  // Still held down and moving: nothing more is placed.
  await page.mouse.move(from.x + 5 * cell, from.y, { steps: 4 })
  await page.mouse.up()

  await expect(rows(page)).toHaveCount(before + 3)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows(page)).toHaveCount(before)
})

test('with the snap off a press places one, and a drag is answered with a sentence', async ({ page }) => {
  await openScene(page)
  await setSnapping(page, false)
  await placeByClicking(page)
  const canvas = await canvasBox(page)
  const from = { x: canvas.x + canvas.width * 0.25, y: canvas.y + canvas.height * 0.5 }
  const before = await rows(page).count()

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 120, from.y, { steps: 6 })
  await page.mouse.up()

  await expect(rows(page)).toHaveCount(before + 1)
  await expect(page.getByTestId('viewport-stamping-note')).toContainText('Turn Snap on to paint')
  // The sentence is about that attempt; the next press on the grid clears it.
  await setSnapping(page, true)
  await page.mouse.click(from.x, from.y + 60)
  await expect(page.getByTestId('viewport-stamping-note')).toHaveCount(0)
})

test('a picture of a painted row', async ({ page }, testInfo) => {
  const from = await readyToPaint(page)
  const cell = await cellPixels(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 6 * cell, from.y, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByTestId('viewport-stamping')).toContainText('drag to paint')
  await page.getByTestId('viewport-panel').screenshot({ path: testInfo.outputPath('paint-stroke.png') })
})
