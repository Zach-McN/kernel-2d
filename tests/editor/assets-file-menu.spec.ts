import fs from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { assetRow, openFileMenu, selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * The menu a right-click on a file or folder opens: rename, move, delete, and
 * make one here.
 *
 * **What those verbs do is `rename.spec.ts`** — that file is about the promises
 * (references follow, a delete says what still uses it, the project settings
 * cannot be renamed away) and it drives this menu to make them. This file is
 * about the menu itself: that the press opens it, that it is about the file that
 * was pressed, that a folder gets a different set of controls, and that it is
 * one menu with the panel's other one.
 */

restoreProjectAfterEach()

const HEART = 'assets/textures/ui/icon-heart.png'
const UI_FOLDER = 'assets/textures/ui'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

// --- the panel is the folder now -------------------------------------------

test('nothing is under the folder listing but a sentence naming the press', async ({ page }) => {
  await selectAsset(page, HEART)

  // Selecting a file used to grow a rename row under the browser. It does not.
  await expect(page.getByTestId('move-file')).toHaveCount(0)
  await expect(page.getByTestId('assets-hint')).toContainText('Right-click a file')
})

// --- the press --------------------------------------------------------------

test('right-clicking a file opens the menu on that file, selected', async ({ page }) => {
  await openFileMenu(page, HEART)

  const menu = page.getByTestId('assets-file-menu')
  await expect(menu).toContainText('icon-heart.png')
  // Selected as well as asked about, so the row, the Inspector and the menu all
  // describe one file.
  await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting', HEART)
  // And the cursor is in the name field, which is the ordinary thing to want
  // and is what puts Esc inside the menu rather than out on the row.
  await expect(page.getByTestId('move-file-name')).toBeFocused()
})

/**
 * **The whole card is inside the panel, which is the promise a tall card in a
 * short panel can actually keep.**
 *
 * The other menus assert they open *next to* the press. This one is 200 pixels
 * tall in a panel that is 260 in the test window, so there is often no "next to"
 * available — the card is pinned to a panel edge instead
 * (`editor/shell/floating.ts`). What must never happen is the half of it that
 * holds the buttons hanging off a panel that hides its overflow, which is the
 * bug this assertion is here for.
 */
test('the whole menu is inside the panel, however little room there is', async ({ page }) => {
  await openFileMenu(page, HEART)

  const panel = await page.getByTestId('assets-panel').boundingBox()
  const menu = await page.getByTestId('assets-file-menu').boundingBox()
  expect(panel).not.toBeNull()
  expect(menu).not.toBeNull()

  expect(menu?.y ?? 0).toBeGreaterThanOrEqual((panel?.y ?? 0) - 1)
  expect((menu?.y ?? 0) + (menu?.height ?? 0)).toBeLessThanOrEqual(
    (panel?.y ?? 0) + (panel?.height ?? 0) + 1,
  )
  expect(menu?.x ?? 0).toBeGreaterThanOrEqual((panel?.x ?? 0) - 1)
  expect((menu?.x ?? 0) + (menu?.width ?? 0)).toBeLessThanOrEqual(
    (panel?.x ?? 0) + (panel?.width ?? 0) + 1,
  )
})

test('the browser context menu never opens over a row', async ({ page }) => {
  // Selected first, which is what walks the tree open so there is a row to
  // press on.
  await selectAsset(page, HEART)
  await page.evaluate(() => {
    const flags = { seen: 0, prevented: 0 }
    const host = globalThis as unknown as {
      __assetMenu?: typeof flags
      addEventListener: (type: string, listener: (event: { defaultPrevented: boolean }) => void) => void
    }
    host.__assetMenu = flags
    host.addEventListener('contextmenu', (event) => {
      flags.seen += 1
      if (event.defaultPrevented) flags.prevented += 1
    })
  })

  await assetRow(page, HEART).click({ button: 'right' })

  const flags = await page.evaluate(
    () => (globalThis as unknown as { __assetMenu: { seen: number; prevented: number } }).__assetMenu,
  )
  expect(flags.seen).toBeGreaterThanOrEqual(1)
  expect(flags.prevented).toBe(flags.seen)
})

test('Esc closes it, and so does a press somewhere else', async ({ page }) => {
  await openFileMenu(page, HEART)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('assets-file-menu')).toBeHidden()

  await openFileMenu(page, HEART)
  // The Outliner rather than the Viewport: selecting a texture brings the
  // Texture tab forward over the Viewport, which shares its group, so a press
  // aimed there would be aimed at nothing (`editor-verification` W12).
  await page.getByTestId('outliner-panel').click({ position: { x: 8, y: 8 } })
  await expect(page.getByTestId('assets-file-menu')).toBeHidden()
})

