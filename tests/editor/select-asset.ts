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
  const segments = assetPath.split('/')
  for (let depth = 1; depth < segments.length; depth += 1) {
    await openFolder(page, segments.slice(0, depth).join('/'))
  }
  await assetRow(page, assetPath).click()
  await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting', assetPath)
}

export async function openFolder(page: Page, folderPath: string): Promise<void> {
  const item = page.locator(`li.asset-row:has(> button[data-asset-path="${folderPath}"])`)
  if ((await item.getAttribute('aria-expanded')) === 'true') return
  await assetRow(page, folderPath).click()
  await expect(item).toHaveAttribute('aria-expanded', 'true')
}
