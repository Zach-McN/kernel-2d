import type { Page } from '@playwright/test'

/**
 * Typing a value into a field the way a hand does: click it, select what is
 * there, type over it one key at a time.
 *
 * The keystroke-by-keystroke typing matters — `fill` sets the value in one
 * move, and a field that commits on each keystroke (a number that re-renders
 * the picture as it changes, a name that merges into one undo step) is only
 * exercised by the slow way.
 */
export async function typeInto(page: Page, testId: string, text: string): Promise<void> {
  const field = page.getByTestId(testId)
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.pressSequentially(text, { delay: 20 })
}
