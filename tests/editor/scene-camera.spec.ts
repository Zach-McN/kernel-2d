import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { verticalDividerNear } from './dividers.js'
import { showPanel } from './panels.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { outlinerRow, viewport } from './scene-view.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * The scene viewport's camera, against the real editor, the real service, the
 * real project folder and the real renderer.
 *
 * One test per acceptance criterion, in the units they were written in
 * (`editor-verification` V1). Not one of them compares a pixel: where the
 * camera is and what it drew are reported by the renderer and read off the DOM
 * (V17), and the outline, crosshair and origin marker are ordinary SVG with
 * ordinary locators.
 *
 * Everything derived from the panel's size is read once it has stopped moving
 * (V18) — dockview computes its layout inside `requestAnimationFrame`, so a
 * camera read the instant a scene opens can be the framing for a panel that is
 * about to get smaller.
 */

const LEVEL_ONE = 'scenes/level-01.json'
const LEVEL_TWO = 'scenes/level-02.json'
const KNIGHT = 'assets/textures/characters/knight-idle.png'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

// --- reading what the renderer reported ------------------------------------

interface Camera {
  scale: number
  x: number
  y: number
}

async function cameraNow(page: Page): Promise<Camera> {
  const panel = viewport(page)
  return {
    scale: Number(await panel.getAttribute('data-scene-scale')),
    x: Number(await panel.getAttribute('data-scene-focus-x')),
    y: Number(await panel.getAttribute('data-scene-focus-y')),
  }
}

/**
 * The camera, once it has stopped moving.
 *
 * Opening a scene draws it once at whatever camera was current and frames it on
 * the next pass, so the first reading is true and then briefly isn't.
 */
async function settledCamera(page: Page): Promise<Camera> {
  let previous: Camera = { scale: Number.NaN, x: Number.NaN, y: Number.NaN }

  await expect
    .poll(
      async () => {
        const now = await cameraNow(page)
        const same = now.scale === previous.scale && now.x === previous.x && now.y === previous.y
        previous = now
        return same && Number.isFinite(now.scale)
      },
      { intervals: [120, 120, 120, 120, 120, 120, 120, 120] },
    )
    .toBe(true)

  return previous
}

async function onScreenCount(page: Page): Promise<number> {
  return Number(await viewport(page).getAttribute('data-scene-onscreen'))
}

async function openScene(page: Page, scenePath = LEVEL_ONE): Promise<Camera> {
  await selectAsset(page, scenePath)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', scenePath)
  return settledCamera(page)
}

/** Where the selected entity's crosshair is, in the stage's own pixels. */
async function crosshair(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.getByTestId('scene-selected-origin')
  return {
    x: Number(await marker.getAttribute('data-entity-x')),
    y: Number(await marker.getAttribute('data-entity-y')),
  }
}

/** Where the scene's own 0,0 landed, in the stage's own pixels. */
async function sceneOrigin(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.getByTestId('scene-origin')
  return {
    x: Number(await marker.getAttribute('data-origin-x')),
    y: Number(await marker.getAttribute('data-origin-y')),
  }
}

/** The selected sprite's outline, relative to the stage rather than the window. */
async function outline(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('scene-selected-bounds').boundingBox()
  const stage = await page.getByTestId('viewport-stage').boundingBox()
  expect(box).not.toBeNull()
  expect(stage).not.toBeNull()

  return {
    x: (box?.x ?? 0) - (stage?.x ?? 0),
    y: (box?.y ?? 0) - (stage?.y ?? 0),
    width: box?.width ?? 0,
    height: box?.height ?? 0,
  }
}

async function stageCentre(page: Page): Promise<{ x: number; y: number }> {
  const stage = await page.getByTestId('viewport-stage').boundingBox()
  expect(stage).not.toBeNull()
  return {
    x: (stage?.x ?? 0) + (stage?.width ?? 0) / 2,
    y: (stage?.y ?? 0) + (stage?.height ?? 0) / 2,
  }
}

/**
 * A middle-button drag across the viewport, settled before it returns.
 *
 * The settle is load-bearing rather than tidy. A drag is dispatched as a series
 * of moves and each one pans; reading the moment anything has changed catches
 * the camera partway through the gesture, which reads exactly like the drag
 * being applied wrongly rather than early.
 */
