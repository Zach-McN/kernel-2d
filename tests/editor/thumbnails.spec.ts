import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { PixelCanvas } from '../../scripts/sample/png.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Pictures of the art on the asset tiles.
 *
 * Everything here is asserted off what the tile *says* it drew — the frame it
 * cut and the image it cut it from — rather than off the pixels in the canvas.
 * That is the same choice the texture overlay makes (`editor-ui` U16): a frame
 * count and a measurement are ordinary locators, and comparing rendered pixels
 * would be a test that fails whenever anything about scaling changes and passes
 * whenever a sheet is drawn whole at the right size.
 *
 * The one assertion the whole feature turns on is the strip: **16×16 out of
 * 96×16**. A tile that showed the whole strip would be visible, drawn, correctly
 * sized and completely useless, and no test that only asks "is there a picture"
 * would notice.
 */

/** Where the tests that need their own files put them. Removed after each one. */
const SCRATCH = 'assets/textures/thumbnail-tests'

// One of these changes a sheet's slicing through the Inspector, which writes a
// `.meta` the next test would otherwise inherit.
restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test.afterEach(() => {
  fs.rmSync(path.join(editorTestProjectPath(), ...SCRATCH.split('/')), { recursive: true, force: true })
})

test.describe('pictures on the tiles', () => {
  test('a sprite shows itself rather than a blank page', async ({ page }) => {
    await walkIntoFolder(page, 'assets/textures/characters')

    const knight = tile(page, 'assets/textures/characters/knight-idle.png')
    await expect(knight).toHaveAttribute('data-thumbnail', 'drawn')
    await expect(knight).toHaveAttribute('data-thumb-source', '16x16')
    await expect(knight.locator('canvas')).toBeVisible()
  })

  test('a run strip shows one frame, not the smear of all of them', async ({ page }) => {
    await walkIntoFolder(page, 'assets/textures/characters')

    const strip = tile(page, 'assets/textures/characters/knight-run-strip.png')
    await expect(strip).toHaveAttribute('data-thumbnail', 'drawn')
    // The whole file is four frames side by side; what is on the tile is one.
    await expect(strip).toHaveAttribute('data-thumb-source', '64x16')
    await expect(strip).toHaveAttribute('data-thumb-frame', '16x16')
  })

  test('a tileset shows its first tile, cut by the settings beside it', async ({ page }) => {
    await walkIntoFolder(page, 'assets/textures/tiles')

    const tileset = tile(page, 'assets/textures/tiles/tileset-grass.png')
    await expect(tileset).toHaveAttribute('data-thumbnail', 'drawn')
    await expect(tileset).toHaveAttribute('data-thumb-source', '64x64')
    await expect(tileset).toHaveAttribute('data-thumb-frame', '16x16')
  })

  test('re-slicing a sheet changes what its tile shows, without a reload', async ({ page }) => {
    await walkIntoFolder(page, 'assets/textures/characters')

    const strip = tile(page, 'assets/textures/characters/knight-run-strip.png')
    await expect(strip).toHaveAttribute('data-thumb-frame', '16x16')

    // Straight through the Inspector, because that is the door a human uses —
    // and because it proves the picture is keyed on the *settings* as well as on
    // the file, which is the only reason the key is not simply the path.
    await strip.click()
    await page.getByTestId('frame-width-control').fill('32')

    await expect(strip).toHaveAttribute('data-thumb-frame', '32x16', { timeout: 2000 })
  })

  test('everything that is not a picture keeps the glyph it had', async ({ page }) => {
    await walkIntoFolder(page, 'assets/audio/sfx')
    await expect(tile(page, 'assets/audio/sfx/jump.wav')).toHaveAttribute('data-thumbnail', 'none')

    await walkIntoFolder(page, 'scenes')
    await expect(tile(page, 'scenes/level-01.json')).toHaveAttribute('data-thumbnail', 'none')

    await goToTop(page)
    await expect(tile(page, 'assets')).toHaveAttribute('data-thumbnail', 'none')
  })

  test('a picture saved on disk is on its tile within a second', async ({ page }) => {
    writeSprite(`${SCRATCH}/star.png`, 16, 16)
    await walkIntoFolder(page, SCRATCH)

    const later = tile(page, `${SCRATCH}/moon.png`)
    await expect(later).toBeHidden()

    writeSprite(`${SCRATCH}/moon.png`, 16, 16)

    await expect(later).toHaveAttribute('data-thumbnail', 'drawn', { timeout: 1000 })
  })

  test('a file that is not readable art keeps its glyph, says why, and is only ever read once', async ({
    page,
  }) => {
    fs.mkdirSync(path.join(editorTestProjectPath(), ...SCRATCH.split('/')), { recursive: true })
    fs.writeFileSync(inProject(`${SCRATCH}/not-really.png`), 'this is not a picture')

    const reads: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/asset?') && request.url().includes('not-really')) {
        reads.push(request.url())
      }
    })

    await walkIntoFolder(page, SCRATCH)

    const broken = tile(page, `${SCRATCH}/not-really.png`)
    await expect(broken).toHaveAttribute('data-thumbnail', 'refused', { timeout: 2000 })
    await expect(broken).toHaveAttribute('title', /could not be read|decode|picture/i)
    await expect(broken.locator('canvas')).toHaveCount(0)

    // A brand-new file is looked at twice — once as it lands, and again when the
    // sidecar writes the `.meta` beside it, because settings are half of what
    // identifies a picture. That settles within the moment; what must never
    // happen is a read every time the tile is looked at again.
    await page.waitForTimeout(400)
    reads.length = 0

    // Left and come back to: a refusal is remembered exactly like a picture, so
    // the tile cannot flicker and the file is not read again.
    await goToTop(page)
    await walkIntoFolder(page, SCRATCH)
    await expect(broken).toHaveAttribute('data-thumbnail', 'refused')
    expect(reads).toHaveLength(0)
  })

  test('settings that say a file is not a texture are believed over its name', async ({ page }) => {
    fs.mkdirSync(inProject(SCRATCH), { recursive: true })
    writeSprite(`${SCRATCH}/not-a-texture.png`, 16, 16)
    fs.writeFileSync(
      inProject(`${SCRATCH}/not-a-texture.png.meta`),
      `${JSON.stringify(
        {
          format: 'kernel2d.asset-meta',
          version: 1,
          id: 'thumbnailspec0001',
          type: 'other',
          importSettings: { type: 'other' },
        },
        null,
        2,
      )}\n`,
    )

    await walkIntoFolder(page, SCRATCH)

    await expect(tile(page, `${SCRATCH}/not-a-texture.png`)).toHaveAttribute(
      'data-thumbnail',
      'refused',
      { timeout: 2000 },
    )
  })

  test('a folder of many sprites reads the ones on screen, not all of them', async ({ page }) => {
    const many = 80
    for (let index = 0; index < many; index += 1) {
      writeSprite(`${SCRATCH}/sprite-${String(index).padStart(3, '0')}.png`, 16, 16)
    }

    const read = new Set<string>()
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/api/asset?') && url.includes('thumbnail-tests')) read.add(url)
    })

    await walkIntoFolder(page, SCRATCH)
    await expect(tile(page, `${SCRATCH}/sprite-000.png`)).toHaveAttribute('data-thumbnail', 'drawn', {
      timeout: 2000,
    })
    // Long enough that a design which asked for the whole folder on opening
    // would certainly have done so by now.
    await page.waitForTimeout(500)

    expect(read.size).toBeGreaterThan(0)
    expect(read.size).toBeLessThan(many / 2)
  })

  test('leaves a picture of a folder of sprites behind', async ({ page }, testInfo) => {
    await walkIntoFolder(page, 'assets/textures/characters')
    await expect(tile(page, 'assets/textures/characters/knight-idle.png')).toHaveAttribute(
      'data-thumbnail',
      'drawn',
    )

    await page.screenshot({ path: testInfo.outputPath('asset-tiles-with-thumbnails.png') })
  })
})

