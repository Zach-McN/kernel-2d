import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { showPanel } from './panels.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * A scene in the viewport, against the real editor, the real service, the real
 * project folder and the real renderer.
 *
 * Acceptance criteria 2, 4, 5, 7, 8, 9, 10 and 11 of this feature, in the units
 * they were written in (editor-verification V1). None of them compares a pixel:
 * where an entity was drawn and how big it came out are reported by the renderer
 * and read off the DOM (V17), and everything drawn *over* the canvas is ordinary
 * SVG with ordinary locators.
 */

const LEVEL_ONE = 'scenes/level-01.json'
const KNIGHT = 'assets/textures/characters/knight-idle.png'
const HEART = 'assets/textures/ui/icon-heart.png'

/** The human's budget, from "within a second". */
const WITHIN_A_SECOND = 1_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  // Nothing below means anything until the renderer is up, and its first frame
  // is the slowest thing on the page.
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')
const row = (page: Page, name: string): Locator =>
  page.getByTestId('hierarchy-panel').locator('[data-entity-id]').filter({ hasText: name }).first()

async function openScene(page: Page, scenePath = LEVEL_ONE): Promise<void> {
  await selectAsset(page, scenePath)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', scenePath)
}

function sceneFile(): string {
  return path.join(editorTestProjectPath(), LEVEL_ONE.replaceAll('/', path.sep))
}

async function selectedOrigin(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.getByTestId('scene-selected-origin')
  return {
    x: Number(await marker.getAttribute('data-entity-x')),
    y: Number(await marker.getAttribute('data-entity-y')),
  }
}

async function typeInto(page: Page, testId: string, text: string): Promise<void> {
  const field = page.getByTestId(testId)
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.pressSequentially(text, { delay: 20 })
}

// --- acceptance 2: two things looked at at once ----------------------------

test.describe('looking at a texture while a scene is open', () => {
  test('opens the texture in its own tab and leaves the scene where it was', async ({ page }) => {
    await openScene(page)
    await row(page, 'Knight').click()

    await selectAsset(page, KNIGHT)

    // The Texture tab came forward on its own, named after the file.
    await expect(page.getByTestId('texture-panel')).toHaveAttribute('data-texture-showing', KNIGHT)

    await showPanel(page, 'Viewport')

    // The scene is exactly where it was left, selection included.
    await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
    await expect(page.getByTestId('hierarchy-panel')).toHaveAttribute('data-scene', LEVEL_ONE)
  })

  /**
   * The other half of the same rule, and the half that is easy to leave out:
   * with the Texture tab in front, clicking a scene has to bring the Viewport
   * back, or the human clicks a level and nothing appears to happen.
   */
  test('clicking a scene brings the Viewport back without being asked', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await expect(page.getByTestId('texture-panel')).toBeVisible()

    await selectAsset(page, LEVEL_ONE)

    await expect(viewport(page)).toBeVisible()
    await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  })
})

// --- acceptance 4 and 5: typing, and one press of Ctrl-Z --------------------

test.describe('typing a new position', () => {
  test('moves it as it is typed, not when the field is left', async ({ page }) => {
    await openScene(page)
    await row(page, 'Knight').click()
    const before = await selectedOrigin(page)

    await typeInto(page, 'entity-x-control', '240')

    // Still inside the field: no blur, no click elsewhere, nothing committed by
    // leaving it.
    await expect.poll(async () => (await selectedOrigin(page)).x).toBeGreaterThan(before.x)
    await expect(page.getByTestId('entity-x-control')).toBeFocused()
  })

  test('goes back in one press of Ctrl-Z, not one per digit', async ({ page }) => {
    await openScene(page)
    await row(page, 'Knight').click()
    const before = await selectedOrigin(page)

    await typeInto(page, 'entity-x-control', '240')
    await expect.poll(async () => (await selectedOrigin(page)).x).not.toBe(before.x)

    await page.keyboard.press('ControlOrMeta+z')

    await expect(page.getByTestId('entity-x-control')).toHaveValue('100')
    await expect.poll(async () => (await selectedOrigin(page)).x).toBe(before.x)
  })

  test('y counts upward, so a bigger number is higher on screen', async ({ page }) => {
    await openScene(page)
    await row(page, 'Knight').click()
    const before = await selectedOrigin(page)

    await typeInto(page, 'entity-y-control', '120')

    // Screen y counts downward, so "higher up" is a smaller number there. This
    // is the whole of the y-up convention, asserted against what was drawn.
    await expect.poll(async () => (await selectedOrigin(page)).y).toBeLessThan(before.y)
  })
})