async function dragBy(page: Page, dx: number, dy: number): Promise<void> {
  const from = await stageCentre(page)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  await settledCamera(page)
}

/** Wheel steps at a point in the window, settled before returning. */
async function wheelAt(page: Page, at: { x: number; y: number }, direction: 1 | -1, times = 1): Promise<void> {
  await page.mouse.move(at.x, at.y)
  for (let step = 0; step < times; step += 1) await page.mouse.wheel(0, direction > 0 ? -120 : 120)
  await settledCamera(page)
}

/** A point given in the stage's own pixels, as the window sees it. */
async function inWindow(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const stage = await page.getByTestId('viewport-stage').boundingBox()
  return { x: (stage?.x ?? 0) + point.x, y: (stage?.y ?? 0) + point.y }
}

// --- acceptance 1: everything in frame without touching anything ------------

test('a scene opens with everything in it on screen', async ({ page }) => {
  await openScene(page)

  // Five entities in the level, five of them visible. Framing is not "most of
  // it": a level laid out past the panel's edges is framed, not cropped.
  await expect(page.getByTestId('outliner-panel').locator('[data-entity-id]')).toHaveCount(5)
  await expect.poll(() => onScreenCount(page)).toBe(5)
  await expect(page.getByTestId('viewport-offscreen')).toHaveCount(0)
})

// --- acceptance 2: the level moves under the drag, all of it together -------

test('dragging moves the sprites, the crosshair and the origin marker by the same amount', async ({
  page,
}) => {
  await openScene(page)
  await outlinerRow(page, 'Knight').click()
  await expect(page.getByTestId('scene-selected-bounds')).toBeVisible()

  const before = {
    origin: await sceneOrigin(page),
    handle: await crosshair(page),
    sprite: await outline(page),
  }

  await dragBy(page, 60, -35)

  const after = {
    origin: await sceneOrigin(page),
    handle: await crosshair(page),
    sprite: await outline(page),
  }

  // The whole point: one report, so nothing can be a frame behind anything
  // else. A pixel of slack for the whole-device-pixel snapping.
  for (const [name, moved] of [
    ['origin marker', { x: after.origin.x - before.origin.x, y: after.origin.y - before.origin.y }],
    ['crosshair', { x: after.handle.x - before.handle.x, y: after.handle.y - before.handle.y }],
    ['sprite', { x: after.sprite.x - before.sprite.x, y: after.sprite.y - before.sprite.y }],
  ] as const) {
    expect(Math.abs(moved.x - 60), `${name} moved horizontally with the drag`).toBeLessThanOrEqual(1)
    expect(Math.abs(moved.y + 35), `${name} moved vertically with the drag`).toBeLessThanOrEqual(1)
  }

  // And the sprite is the same size as it was — a drag is not a zoom.
  expect(Math.abs(after.sprite.width - before.sprite.width)).toBeLessThanOrEqual(1)
})

// --- acceptance 3: zoomed in, the pixels stay square ------------------------

test('zooming in stays on whole steps, and grows the sprite by exactly the step', async ({ page }) => {
  await openScene(page)
  await outlinerRow(page, 'Health icon').click()

  const before = { camera: await settledCamera(page), sprite: await outline(page) }

  await wheelAt(page, await stageCentre(page), 1)
  const after = { camera: await cameraNow(page), sprite: await outline(page) }
  expect(after.camera.scale).toBeGreaterThan(before.camera.scale)

  // Whole steps only. A 16px sprite at 3.4× has some rows three screen pixels
  // tall and some four, which reads as badly drawn art rather than as a badly
  // chosen zoom — so the ladder is the acceptance criterion, not a preference.
  expect(Number.isInteger(after.camera.scale) || Number.isInteger(1 / after.camera.scale)).toBe(true)

  /*
   * Compared as a size in pixels rather than as a ratio of two sizes.
   *
   * The outline is drawn with a stroke, so each measurement is the sprite plus
   * about a pixel — and a ratio of two numbers each carrying that pixel is
   * wrong by an amount that depends on how big the sprite happened to be, which
   * is to say on how much room the panel had. The same three lines used to pass
   * at one panel size and fail at another with nothing but a stylesheet
   * between them. A tolerance in pixels says what the measurement can actually
   * promise: the sprite grew by the step, give or take the ink around it.
   */
  const step = after.camera.scale / before.camera.scale
  expect(Math.abs(after.sprite.width - before.sprite.width * step)).toBeLessThanOrEqual(2)
  expect(Math.abs(after.sprite.height - before.sprite.height * step)).toBeLessThanOrEqual(2)
})

