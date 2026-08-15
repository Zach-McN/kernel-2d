import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Driving the Assets panel, shared by every browser test that needs a file
 * selected before it can assert anything about the Inspector.
 *
 * The folder-opening step checks before it clicks. Clicking a folder is a
 * toggle, so a helper that clicked unconditionally would work perfectly in the
 * first test that used it and silently collapse the tree in the second — a
 * failure that surfaces three lines later as "element not found" and reads like
 * a rendering bug (editor-verification W6).
 */

export function assetRow(page: Page, assetPath: string): Locator {
  return page.locator(`[data-asset-path="${assetPath}"]`)
}

export async function selectAsset(page: Page, assetPath: string): Promise<void> {
  await showTree(page)
  const segments = assetPath.split('/')
  for (let depth = 1; depth < segments.length; depth += 1) {
    await openFolder(page, segments.slice(0, depth).join('/'))
  }
  await assetRow(page, assetPath).click()
  await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting', assetPath)
}

export async function openFolder(page: Page, folderPath: string): Promise<void> {
  await showTree(page)
  const item = page.locator(`li.asset-row:has(> button[data-asset-path="${folderPath}"])`)
  if ((await item.getAttribute('aria-expanded')) === 'true') return
  await assetRow(page, folderPath).click()
  await expect(item).toHaveAttribute('aria-expanded', 'true')
}

/**
 * The panel opens on the icon view, and these helpers drive the tree — so the
 * first one to run in a test switches the view, exactly as a hand would through
 * the cog. Only the icon view needs switching away from: the split view has the
 * tree on screen too. Exported for the specs that address tree rows directly
 * rather than through `selectAsset`.
 */
export async function showTree(page: Page): Promise<void> {
  const panel = page.getByTestId('assets-panel')
  if ((await panel.getAttribute('data-view')) !== 'icons') return
  await page.getByTestId('assets-settings').click()
  await page.getByTestId('assets-view-list').click()
  await expect(panel).toHaveAttribute('data-view', 'list')
}

/**
 * Opens the make-a-file menu from the `+` in the bar.
 *
 * Making a level is behind a menu rather than a permanent row, so every test
 * that makes one opens it first — and, because the menu closes on a press
 * anywhere else, opens it *after* selecting the folder it should go in. The
 * other door is a right-click on the browser's background, which
 * `assets-new-menu.spec.ts` is about.
 */
export async function openNewDocument(page: Page): Promise<void> {
  await page.getByTestId('assets-new-document').click()
  await expect(page.getByTestId('assets-new-menu')).toBeVisible()
}

/**
 * Opens the menu that renames, moves and deletes a file — a right-click on its
 * row.
 *
 * That control used to be a permanent row under the folder listing, so a test
 * only had to select the file. It is a floating menu now, and every test that
 * drives it opens the menu first. Selecting first as well, through the helper
 * above, is what walks the tree open so there is a row to press on.
 */
export async function openFileMenu(page: Page, assetPath: string): Promise<void> {
  await selectAsset(page, assetPath)
  await assetRow(page, assetPath).click({ button: 'right' })
  await expect(page.getByTestId('assets-file-menu')).toHaveAttribute('data-file', assetPath)
}
