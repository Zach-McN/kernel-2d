import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'

/**
 * An entity pinned to the screen (`screen` component), against the real
 * renderer: chosen from the Inspector's picker, it stays where it appears the
 * moment it is pinned, stays put when the camera pans, is left out of what
 * "frame everything" measures, and comes unpinned with Ctrl-Z like any other
 * edit. Nothing here compares a pixel — the renderer's own outline and origin
 * marker are read off the DOM (`editor-verification` V17).
 */

const LEVEL_TWO = 'scenes/level-02.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')

const row = (page: Page, name: string): Locator =>
  page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: name }).first()

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

/** The selected sprite's outline, relative to the stage. */
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

async function sceneOrigin(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.getByTestId('scene-origin')
  return {
    x: Number(await marker.getAttribute('data-origin-x')),
    y: Number(await marker.getAttribute('data-origin-y')),
  }
}

async function dragBy(page: Page, dx: number, dy: number): Promise<void> {
  const stage = await page.getByTestId('viewport-stage').boundingBox()
  const from = { x: (stage?.x ?? 0) + (stage?.width ?? 0) / 2, y: (stage?.y ?? 0) + (stage?.height ?? 0) / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  await settledCamera(page)
}

const near = (a: number, b: number, slack = 1.5): boolean => Math.abs(a - b) <= slack

test('pinning an entity keeps it where it appears, and the camera stops moving it', async ({ page }) => {
  await selectAsset(page, LEVEL_TWO)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_TWO)
  const framed = await settledCamera(page)

  await row(page, 'Continue button').click()
  await expect(page.getByTestId('scene-selected-bounds')).toBeVisible()
  const before = await outline(page)

  // Pin it to the bottom-right corner from the Inspector.
  await page.getByTestId('entity-screen-control').selectOption('bottom-right')
  await expect(page.getByTestId('entity-screen-control')).toHaveValue('bottom-right')

  // It has not moved: the position was rewritten in the corner's terms.
  await expect.poll(async () => near((await outline(page)).x, before.x)).toBe(true)
  const pinned = await outline(page)
  expect(near(pinned.y, before.y)).toBe(true)
  expect(near(pinned.width, before.width)).toBe(true)

  // Pan the camera: the world moves, the pinned button does not.
  const originBefore = await sceneOrigin(page)
  await dragBy(page, 80, -40)
  const originAfter = await sceneOrigin(page)
  expect(near(originAfter.x - originBefore.x, 80)).toBe(true)
  expect(near(originAfter.y - originBefore.y, -40)).toBe(true)

  const stillPinned = await outline(page)
  expect(near(stillPinned.x, pinned.x)).toBe(true)
  expect(near(stillPinned.y, pinned.y)).toBe(true)

  // Frame everything: the pinned button is not part of the level's extent, so
  // the framing is the framing of the two slimes and the floor — different
  // from the framing that included the button in the corner.
  await page.keyboard.press('Home')
  const reframed = await settledCamera(page)
  expect(reframed.x !== framed.x || reframed.y !== framed.y || reframed.scale !== framed.scale).toBe(true)

  // Still in the corner. The offset is in scene units at the camera's scale —
  // a pinned picture zooms with the level, like the reference's HUD — so what
  // is constant across a re-frame is the gap to the corner *divided by the
  // scale*, not the gap in pixels.
  const stage = await page.getByTestId('viewport-stage').boundingBox()
  const gapAt = (box: { x: number; y: number; width: number; height: number }, camera: Camera) => ({
    right: ((stage?.width ?? 0) - (box.x + box.width)) / camera.scale,
    bottom: ((stage?.height ?? 0) - (box.y + box.height)) / camera.scale,
  })
  const wasAt = gapAt(pinned, framed)
  const isAt = gapAt(await outline(page), reframed)
  expect(near(isAt.right, wasAt.right, 1)).toBe(true)
  expect(near(isAt.bottom, wasAt.bottom, 1)).toBe(true)

  // And it is an ordinary edit: Ctrl-Z unpins it.
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('entity-screen-control')).toHaveValue('none')
})
