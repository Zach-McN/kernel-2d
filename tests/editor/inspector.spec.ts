import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { editorTestProjectPath } from './test-project.js'

/**
 * The Inspector, against the real sample project served by the real sidecar.
 *
 * The rule under test throughout is that it always says something: the cases
 * where there is nothing to tune are ordinary, and a panel that goes blank for
 * them is indistinguishable from one that has broken.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test.describe('the Inspector', () => {
  test('asks you to select something before anything is selected', async ({ page }) => {
    await expect(note(page)).toContainText('Select a file or folder')
  })

  test('shows a texture its id, its type and how it is cut into frames', async ({ page }) => {
    await select(page, 'assets/textures/characters/knight-run-strip.png')

    await expect(page.getByTestId('inspector-name')).toHaveText('knight-run-strip.png')
    await expect(page.getByTestId('inspector-type')).toHaveText('Texture')
    await expect(page.getByTestId('inspector-slice')).toHaveText('16 × 16 grid')
    await expect(page.getByTestId('inspector-filter')).toContainText('Nearest')
    await expect(page.getByTestId('inspector-pivot')).toHaveText('0.5, 1')

    // Any id will do; that there is one, and it is not blank, is the promise.
    await expect(page.getByTestId('inspector-id')).not.toBeEmpty()
  })

  test('shows who made a generated file, so provenance is visible rather than buried', async ({ page }) => {
    await select(page, 'assets/textures/characters/slime.png')

    await expect(page.getByTestId('inspector-generated')).toContainText('2026-08-11')
  })

  test('says a sound has nothing to tune yet, rather than showing an empty panel', async ({ page }) => {
    await select(page, 'assets/audio/sfx/jump.wav')

    await expect(page.getByTestId('inspector-type')).toHaveText('Audio')
    await expect(note(page)).toContainText('Nothing to tune on import')
  })

  test('names a scene file as a scene, and says its own inspector is still to come', async ({ page }) => {
    await select(page, 'scenes/level-01.json')

    await expect(note(page)).toContainText('scene')
  })

  test('says plainly that the editor does not import a README', async ({ page }) => {
    await select(page, 'assets/source/README.txt')

    await expect(note(page)).toContainText('does not import this kind of file')
  })

  test('shows a folder what it holds', async ({ page }) => {
    await select(page, 'assets')

    await expect(page.getByTestId('inspector-name')).toHaveText('assets')
    await expect(note(page)).toContainText('no import settings of its own')
  })

  test('shows what is inside settings it cannot read, and leaves the file alone', async ({ page }) => {
    const broken = path.join(editorTestProjectPath(), 'assets', 'textures', 'ui', 'icon-moon.png')
    fs.writeFileSync(broken, 'pretend-png-bytes')
    fs.writeFileSync(`${broken}.meta`, '{ half a file')

    try {
      await select(page, 'assets/textures/ui/icon-moon.png')

      await expect(note(page)).toContainText('not valid JSON')
      await expect(page.locator('.inspector__raw')).toContainText('half a file')
      expect(fs.readFileSync(`${broken}.meta`, 'utf8')).toBe('{ half a file')
    } finally {
      fs.rmSync(broken, { force: true })
      fs.rmSync(`${broken}.meta`, { force: true })
    }
  })

  test('follows the selection from one file to the next', async ({ page }) => {
    await select(page, 'assets/textures/characters/knight-idle.png')
    await expect(page.getByTestId('inspector-name')).toHaveText('knight-idle.png')

    await select(page, 'assets/textures/characters/slime.png')
    await expect(page.getByTestId('inspector-name')).toHaveText('slime.png')
  })
})

function row(page: Page, assetPath: string) {
  return page.locator(`[data-asset-path="${assetPath}"]`)
}

function note(page: Page) {
  return page.getByTestId('inspector-note')
}

/**
 * Opens the folders down to a path, then clicks it.
 *
 * Each folder is opened only if it is shut, because clicking one is a toggle —
 * a helper that clicked unconditionally would close the tree it had just opened
 * the second time a test used it.
 */
async function select(page: Page, assetPath: string): Promise<void> {
  const segments = assetPath.split('/')
  for (let depth = 1; depth < segments.length; depth += 1) {
    await open(page, segments.slice(0, depth).join('/'))
  }
  await row(page, assetPath).click()
  await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting', assetPath)
}

async function open(page: Page, folderPath: string): Promise<void> {
  const item = page.locator(`li.asset-row:has(> button[data-asset-path="${folderPath}"])`)
  if ((await item.getAttribute('aria-expanded')) === 'true') return
  await row(page, folderPath).click()
  await expect(item).toHaveAttribute('aria-expanded', 'true')
}
