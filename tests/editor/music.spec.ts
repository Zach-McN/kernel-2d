import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { viewport } from './scene-view.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * A level's music: picked on the scene in the Inspector, silent while editing,
 * playing on a loop while the level runs.
 *
 * The playing state is asserted off `data-play-music`, which the viewport reads
 * back from the sound system itself (`phaser4-runtime` P4) — reaching `playing`
 * is Chromium having fetched, decoded and started the actual file, so the MP3
 * case here is the whole pipeline proven end to end on a real `.mp3`.
 */

const LEVEL_ONE = 'scenes/level-01.json'
const THEME_MP3 = 'assets/audio/music/theme-cave.mp3'
const THEME_WAV = 'assets/audio/music/theme-menu.wav'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test('a scene offers its music beside its format, once it is open', async ({ page }) => {
  await openScene(page)

  const picker = page.getByTestId('scene-music-control')
  await expect(picker).toBeVisible()
  // Silent until somebody chooses, and both sample sounds are on offer.
  await expect(picker).toHaveValue('')
  await expect(picker.locator('option')).toContainText([/silent/, new RegExp(THEME_MP3)])
})

test('picking a track writes a whole reference into the file, and Ctrl-Z takes it back', async ({
  page,
}) => {
  await openScene(page)

  await page.getByTestId('scene-music-control').selectOption(THEME_MP3)

  // On disk within the second, as an id-and-path reference like every other.
  await expect
    .poll(() => musicOnDisk(), { timeout: 2_000 })
    .toEqual({ id: expect.any(String), path: THEME_MP3 })

  await page.keyboard.press('ControlOrMeta+z')

  await expect.poll(() => musicOnDisk(), { timeout: 2_000 }).toBeUndefined()
  await expect(page.getByTestId('scene-music-control')).toHaveValue('')
})

test('an MP3 plays while the level runs, and stops when it stops', async ({ page }) => {
  await openScene(page)
  await page.getByTestId('scene-music-control').selectOption(THEME_MP3)
  await expect(page.getByTestId('scene-music-control')).toHaveValue(THEME_MP3)

  // Editing is silent: nothing plays until Play is pressed.
  await expect(viewport(page)).toHaveAttribute('data-play-music', '')

  await play(page)

  // `playing` is read back off the sound system, so reaching it means the MP3
  // was fetched, decoded and started for real.
  await expect
    .poll(() => viewport(page).getAttribute('data-play-music'), { timeout: 10_000 })
    .toBe('playing')

  await page.getByTestId('play-stop').click()

  await expect(viewport(page)).toHaveAttribute('data-play-music', '')
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'stopped')
})

test('a WAV plays too — the format is whatever the browser can decode', async ({ page }) => {
  await openScene(page)
  await page.getByTestId('scene-music-control').selectOption(THEME_WAV)
  await expect(page.getByTestId('scene-music-control')).toHaveValue(THEME_WAV)

  await play(page)

  await expect
    .poll(() => viewport(page).getAttribute('data-play-music'), { timeout: 10_000 })
    .toBe('playing')

  await page.getByTestId('play-stop').click()
  await expect(viewport(page)).toHaveAttribute('data-play-music', '')
})

test('a silent level runs silent', async ({ page }) => {
  await openScene(page)

  await play(page)

  await expect
    .poll(() => viewport(page).getAttribute('data-play-state'), { timeout: 10_000 })
    .toBe('running')
  await expect(viewport(page)).toHaveAttribute('data-play-music', 'silent')

  await page.getByTestId('play-stop').click()
})

test('leaves a picture of the choice on the scene', async ({ page }, testInfo) => {
  await openScene(page)
  await page.getByTestId('scene-music-control').selectOption(THEME_MP3)
  await expect(page.getByTestId('scene-music-control')).toHaveValue(THEME_MP3)
  await page.getByTestId('inspector-panel').screenshot({ path: testInfo.outputPath('scene-music.png') })
})

// --- driving ---------------------------------------------------------------

async function openScene(page: Page): Promise<void> {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
}

async function play(page: Page): Promise<void> {
  const start = page.getByTestId('play-start')
  await expect(start).toBeEnabled({ timeout: 10_000 })
  await start.click()
}

/** The level's music as the file on disk has it, or undefined. */
function musicOnDisk(): unknown {
  const file = path.join(editorTestProjectPath(), LEVEL_ONE.replaceAll('/', path.sep))
  const scene = JSON.parse(fs.readFileSync(file, 'utf8')) as { music?: unknown }
  return scene.music
}
