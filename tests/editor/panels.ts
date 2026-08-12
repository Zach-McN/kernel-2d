import { expect, type Page } from '@playwright/test'

/**
 * Driving the docking layout, shared by every spec that needs a particular tab
 * in front.
 *
 * The Viewport and the Texture tab share a group, so only one of them is
 * rendering at a time and a test that asserts against the hidden one is
 * asserting against nothing. Selecting a texture brings the Texture tab forward
 * on its own; this is for the cases where a test needs a tab in front *before*
 * it has selected anything, and for putting the scene back afterwards.
 */

/** Brings a tab to the front by its title, and waits until it is really there. */
export async function showPanel(page: Page, title: string): Promise<void> {
  const tab = page.locator('.dv-tab', { hasText: title })
  await expect(tab).toHaveCount(1)
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}