test('selecting another file closes it', async ({ page }) => {
  await openFileMenu(page, HEART)

  await assetRow(page, 'assets/textures/ui/button-idle.png').click()

  await expect(page.getByTestId('assets-file-menu')).toBeHidden()
})

// --- a folder gets a different menu ----------------------------------------

test('a folder is offered rename, move, and delete', async ({ page }) => {
  await openFileMenu(page, UI_FOLDER)

  await expect(page.getByTestId('move-file-name')).toBeVisible()
  await expect(page.getByTestId('move-file-folder')).toBeVisible()
  await expect(page.getByTestId('move-file-delete')).toHaveText('Delete folder')
  await expect(page.getByTestId('move-file-folder-note')).toContainText('renamed or moved')
})

/**
 * Deleting a folder: the first press says how many files are inside and what
 * still uses them; the second removes the folder and everything in it, and the
 * panel learns of it from the folder itself. On a folder the test made, because
 * a PNG this suite deletes stays deleted for the run (W14).
 */
test('Delete folder says how many files are inside, then removes the folder and everything in it', async ({
  page,
}) => {
  const root = editorTestProjectPath()
  const spare = path.join(root, 'assets', 'textures', 'spare')
  fs.mkdirSync(spare)
  for (const name of ['a.png', 'b.png', 'c.png']) {
    fs.copyFileSync(path.join(root, 'assets', 'textures', 'ui', 'icon-heart.png'), path.join(spare, name))
  }
  const SPARE = 'assets/textures/spare'
  try {
    await selectAsset(page, HEART)
    await expect(assetRow(page, SPARE)).toBeVisible({ timeout: 3_000 })
    // The sidecars arrive a beat after the files; wait so the count is settled.
    await expect.poll(() => fs.existsSync(path.join(spare, 'c.png.meta')), { timeout: 3_000 }).toBe(true)
    await openFileMenu(page, SPARE)

    await page.getByTestId('move-file-delete').click()
    await expect(page.getByTestId('move-file-uses')).toContainText('holds 3 files')
    await expect(page.getByTestId('move-file-uses')).toContainText('Nothing else in the project uses')
    await expect(page.getByTestId('move-file-delete')).toHaveText('Delete anyway')
    expect(fs.existsSync(spare)).toBe(true)

    await page.getByTestId('assets-panel').screenshot({ path: test.info().outputPath('delete-folder.png') })
    await page.getByTestId('move-file-delete').click()

    await expect.poll(() => fs.existsSync(spare)).toBe(false)
    await expect(assetRow(page, SPARE)).toHaveCount(0, { timeout: 3_000 })
    await expect(page.getByTestId('assets-file-menu')).toHaveCount(0)
    // Nothing is selected any more.
    await expect(page.getByTestId('inspector-note')).toContainText('Select a file or folder')
    // Ctrl-Z does not bring a folder back: files are not on the undo stack.
    await page.keyboard.press('ControlOrMeta+z')
    expect(fs.existsSync(spare)).toBe(false)
  } finally {
    fs.rmSync(spare, { recursive: true, force: true })
  }
})

// --- making one here --------------------------------------------------------

test('a folder menu hands over to the make-a-file card, pointed at that folder', async ({ page }) => {
  await openFileMenu(page, UI_FOLDER)

  await page.getByTestId('assets-file-menu-new').click()

  // One menu replaced by the other, never both.
  await expect(page.getByTestId('assets-file-menu')).toBeHidden()
  await expect(page.getByTestId('assets-new-menu')).toBeVisible()
  // Pointed at the folder that was pressed, because the press selected it.
  await page.getByTestId('new-document-name').fill('hud-test')
  await expect(page.getByTestId('new-document-path')).toContainText(`${UI_FOLDER}/hud-test.json`)
})

test('a file menu hands over pointed at the folder the file is in', async ({ page }) => {
  await openFileMenu(page, HEART)

  await page.getByTestId('assets-file-menu-new').click()

  await page.getByTestId('new-document-name').fill('hud-test')
  await expect(page.getByTestId('new-document-path')).toContainText(`${UI_FOLDER}/hud-test.json`)
})

// --- one menu at a time -----------------------------------------------------

test('only one of the panel’s menus is ever open', async ({ page }) => {
  await openFileMenu(page, HEART)

  await page.getByTestId('assets-new-document').click()

  await expect(page.getByTestId('assets-new-menu')).toBeVisible()
  await expect(page.getByTestId('assets-file-menu')).toBeHidden()
})

test('a picture of the menu', async ({ page }, testInfo) => {
  await openFileMenu(page, HEART)
  await page.getByTestId('assets-panel').screenshot({ path: testInfo.outputPath('assets-file-menu.png') })
})
