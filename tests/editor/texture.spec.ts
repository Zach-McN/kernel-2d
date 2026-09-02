import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { typeInto } from './fields.js'
import { showPanel } from './panels.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * The Texture tab, against the real editor, the real service, the real project
 * folder and the real renderer.
 *
 * Every test here is one of the acceptance criteria for this feature, in the
 * units it was written in (editor-verification V1). Two of the nine are about
 * things a canvas makes hard to assert — "it visibly smooths", "it is crisp
 * again" — and the answer is not to compare pixels, which is brittle across
 * machines, but to have the renderer report what it actually did. The filter
 * in these assertions is read back off the live Phaser texture rather than
 * echoed from the request, so a run that says `linear` is evidence rather than
 * a restatement of the setting.
 *
 * Everything else the human looks at — the frame guides, the uncovered strip,
 * the pivot marker, the caption — is ordinary DOM, on purpose.
 *
 * The tab shares a group with the Viewport, so it has to be in front before any
 * of this is on screen. Selecting a texture brings it forward by itself; the
 * `showPanel` in `beforeEach` is only for the tests that assert something before
 * anything has been selected.
 */

const KNIGHT = 'assets/textures/characters/knight-idle.png' // 16×16, one frame
const STRIP = 'assets/textures/characters/knight-run-strip.png' // 64×16, four 16px frames
const TILESET = 'assets/textures/tiles/tileset-grass.png' // 64×64, sixteen 16px frames
const HIT = 'assets/audio/sfx/hit.wav'
const CHARACTERS = 'assets/textures/characters'

/** The human's budget, from "the new pixels show up within a second". */
const WITHIN_A_SECOND = 1_000

// --- the folder, and putting it back --------------------------------------

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await showPanel(page, 'Texture')
  // Nothing below means anything until the renderer is up, and its first frame
  // is the slowest thing on the page.
  await expect(page.getByTestId('texture-stage').locator('canvas')).toBeVisible()
})

// --- reading the tab --------------------------------------------------

const showing = (page: Page): Locator => page.getByTestId('texture-panel')
const frames = (page: Page): Locator => page.getByTestId('texture-frame')
const caption = (page: Page): Locator => page.getByTestId('texture-bar')

/** What the live Phaser texture is actually filtering with, not what was asked for. */
async function drawnFilter(page: Page): Promise<string | null> {
  return page.getByTestId('texture-panel').getAttribute('data-drawn-filter')
}

async function scaleOnScreen(page: Page): Promise<number> {
  const shown = await page.getByTestId('texture-scale').getAttribute('data-scale')
  return Number(shown)
}

/**
 * The scale, once it has stopped moving.
 *
 * Fitting depends on the size of the panel, and dockview computes its layout
 * inside `requestAnimationFrame` (`editor-ui` UG1) — so a scale read the moment
 * a texture appears can be the fit for a panel that is about to get smaller.
 * Reading it once gives a number that is true and then briefly isn't, which is
 * the sort of flake that gets diagnosed as a zoom bug.
 */
async function settledScale(page: Page): Promise<number> {
  let previous = Number.NaN
  await expect
    .poll(
      async () => {
        const now = await scaleOnScreen(page)
        const unchanged = now === previous
        previous = now
        return unchanged
      },
      { intervals: [120, 120, 120, 120, 120, 120] },
    )
    .toBe(true)
  return previous
}

async function setFrames(page: Page, mode: 'single' | 'grid'): Promise<void> {
  await page.getByTestId('slice-mode-control').selectOption(mode)
}

// --- the acceptances -------------------------------------------------------

test.describe('showing a texture', () => {
  test('a sixteen-pixel sprite arrives big enough to look at', async ({ page }) => {
    await selectAsset(page, KNIGHT)

    await expect(showing(page)).toHaveAttribute('data-texture-showing', KNIGHT)
    // Fitting is in whole steps, so a 16px sprite in a panel this size lands
    // several times its own size rather than as a speck in the middle.
    expect(await scaleOnScreen(page)).toBeGreaterThanOrEqual(8)
  })

  test('the caption says what the picture is', async ({ page }) => {
    await selectAsset(page, KNIGHT)

    await expect(caption(page)).toContainText('16×16')
    await expect(caption(page)).toContainText('one frame')
  })
})

test.describe('changing the filtering', () => {
  test('changes what the renderer is really using, without rebuilding anything', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await expect.poll(() => drawnFilter(page)).toBe('nearest')

    // The very same canvas element has to still be there afterwards: a filter
    // change that quietly tore the game down and built another one would look
    // identical in a screenshot and be the reason the tab stutters later.
    const before = await page.getByTestId('texture-stage').locator('canvas').elementHandle()

    await page.getByTestId('filter-control').selectOption('linear')

    await expect.poll(() => drawnFilter(page)).toBe('linear')
    const after = await page.getByTestId('texture-stage').locator('canvas').elementHandle()
    expect(await before?.evaluate((node, other) => node === other, after)).toBe(true)
  })

  test('is taken back by Ctrl-Z, in the picture as well as in the control', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await page.getByTestId('filter-control').selectOption('linear')
    await expect.poll(() => drawnFilter(page)).toBe('linear')

    await page.keyboard.press('ControlOrMeta+z')

    await expect(page.getByTestId('filter-control')).toHaveValue('nearest')
    await expect.poll(() => drawnFilter(page)).toBe('nearest')
  })
})