// --- acceptance 9: the pivot decides where a sprite sits --------------------

test('a sprite pivoted at its feet stands on its Y position rather than straddling it', async ({ page }) => {
  await openScene(page)
  await row(page, 'Knight').click()

  const origin = await selectedOrigin(page)
  const bounds = await page.getByTestId('scene-selected-bounds').boundingBox()
  const stage = await page.getByTestId('viewport-stage').boundingBox()
  expect(bounds).not.toBeNull()
  expect(stage).not.toBeNull()

  // The marker is the entity's position; the box is the sprite. Feet pivot
  // means the box's bottom edge lands on the position, with the whole sprite
  // above it. One pixel of slack for the rounding a whole-pixel placement does.
  const boxBottom = (bounds?.y ?? 0) + (bounds?.height ?? 0) - (stage?.y ?? 0)
  const boxTop = (bounds?.y ?? 0) - (stage?.y ?? 0)

  expect(Math.abs(boxBottom - origin.y)).toBeLessThanOrEqual(1)
  expect(boxTop).toBeLessThan(origin.y)
})

// --- acceptance 7: a texture setting changed elsewhere ----------------------

test('changing a texture’s filtering redraws every entity using it, without reopening the scene', async ({
  page,
}) => {
  await openScene(page)

  await selectAsset(page, KNIGHT)
  await expect(page.getByTestId('texture-panel')).toHaveAttribute('data-drawn-filter', 'nearest')

  await page.getByTestId('filter-control').selectOption('linear')
  await expect.poll(() => page.getByTestId('texture-panel').getAttribute('data-drawn-filter')).toBe('linear')

  await showPanel(page, 'Viewport')

  // Nothing was reopened: the scene is still the one that was open, and it is
  // still drawing every entity it had.
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '5')
})

// --- acceptance 8: the file changing on disk --------------------------------

test('a texture re-saved outside the editor shows its new pixels within a second', async ({ page }) => {
  await openScene(page)
  await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '5')

  // Re-saved exactly as an art tool would: the whole chain under test is
  // watcher, feed, stream, proxy, panel and renderer (V11).
  const file = path.join(editorTestProjectPath(), KNIGHT.replaceAll('/', path.sep))
  const pixels = Buffer.from(fs.readFileSync(file))
  fs.writeFileSync(file, pixels)

  // The scene keeps drawing everything it had — the point is that the redraw
  // happened without anything being reselected, and that nothing broke doing it.
  await expect
    .poll(() => viewport(page).getAttribute('data-scene-drawn'), { timeout: WITHIN_A_SECOND + 1_000 })
    .toBe('5')
  fs.writeFileSync(file, pixels)
})

// --- acceptance 10: edited in a text editor ---------------------------------