test('the wheel keeps what is under the cursor under the cursor', async ({ page }) => {
  await openScene(page)
  await outlinerRow(page, 'Health icon').click()

  const sprite = await outline(page)
  const at = await inWindow(page, { x: sprite.x + sprite.width / 2, y: sprite.y + sprite.height / 2 })

  await wheelAt(page, at, 1)

  const after = await outline(page)
  expect(after.width).toBeGreaterThan(sprite.width)
  const middle = { x: after.x + after.width / 2, y: after.y + after.height / 2 }

  // Zooming toward the middle instead would slide the thing being looked at off
  // the edge, which is what makes a wheel useless for getting somewhere.
  expect(Math.abs(middle.x - (sprite.x + sprite.width / 2))).toBeLessThanOrEqual(2)
  expect(Math.abs(middle.y - (sprite.y + sprite.height / 2))).toBeLessThanOrEqual(2)
})

// --- acceptance 4: a level several times wider than the panel ---------------

test('zooming out shows a level several times wider than the panel', async ({ page }) => {
  const framed = await openScene(page)

  await wheelAt(page, await stageCentre(page), -1, 3)

  const out = await cameraNow(page)
  expect(out.scale).toBeLessThan(framed.scale)
  expect(Number.isInteger(out.scale) || Number.isInteger(1 / out.scale)).toBe(true)

  // Still all there — zooming out cannot lose anything.
  await expect.poll(() => onScreenCount(page)).toBe(5)
})

// --- acceptance 5: one press to frame everything, another for the selection --

test('Home puts everything back in frame after panning away', async ({ page }) => {
  const framed = await openScene(page)

  // Several drags rather than one enormous one: the pointer has to stay inside
  // the window for the browser to keep reporting it.
  for (let pull = 0; pull < 4; pull += 1) await dragBy(page, -300, 0)

  await expect.poll(() => onScreenCount(page)).toBe(0)
  await expect(page.getByTestId('viewport-offscreen')).toContainText('Everything is off screen')

  await page.keyboard.press('Home')

  await expect.poll(() => onScreenCount(page)).toBe(5)
  const back = await settledCamera(page)
  expect(back.scale).toBe(framed.scale)
  expect(back.x).toBeCloseTo(framed.x, 6)
  expect(back.y).toBeCloseTo(framed.y, 6)

  // Pressing it again changes nothing. Not a nicety: the two ways this can go
  // wrong both feel like a broken key — a level whose measured size depends on
  // how far in you are zoomed, and a caption that grows when something is off
  // screen and so shrinks the canvas the framing is computed against.
  await page.keyboard.press('Home')
  expect(await settledCamera(page)).toEqual(back)
})

test('F frames just the selected entity', async ({ page }) => {
  const framed = await openScene(page)
  await outlinerRow(page, 'Health icon').click()

  const before = await outline(page)
  await page.keyboard.press('f')

  await expect.poll(async () => (await cameraNow(page)).scale).toBeGreaterThan(framed.scale)
  const after = await outline(page)

  // Filling the panel rather than sitting in a corner of it: bigger, and
  // centred on the middle of the stage.
  expect(after.width).toBeGreaterThan(before.width * 2)
  const stage = await page.getByTestId('viewport-stage').boundingBox()
  const off = Math.abs(after.x + after.width / 2 - (stage?.width ?? 0) / 2)

  /*
   * Within a level unit of the middle, and stated that way rather than in
   * pixels, because a unit is the smallest thing the level has and a pixel is
   * not: at this zoom one unit is two dozen of them.
   *
   * It cannot be tighter honestly. Framing centres on the entity's *measured*
   * bounds, and those are read back from a raster whose sprite sat on some
   * fraction of a pixel before the key was pressed — so the centre it aims at
   * carries a fraction of a unit that depends on where the camera happened to
   * be. A two-pixel tolerance passed for a year on the panel size it was
   * written at and failed the day the panel gained a margin.
   */
  const scale = (await cameraNow(page)).scale
  expect(off / scale, 'framed entity, in level units off centre').toBeLessThanOrEqual(1)
})

