import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { openFolder, selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Dragging a file out of the Assets panel and letting it go over the level.
 *
 * The two acceptances are at the top: a prefab dropped on the picture becomes an
 * instance of it, and a texture dropped on the picture becomes an entity that
 * draws it. Everything else is the surroundings — where it lands, what a file
 * that cannot be placed says, and Ctrl-Z.
 *
 * Position is asserted in the level's own units against the camera's own
 * reading, never in pixels (`editor-verification` V1): the whole point of a drop
 * is that it lands where it was let go, and a pixel comparison would be checking
 * the renderer instead.
 */

const LEVEL_ONE = 'scenes/level-01.json'
const SLIME_PREFAB = 'prefabs/enemy-slime.json'
const HEART = 'assets/textures/ui/icon-heart.png'
const JUMP = 'assets/audio/sfx/jump.wav'

/** The human's budget, from "within a second". */
const WITHIN_A_SECOND = 1_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

// --- acceptance ------------------------------------------------------------

test('a prefab dropped on the level becomes an instance of it', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()

  await dropOnScene(page, SLIME_PREFAB, middleOfCanvas)

  await expect(rows(page)).toHaveCount(before + 1)
  await expect(row(page, 'Slime')).toBeVisible()

  // By reference, exactly as every other way of placing one writes it — the
  // property the whole prefab feature rests on.
  const placed = (await levelOnDisk(before + 1)).at(-1)
  expect(placed?.components).toEqual({ prefab: { source: { id: expect.any(String), path: SLIME_PREFAB } } })
})

test('a texture dropped on the level becomes an entity that draws it', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()

  await dropOnScene(page, HEART, middleOfCanvas)

  await expect(rows(page)).toHaveCount(before + 1)
  // Named after the file, which is the only name anybody could have meant.
  await expect(row(page, 'icon-heart')).toBeVisible()

  // A whole D5 reference: the id as well as the path, so it survives a rename.
  const placed = (await levelOnDisk(before + 1)).at(-1)
  expect(placed?.components).toEqual({ sprite: { texture: { id: expect.any(String), path: HEART } } })

  // And the renderer really drew it, rather than the level merely holding a row.
  await expect
    .poll(async () => Number(await viewport(page).getAttribute('data-scene-drawn')), {
      timeout: WITHIN_A_SECOND,
    })
    .toBeGreaterThan(0)
})

// --- where it lands --------------------------------------------------------

test('it lands where it was let go, not in the middle of the level', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()

  const box = await canvasBox(page)
  // A quarter of the way in, so the drop is nowhere near either the camera's
  // focus or the level's origin — the two places a wrong answer would land.
  const spot = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 }
  await dropOnScene(page, SLIME_PREFAB, async () => spot)

  const scale = Number(await viewport(page).getAttribute('data-scene-scale'))
  const focus = {
    x: Number(await viewport(page).getAttribute('data-scene-focus-x')),
    y: Number(await viewport(page).getAttribute('data-scene-focus-y')),
  }
  // The same inversion the editor makes: the camera looks at `focus` in the
  // middle of the canvas, y counts up in the level and down on the screen.
  const wanted = {
    x: focus.x + (spot.x - (box.x + box.width / 2)) / scale,
    y: focus.y - (spot.y - (box.y + box.height / 2)) / scale,
  }

  /*
   * Within a unit rather than exactly, and the reason is the same one the
   * click-placing tests carry: the editor inverts through the camera the
   * renderer *drew* with, which differs from the one it was asked for by the
   * sub-pixel nudge that keeps pixel art crisp, and the default snap then rounds
   * the answer to a whole unit. What this test is for survives that easily — an
   * implementation that dropped at the camera's focus, or at the level's origin,
   * is out by hundreds.
   */
  const placed = (await levelOnDisk(before + 1)).at(-1)
  expect(Math.abs((placed?.transform.x ?? 0) - wanted.x), 'x is where it was let go').toBeLessThanOrEqual(1.5)
  expect(Math.abs((placed?.transform.y ?? 0) - wanted.y), 'y is where it was let go').toBeLessThanOrEqual(1.5)
  // And not simply the middle of the view, which is where a drop that ignored
  // the pointer would land.
  expect(Math.abs((placed?.transform.x ?? 0) - focus.x)).toBeGreaterThan(10)
})

test('it lands on the snap, like everything else that is placed', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()

  await page.getByTestId('scene-snap-step').fill('16')
  await expect(page.getByTestId('scene-snap')).toHaveAttribute('data-snap-step', '16')

  await dropOnScene(page, SLIME_PREFAB, middleOfCanvas)

  const placed = (await levelOnDisk(before + 1)).at(-1)
  expect((placed?.transform.x ?? 1) % 16).toBe(0)
  expect((placed?.transform.y ?? 1) % 16).toBe(0)
})

// --- what it says ----------------------------------------------------------

