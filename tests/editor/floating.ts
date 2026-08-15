import { expect, type Locator } from '@playwright/test'

/**
 * Asking whether a floating card opened *next to* what was pressed.
 *
 * Shared by the two specs that assert it — the entity right-click window and the
 * Assets panel's make-a-file menu — because the naive version is wrong in the
 * same way in both, and was, in both.
 *
 * **The naive version compares the card's top-left corner with the press**,
 * which holds only while the card opens below and to the right of it. Near an
 * edge these cards flip to the other side of the press (`editor/shell/floating.ts`),
 * which is adjacent and reads as 140 pixels away to a corner-based assertion —
 * so the test fails for the behaviour improving. The question that survives all
 * three placements is **how far the press is from the nearest edge of the card**,
 * which is zero when the card covers it and small whenever they are touching.
 */
export async function gapFrom(card: Locator, at: { x: number; y: number }): Promise<number> {
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return Number.POSITIVE_INFINITY

  const dx = Math.max(box.x - at.x, 0, at.x - (box.x + box.width))
  const dy = Math.max(box.y - at.y, 0, at.y - (box.y + box.height))
  return Math.hypot(dx, dy)
}