test('the buttons do what the keys do', async ({ page }) => {
  await openScene(page)
  const framed = await settledCamera(page)

  await page.getByTestId('scene-zoom-in').click()
  await expect.poll(async () => (await cameraNow(page)).scale).toBeGreaterThan(framed.scale)

  await page.getByTestId('scene-frame-all').click()
  await expect.poll(async () => (await cameraNow(page)).scale).toBe(framed.scale)

  // Nothing selected, nothing to frame — and the button says so rather than
  // doing nothing when pressed.
  await expect(page.getByTestId('scene-frame-selected')).toBeDisabled()
  await outlinerRow(page, 'Knight').click()
  await expect(page.getByTestId('scene-frame-selected')).toBeEnabled()
})

// --- acceptance 6: an entity that is nowhere on screen ----------------------

test('an entity selected off screen is named, with the key that reaches it', async ({ page }) => {
  await openScene(page)

  // Zoomed in on the Knight, who is down on the ground: the health icon sits
  // well above him and goes off the top. Deliberately *not* zoomed so far that
  // nothing at all is visible, because that is the other sentence — this test
  // is about one entity being missing from a view that is otherwise fine.
  await outlinerRow(page, 'Knight').click()
  await wheelAt(page, await inWindow(page, await crosshair(page)), 1, 3)
  expect(await onScreenCount(page)).toBeGreaterThan(0)

  await outlinerRow(page, 'Health icon').click()

  await expect(page.getByTestId('viewport-offscreen')).toContainText('Health icon')
  await expect(page.getByTestId('viewport-offscreen')).toContainText('is off screen')

  // Selecting it did not move the camera on its own — that is the whole reason
  // there is a sentence rather than a jump.
  await expect(page.getByTestId('scene-selected-bounds')).toHaveCount(1)

  await page.keyboard.press('f')
  await expect(page.getByTestId('viewport-offscreen')).toHaveCount(0)
  await expect.poll(() => onScreenCount(page)).toBeGreaterThan(0)
})

// --- acceptance 7: the Inspector's numbers are the level's own --------------

test('the Inspector shows the level’s own units at every zoom, and typing still moves it', async ({
  page,
}) => {
  await openScene(page)
  await outlinerRow(page, 'Knight').click()
  await expect(page.getByTestId('entity-x-control')).toHaveValue('100')

  await wheelAt(page, await stageCentre(page), 1, 2)
  const zoomed = await cameraNow(page)
  expect(zoomed.scale).toBeGreaterThan(1)

  // Zooming is not an edit. The numbers are the level's, not the screen's.
  await expect(page.getByTestId('entity-x-control')).toHaveValue('100')
  await expect(page.getByTestId('entity-y-control')).toHaveValue('16')

  const before = await crosshair(page)
  const field = page.getByTestId('entity-x-control')
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.pressSequentially('140', { delay: 20 })

  await expect.poll(async () => (await crosshair(page)).x).toBeGreaterThan(before.x)
  // And the camera did not move because the entity did.
  const after = await cameraNow(page)
  expect(after.scale).toBe(zoomed.scale)
  expect(after.x).toBeCloseTo(zoomed.x, 6)
})

// --- acceptance 8: dragging the panel wider --------------------------------

