import type { Point } from '../../runtime'

/**
 * Where a small floating card sits when it is opened at a spot in a panel.
 *
 * Two of these exist now — the entity right-click window and the Assets panel's
 * new-document menu — and they want the same thing: *next to the press, and all
 * of it still on screen*. The clamp is four lines and would be four lines in
 * each of them, which is exactly how two cards that were meant to behave
 * identically start behaving differently by a pixel and then by a rule.
 *
 * Everything here is in the panel's own pixels. The panel is the box because
 * that is the box the card must stay inside of; a card measured against the
 * window would sit correctly on screen and hang off the panel it belongs to.
 */

/** How much room a card needs, including the margin it keeps from the edge. */
export interface Room {
  width: number
  height: number
}

/** The margin a card keeps from every edge of its panel, in CSS pixels. */
const EDGE = 8

export function spotIn(panel: DOMRect | undefined, at: Point, room: Room): Point {
  return {
    x: Math.max(EDGE, Math.min(at.x + 12, (panel?.width ?? 0) - room.width)),
    y: Math.max(EDGE, Math.min(at.y + 8, (panel?.height ?? 0) - room.height)),
  }
}