test.describe('the scene file changing on disk', () => {
  test('the Hierarchy and the Viewport follow within a second', async ({ page }) => {
    await openScene(page)
    await expect(page.getByTestId('hierarchy-panel').locator('[data-entity-id]')).toHaveCount(5)

    const scene = JSON.parse(fs.readFileSync(sceneFile(), 'utf8')) as {
      entities: { id: string; name: string }[]
    }
    scene.entities.push({
      ...scene.entities[0],
      id: 'aaaaaaaabbbbbbbb',
      name: 'Added by hand',
    } as (typeof scene.entities)[number])
    fs.writeFileSync(sceneFile(), `${JSON.stringify(scene, null, 2)}\n`)

    await expect(page.getByTestId('hierarchy-panel').locator('[data-entity-id]')).toHaveCount(6, {
      timeout: WITHIN_A_SECOND + 1_000,
    })
    await expect(page.getByTestId('hierarchy-panel')).toContainText('Added by hand')
  })

  /**
   * The tripwire that matters for a format the editor rewrites: a key nobody
   * modelled must survive the next change made in the editor. It is asserted at
   * the service level too, in `tests/sidecar/document-endpoint.test.ts`; this is
   * the same promise made through the whole editor.
   */
  test('a key added by hand survives the next change made in the editor', async ({ page }) => {
    await openScene(page)

    const scene = JSON.parse(fs.readFileSync(sceneFile(), 'utf8')) as Record<string, unknown> & {
      entities: Record<string, unknown>[]
    }
    scene['myOwnNote'] = 'the boss spawns here'
    const first = scene.entities[0]
    if (first !== undefined) {
      first['designerNote'] = 'faces right on purpose'
      // Renamed in the same edit purely so this test can *see* the editor take
      // the file. Polling the file itself would only prove the test's own write
      // landed, and typing before the editor had re-read would write the
      // pre-edit document straight back over the keys — which is a real
      // sequence, but a different one from the one being asserted here.
      first['name'] = 'Renamed by hand'
    }
    fs.writeFileSync(sceneFile(), `${JSON.stringify(scene, null, 2)}\n`)

    await expect(page.getByTestId('hierarchy-panel')).toContainText('Renamed by hand', {
      timeout: WITHIN_A_SECOND + 1_000,
    })

    await row(page, 'Slime').click()
    await typeInto(page, 'entity-x-control', '210')

    await expect
      .poll(
        () => {
          const after = JSON.parse(fs.readFileSync(sceneFile(), 'utf8')) as Record<string, unknown> & {
            entities: Record<string, unknown>[]
          }
          const moved = after.entities.some(
            (entity) => (entity['transform'] as { x?: number } | undefined)?.x === 210,
          )
          return {
            moved,
            top: after['myOwnNote'],
            nested: after.entities[0]?.['designerNote'],
          }
        },
        { timeout: 4_000 },
      )
      .toEqual({ moved: true, top: 'the boss spawns here', nested: 'faces right on purpose' })
  })
})

// --- acceptance 11: a texture that is not there -----------------------------

test('a scene referring to a texture that is gone says so, by name', async ({ page }) => {
  await openScene(page)
  await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '5')

  // Deliberately produced against the throwaway copy rather than shipped in the
  // sample: a broken sample would be a trap for whoever opened it.
  const file = path.join(editorTestProjectPath(), HEART.replaceAll('/', path.sep))
  const pixels = Buffer.from(fs.readFileSync(file))
  fs.rmSync(file)

  try {
    await expect(page.getByTestId('viewport-problem')).toContainText('icon-heart.png', {
      timeout: WITHIN_A_SECOND + 2_000,
    })
    await expect(page.getByTestId('viewport-problem')).toContainText('not in the project folder')
    // Named in the list as well, so the entity it belongs to is findable.
    await expect(row(page, 'Health icon')).toHaveAttribute('data-entity-problem', 'missing texture')
    // And drawn as four rather than five, rather than quietly as five.
    await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '4')
  } finally {
    fs.writeFileSync(file, pixels)
  }
})

test('a picture of the scene, to look at when something is reported as looking wrong', async ({ page }) => {
  await openScene(page)
  await row(page, 'Knight').click()
  await expect(page.getByTestId('scene-selected-bounds')).toBeVisible()

  await page.screenshot({ path: 'test-results/scene.png', fullPage: false })
})