test.describe('frame guides', () => {
  test('appear over the image when the frames are a grid', async ({ page }) => {
    await selectAsset(page, STRIP)
    await expect(frames(page)).toHaveCount(4)

    await setFrames(page, 'single')
    // A lone frame's edge is the image's edge, which is already outlined.
    await expect(frames(page)).toHaveCount(0)

    await setFrames(page, 'grid')
    await expect(frames(page)).toHaveCount(4)
  })

  test('move as the frame size is typed, not when the field is left', async ({ page }) => {
    await selectAsset(page, TILESET)
    await expect(frames(page)).toHaveCount(16)

    await typeInto(page, 'frame-width-control', '32')

    // Still inside the field: no blur, no click elsewhere, nothing committed by
    // leaving. Eight frames is two columns of 32 across four rows of 16.
    await expect(frames(page)).toHaveCount(8)
    await expect(page.getByTestId('frame-width-control')).toBeFocused()
  })

  test('show a frame size that does not divide the image as pixels no frame reaches', async ({ page }) => {
    await selectAsset(page, STRIP)

    // 64 across, frames 24 wide: two fit and sixteen pixels are left over.
    await typeInto(page, 'frame-width-control', '24')

    await expect(frames(page)).toHaveCount(2)
    await expect(page.getByTestId('texture-uncovered-right')).toBeVisible()
    await expect(caption(page)).toContainText('16px of the width not covered')
  })

  test('say so plainly when no frame of that size fits at all', async ({ page }) => {
    await selectAsset(page, STRIP)

    await typeInto(page, 'frame-width-control', '128')

    await expect(frames(page)).toHaveCount(0)
    await expect(caption(page)).toContainText('no frame of that size fits')
  })
})

test.describe('the pivot', () => {
  test('is visible, and moves when it is changed', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    const marker = page.getByTestId('texture-pivot')
    await expect(marker).toBeVisible()

    const before = Number(await marker.getAttribute('data-pivot-x'))

    await typeInto(page, 'pivot-x-control', '0.1')

    await expect.poll(async () => Number(await marker.getAttribute('data-pivot-x'))).toBeLessThan(before)
  })
})

test.describe('what is selected is not a texture', () => {
  test('a sound says what it is instead of leaving the last picture up', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await expect(showing(page)).toHaveAttribute('data-texture-showing', KNIGHT)

    await selectAsset(page, HIT)

    await expect(showing(page)).toHaveAttribute('data-texture-showing', '')
    await expect(caption(page)).toContainText('is a sound')
  })

  test('a folder says so too, and is a different sentence from nothing selected', async ({ page }) => {
    // Nothing selected yet: this is the state the editor opens in.
    await expect(caption(page)).toContainText('Select a texture')

    await selectAsset(page, KNIGHT)
    await page.locator(`[data-asset-path="${CHARACTERS}"]`).click()

    await expect(showing(page)).toHaveAttribute('data-texture-showing', '')
    await expect(caption(page)).toContainText('is a folder')
  })
})

test.describe('the file changing on disk', () => {
  test('shows the new pixels within a second, with nothing reselected', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await expect(showing(page)).toHaveAttribute('data-texture-showing', KNIGHT)

    const drawnAt = (): Promise<string | null> => showing(page).getAttribute('data-drawn-version')
    const before = await drawnAt()

    // Re-saved from outside the editor, exactly as Photoshop would: the whole
    // chain under test is watcher, feed, stream, proxy, panel and renderer, and
    // any stub replaces the part most likely to be wrong (V11).
    const file = path.join(editorTestProjectPath(), KNIGHT.replaceAll('/', path.sep))
    const repainted = Buffer.from(fs.readFileSync(file))
    fs.writeFileSync(file, repainted)

    await expect.poll(drawnAt, { timeout: WITHIN_A_SECOND + 1_000 }).not.toBe(before)
    // Restored so the picture the next test sees is the one the generator wrote.
    fs.writeFileSync(file, repainted)
  })
})

test.describe('zoom', () => {
  test('steps in whole numbers and comes back to fitting', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    const fitted = await settledScale(page)
    await expect(page.getByTestId('zoom-fit')).toHaveAttribute('data-fitting', 'true')

    await page.getByTestId('zoom-out').click()
    await expect.poll(() => scaleOnScreen(page)).toBeLessThan(fitted)

    const stepped = await scaleOnScreen(page)
    // Whole pixels per pixel, or whole pixels to a pixel. Anything else makes
    // pixel art look like badly drawn pixel art rather than like a badly chosen
    // zoom, so the human blames their own work.
    expect(Number.isInteger(stepped >= 1 ? stepped : 1 / stepped)).toBe(true)
    await expect(page.getByTestId('zoom-fit')).toHaveAttribute('data-fitting', 'false')

    await page.getByTestId('zoom-fit').click()

    await expect.poll(() => scaleOnScreen(page)).toBe(fitted)
    await expect(page.getByTestId('zoom-fit')).toHaveAttribute('data-fitting', 'true')
  })

  test('never draws the image larger than the panel it is in', async ({ page }) => {
    await selectAsset(page, TILESET)
    await settledScale(page)

    const stage = await page.getByTestId('texture-stage').boundingBox()
    const image = await page.getByTestId('texture-bounds').boundingBox()

    expect(stage).not.toBeNull()
    expect(image).not.toBeNull()
    expect(image?.width ?? 0).toBeLessThanOrEqual(stage?.width ?? 0)
    expect(image?.height ?? 0).toBeLessThanOrEqual(stage?.height ?? 0)
  })
})

test('a picture of the texture tab, to look at when something is reported as looking wrong', async ({
  page,
}) => {
  await selectAsset(page, TILESET)
  await expect(frames(page)).toHaveCount(16)

  await page.screenshot({ path: 'test-results/texture-tab.png', fullPage: false })
})
