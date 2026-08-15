import type { Point } from '../../runtime'

/**
 * Where a small floating card sits when it is opened at a spot in a panel.
 *
 * Two of these exist — the entity right-click window and the Assets panel's
 * new-document menu — and they want the same thing: *next to the press, and all
 * of it still on screen*. That is more arithmetic than it looks, and it would be
 * the same arithmetic in each of them, which is exactly how two cards that were
 * meant to behave identically start behaving differently by a pixel and then by
 * a rule.
 *
 * Everything here is in the panel's own pixels. The panel is the box because
 * that is the box the card must stay inside of; a card measured against the
 * window would sit correctly on screen and hang off the panel it belongs to.
 *
 * **Near an edge a card flips to the other side of the press rather than
 * sliding along it**, which is what every context menu in every application
 * does — and it stops being a nicety the moment a card is tall. Sliding keeps
 * the card on screen and lets it drift a long way from the cursor: a 130-pixel
 * card in a 200-pixel panel, pressed near the bottom, ends up over a hundred
 * pixels above the thing it is about, pointing at nothing in particular.
 *
 * **A flipped card is pinned by its *bottom* edge, and that is the load-bearing
 * detail rather than a spelling of the same thing.** Pinned by its top at
 * `press − height` it would depend on `height` being right, and `height` here is
 * a *reservation* — a number written by hand next to a component that can grow
 * when it has a path to preview or a refusal to show. Reserve too much and the
 * card opens with a visible gap under the press; too little and it opens over
 * it. Pinned by its bottom, the card touches the press whatever it turns out to
 * measure, and anything it grows later grows *upward*, into the room that made
 * the flip the right choice in the first place. The reservation is then only
 * ever used to decide *which side* — a judgement that survives being a few
 * pixels out.
 */

/** Roughly how much room a card needs, including the margin it keeps from the edge. */
export interface Room {
  width: number
  height: number
}

/**
 * Where a card sits, as the CSS that pins it to its panel.
 *
 * `top` or `bottom`, never both: which one is present is which edge of the card
 * is anchored, and so which way it grows.
 */
export interface Spot {
  left: number
  top?: number
  bottom?: number
}

/** The margin a card keeps from every edge of its panel, in CSS pixels. */
const EDGE = 8

/** How far the card sits from the press itself, across and down. */
const ACROSS = 12
const DOWN = 8

export function spotIn(panel: DOMRect | undefined, at: Point, room: Room): Spot {
  const width = panel?.width ?? 0
  const height = panel?.height ?? 0

  // Sideways it only ever slides. A card has a fixed width, so it never grows
  // into the edge it was moved away from — the whole reason the vertical case
  // needs more than this.
  const left = Math.max(EDGE, Math.min(at.x + ACROSS, width - room.width))

  const fitsBelow = at.y + DOWN + room.height <= height
  const fitsAbove = at.y - DOWN - room.height >= EDGE

  // Above the press, pinned by the bottom so it grows upward. Only when there
  // is genuinely no room below: below is the ordinary reading of "next to".
  if (!fitsBelow && fitsAbove) {
    return { left, bottom: Math.max(EDGE, height - (at.y - DOWN)) }
  }

  // Below the press — or, when the panel is too small to hold the card either
  // way up, pinned to the near edge and allowed to be cramped. The alternative
  // to cramped is off screen.
  return { left, top: Math.max(EDGE, Math.min(at.y + DOWN, height - room.height)) }
}