test('the picture says what it is about to place while the file is over it', async ({ page }) => {
  await openScene(page)

  await carry(page, SLIME_PREFAB, middleOfCanvas)

  await expect(page.getByTestId('viewport-stage')).toHaveAttribute('data-dropping', 'true')
  await expect(page.getByTestId('viewport-dropping')).toContainText('enemy-slime.json')
})

test('a file that cannot be placed says what it is, and adds nothing', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()

  await openFolder(page, 'scenes')
  await dropOnScene(page, 'scenes/level-02.json', middleOfCanvas)

  await expect(page.getByTestId('viewport-drop-refused')).toContainText('is a level')
  await expect(rows(page)).toHaveCount(before)
})

test('a sound says so too, rather than being refused silently', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()

  await dropOnScene(page, JUMP, middleOfCanvas)

  await expect(page.getByTestId('viewport-drop-refused')).toContainText('is a sound')
  await expect(rows(page)).toHaveCount(before)
})

// --- the surroundings ------------------------------------------------------

test('one drop is one press of Ctrl-Z', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()

  await dropOnScene(page, SLIME_PREFAB, middleOfCanvas)
  await expect(rows(page)).toHaveCount(before + 1)

  await page.keyboard.press('Control+z')

  await expect(rows(page)).toHaveCount(before)
  expect(await levelOnDisk(before)).toHaveLength(before)
})

test('it works from the icon view as well as from the tree', async ({ page }) => {
  await openScene(page)
  const before = await rows(page).count()

  await page.getByTestId('assets-settings').click()
  await page.getByTestId('assets-view-icons').click()
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'icons')

  // Opening the level walked the tree through `scenes`, which took the grid in
  // there with it — the two halves agree about where you are (`editor-ui` U34).
  await page.locator('[data-crumb-path=""]').click()

  const tile = page.getByTestId('assets-icons').locator('[data-asset-path="prefabs"]')
  await tile.dblclick()
  const slime = page.getByTestId('assets-icons').locator(`[data-asset-path="${SLIME_PREFAB}"]`)
  await expect(slime).toBeVisible()

  await slime.dragTo(page.getByTestId('viewport-stage'))

  await expect(rows(page)).toHaveCount(before + 1)
})

test('a folder cannot be picked up at all', async ({ page }) => {
  await expect(page.locator('[data-asset-path="prefabs"]')).toHaveAttribute('draggable', 'false')
  await openFolder(page, 'prefabs')
  await expect(page.locator(`[data-asset-path="${SLIME_PREFAB}"]`)).toHaveAttribute('draggable', 'true')
})

test('leaves a picture of a file hovering over the level', async ({ page }, testInfo) => {
  await openScene(page)
  await carry(page, SLIME_PREFAB, middleOfCanvas)
  await page.screenshot({ path: testInfo.outputPath('drag-from-assets.png') })
})

// --- driving ---------------------------------------------------------------

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')
const rows = (page: Page): Locator => page.getByTestId('outliner-panel').locator('[data-entity-id]')
const row = (page: Page, name: string): Locator => rows(page).filter({ hasText: name }).first()

async function openScene(page: Page): Promise<void> {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await settled(page)
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

async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('viewport-stage').locator('canvas').boundingBox()
  expect(box).not.toBeNull()
  return box ?? { x: 0, y: 0, width: 0, height: 0 }
}

async function middleOfCanvas(page: Page): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

type Aim = (page: Page) => Promise<{ x: number; y: number }>

/**
 * Picking a file up and holding it over the picture, without letting go.
 *
 * Driven by hand rather than by `dragTo`, because half of these tests are about
 * what the editor says *during* the drag, and `dragTo` starts and finishes one
 * in a single call. The file is revealed in the tree first: a row inside a shut
 * folder cannot be picked up.
 */
async function carry(page: Page, assetPath: string, aim: Aim): Promise<void> {
  const segments = assetPath.split('/')
  for (let depth = 1; depth < segments.length; depth += 1) {
    await openFolder(page, segments.slice(0, depth).join('/'))
  }

  const source = page.getByTestId('assets-list').locator(`[data-asset-path="${assetPath}"]`)
  await expect(source).toBeVisible()
  await source.hover()
  await page.mouse.down()

  const spot = await aim(page)
  // Two moves: the first starts the drag, the second is the one the drop reads.
  await page.mouse.move(spot.x, spot.y, { steps: 6 })
  await page.mouse.move(spot.x, spot.y)
}

async function dropOnScene(page: Page, assetPath: string, aim: Aim): Promise<void> {
  await carry(page, assetPath, aim)
  await page.mouse.up()
}

/** The level as it is on disk, once the entity count has caught up. */
async function levelOnDisk(
  entities: number,
): Promise<{ name: string; transform: { x: number; y: number }; components: Record<string, unknown> }[]> {
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
    entities: { name: string; transform: { x: number; y: number }; components: Record<string, unknown> }[]
  }
  return scene.entities
}
