import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Starting a level, against the real editor, the real service and the real
 * project folder.
 *
 * This is the first feature that puts a file into somebody's project, so the
 * tests are written around that rather than around the button: where it went,
 * that it is immediately usable, and — most of all — that asking for one twice
 * leaves the first one alone.
 *
 * Every file the editor can write is snapshotted and put back afterwards, and
 * anything that appeared is removed (V14), which is what keeps a level made by
 * one test out of the next one's folder listing.
 */

const LEVEL_ONE = 'scenes/level-01.json'

/** The human's budget, from "within a second". */
const WITHIN_A_SECOND = 1_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

function fileFor(projectRelative: string): string {
  return path.join(editorTestProjectPath(), projectRelative.replaceAll('/', path.sep))
}

async function nameIt(page: Page, name: string): Promise<void> {
  const field = page.getByTestId('new-scene-name')
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.fill(name)
}

/** Selects the `scenes` folder, so that is where a new level would go. */
async function inScenesFolder(page: Page): Promise<void> {
  await page.locator('[data-asset-path="scenes"]').click()
  await expect(page.getByTestId('new-scene')).toBeVisible()
}

// --- acceptance: making one -------------------------------------------------

test('a new level is made where it said it would be, and opens', async ({ page }) => {
  await inScenesFolder(page)
  await nameIt(page, 'level-03')

  // The whole path, before anything is committed. This is the promise: nobody
  // should have to go looking for the file they just made.
  await expect(page.getByTestId('new-scene-path')).toContainText('scenes/level-03.json')

  await page.getByTestId('new-scene-create').click()

  // On disk within the second, listed in the tree, and open in the Viewport.
  await expect
    .poll(() => fs.existsSync(fileFor('scenes/level-03.json')), { timeout: WITHIN_A_SECOND + 1_000 })
    .toBe(true)
  await expect(page.locator('[data-asset-path="scenes/level-03.json"]')).toBeVisible()
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute(
    'data-scene-showing',
    'scenes/level-03.json',
  )
  await expect(page.getByTestId('hierarchy-message')).toContainText('empty')
})

test('the name field does not need the extension, and does not double it', async ({ page }) => {
  await inScenesFolder(page)

  await nameIt(page, 'level-03')
  await expect(page.getByTestId('new-scene-path')).toContainText('scenes/level-03.json')

  await nameIt(page, 'level-03.json')
  await expect(page.getByTestId('new-scene-path')).toContainText('scenes/level-03.json')
  await expect(page.getByTestId('new-scene-path')).not.toContainText('.json.json')
})

test('where it goes follows what is selected, rather than a folder written into the editor', async ({
  page,
}) => {
  await nameIt(page, 'level-03')
  // Nothing selected: the top of the project.
  await expect(page.getByTestId('new-scene-path')).toContainText('Will make level-03.json')

  await selectAsset(page, LEVEL_ONE)
  await expect(page.getByTestId('new-scene-path')).toContainText('scenes/level-03.json')

  await page.locator('[data-asset-path="data"]').click()
  await expect(page.getByTestId('new-scene-path')).toContainText('data/level-03.json')
})

test('it cannot be asked for until it has a name', async ({ page }) => {
  await expect(page.getByTestId('new-scene-create')).toBeDisabled()
  await nameIt(page, 'level-03')
  await expect(page.getByTestId('new-scene-create')).toBeEnabled()
})

// --- acceptance: the guard that matters -------------------------------------

test('asking for a level that already exists says so, and leaves the first one alone', async ({ page }) => {
  const before = {
    text: fs.readFileSync(fileFor(LEVEL_ONE), 'utf8'),
    modifiedAt: fs.statSync(fileFor(LEVEL_ONE)).mtimeMs,
  }

  await inScenesFolder(page)
  await nameIt(page, 'level-01')
  await page.getByTestId('new-scene-create').click()

  await expect(page.getByTestId('new-scene-problem')).toContainText('already something at that path')

  // Bytes *and* timestamp: identical contents alone would also pass for a file
  // that had been rewritten with the same text, which is a different promise
  // (V12). This is the assertion standing between this feature and a level
  // somebody spent an afternoon on.
  expect(fs.readFileSync(fileFor(LEVEL_ONE), 'utf8')).toBe(before.text)
  expect(fs.statSync(fileFor(LEVEL_ONE)).mtimeMs).toBe(before.modifiedAt)
})

test('a folder that does not exist is refused rather than made', async ({ page }) => {
  await nameIt(page, 'chapter-two/level-03')
  await page.getByTestId('new-scene-create').click()

  await expect(page.getByTestId('new-scene-problem')).toContainText('never creates one')
  expect(fs.existsSync(fileFor('chapter-two'))).toBe(false)
})

// --- acceptance: it is a real level -----------------------------------------

test('a new level can be built in straight away, and the file gets it', async ({ page }) => {
  await inScenesFolder(page)
  await nameIt(page, 'level-03')
  await page.getByTestId('new-scene-create').click()
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute(
    'data-scene-showing',
    'scenes/level-03.json',
  )

  await page.getByTestId('entity-add').click()
  await page.getByTestId('entity-texture-control').selectOption('assets/textures/ui/icon-heart.png')

  // Drawn by the real renderer, in a level that did not exist a moment ago.
  await expect
    .poll(() => page.getByTestId('viewport-panel').getAttribute('data-scene-drawn'))
    .toBe('1')

  await expect
    .poll(
      () => {
        const scene = JSON.parse(fs.readFileSync(fileFor('scenes/level-03.json'), 'utf8')) as {
          entities: { components: Record<string, unknown> }[]
        }
        return scene.entities.length
      },
      { timeout: WITHIN_A_SECOND + 1_000 },
    )
    .toBe(1)
})

test('a picture of a level that has just been started', async ({ page }) => {
  await inScenesFolder(page)
  await nameIt(page, 'level-03')
  await page.getByTestId('new-scene-create').click()
  await expect(page.getByTestId('hierarchy-message')).toContainText('empty')
  // The row as well as the scene. The level opens from the service's answer,
  // and the folder listing arrives a beat later by way of the watcher — so a
  // picture taken on the first of those catches the Inspector mid-sentence,
  // saying the file is not in a folder listing that has not been re-read yet.
  await expect(page.locator('[data-asset-path="scenes/level-03.json"]')).toBeVisible()

  await page.screenshot({ path: 'test-results/new-scene.png', fullPage: false })
})