/** A tile in the icon half, addressed by the path it is about. */
function tile(page: Page, assetPath: string): Locator {
  return page.getByTestId('assets-icons').locator(`[data-asset-path="${assetPath}"]`)
}

/** Walks into a folder the way a human does: one double-click per step. */
async function walkIntoFolder(page: Page, folder: string): Promise<void> {
  await goToTop(page)
  const steps = folder.split('/')
  for (let depth = 0; depth < steps.length; depth += 1) {
    await tile(page, steps.slice(0, depth + 1).join('/')).dblclick()
  }
  await expect(page.locator(`[data-crumb-path="${folder}"]`)).toHaveAttribute('aria-current', 'true')
}

async function goToTop(page: Page): Promise<void> {
  await page.getByTestId('assets-breadcrumb').locator('.breadcrumb__crumb').first().click()
}

function inProject(projectPath: string): string {
  return path.join(editorTestProjectPath(), ...projectPath.split('/'))
}

/** A real PNG, drawn by the same writer the sample project is drawn with. */
function writeSprite(projectPath: string, width: number, height: number): void {
  const canvas = new PixelCanvas(width, height)
  canvas.fill(0, 0, width, height, [120, 180, 220, 255])
  canvas.outline(0, 0, width, height, [20, 30, 40, 255])

  const file = inProject(projectPath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, canvas.toPng())
}