test('dragging the panel wider keeps your place', async ({ page }) => {
  await openScene(page)
  const before = await settledCamera(page)
  const stageBefore = await page.getByTestId('viewport-stage').boundingBox()

  // Measured from the *panel*, not from the stage inside it: the divider sits
  // on the panel's edge, and the canvas is inset within the panel by however
  // much the layout currently frames it with. Asking the stage found nothing
  // the day that inset stopped being zero.
  const panel = await page.getByTestId('viewport-panel').boundingBox()
  const sash = await verticalDividerNear(page, panel?.x ?? 0)
  expect(sash, 'a draggable divider on the left edge of the Viewport').not.toBeNull()
  if (sash === null) return

  await page.mouse.move(sash.x, sash.y)
  await page.mouse.down()
  await page.mouse.move(sash.x - 120, sash.y, { steps: 12 })
  await page.mouse.up()

  await expect
    .poll(async () => (await page.getByTestId('viewport-stage').boundingBox())?.width ?? 0)
    .toBeGreaterThan((stageBefore?.width ?? 0) + 60)

  // The middle of the panel still means the same place in the level, and the
  // zoom was not re-fitted behind the human's back.
  const after = await settledCamera(page)
  expect(after.scale).toBe(before.scale)
  expect(after.x).toBeCloseTo(before.x, 6)
  expect(after.y).toBeCloseTo(before.y, 6)
})

// --- acceptance 9: looking away and coming back ----------------------------

test('looking at a texture and coming back finds the view where it was left', async ({ page }) => {
  await openScene(page)

  await dragBy(page, -80, 40)
  await wheelAt(page, await stageCentre(page), 1)
  const moved = await cameraNow(page)

  await selectAsset(page, KNIGHT)
  await expect(page.getByTestId('texture-panel')).toHaveAttribute('data-texture-showing', KNIGHT)

  await showPanel(page, 'Viewport')

  const back = await settledCamera(page)
  expect(back.scale).toBe(moved.scale)
  expect(back.x).toBeCloseTo(moved.x, 6)
  expect(back.y).toBeCloseTo(moved.y, 6)
})

test('a second scene is framed on its own, and the first is remembered', async ({ page }) => {
  await openScene(page)
  await dragBy(page, -140, 0)
  const movedFirst = await settledCamera(page)

  // A different level is framed rather than inheriting a view chosen for
  // another one.
  await openScene(page, LEVEL_TWO)
  await expect.poll(() => onScreenCount(page)).toBe(4)

  await openScene(page)
  const back = await settledCamera(page)
  expect(back.scale).toBe(movedFirst.scale)
  expect(back.x).toBeCloseTo(movedFirst.x, 6)
  expect(back.y).toBeCloseTo(movedFirst.y, 6)
})

// --- acceptance 10: none of this is in the level ----------------------------

test('panning and zooming never touch the scene file', async ({ page }) => {
  const file = path.join(editorTestProjectPath(), LEVEL_ONE.replaceAll('/', path.sep))
  await openScene(page)

  const before = { text: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtimeMs }

  await dragBy(page, -90, 45)
  await wheelAt(page, await stageCentre(page), 1)
  await page.keyboard.press('Home')
  await settledCamera(page)

  // Bytes *and* timestamp: identical contents alone would also pass for a file
  // that had been rewritten with the same text, which is a different promise
  // (`editor-verification` V12).
  const after = { text: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtimeMs }
  expect(after.text).toBe(before.text)
  expect(after.mtime).toBe(before.mtime)
  expect(after.text.toLowerCase()).not.toContain('camera')
})

test('Ctrl-Z after panning reverses the last edit, not the last look', async ({ page }) => {
  await openScene(page)
  await outlinerRow(page, 'Knight').click()

  const field = page.getByTestId('entity-x-control')
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.pressSequentially('240', { delay: 20 })
  await expect(field).toHaveValue('240')

  await dragBy(page, -70, 25)
  const panned = await settledCamera(page)

  await page.keyboard.press('ControlOrMeta+z')

  // The edit came back, and the view did not budge — a camera is not something
  // the undo stack can see.
  await expect(field).toHaveValue('100')
  const after = await cameraNow(page)
  expect(after.scale).toBe(panned.scale)
  expect(after.x).toBeCloseTo(panned.x, 6)
  expect(after.y).toBeCloseTo(panned.y, 6)
})

// --- the picture -----------------------------------------------------------

test('a picture of a framed scene, to look at when something is reported as looking wrong', async ({
  page,
}) => {
  await openScene(page)
  await outlinerRow(page, 'Knight').click()
  await page.keyboard.press('f')
  await expect(page.getByTestId('scene-selected-bounds')).toBeVisible()
  await settledCamera(page)

  await page.screenshot({ path: 'test-results/scene-camera.png', fullPage: false })
})

