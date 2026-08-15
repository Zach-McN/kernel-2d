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
 *
 * **`maxHeight` is a number of pixels rather than a percentage in the
 * stylesheet, and that is a fix rather than a preference.** A percentage
 * `max-height` resolves against a containing block with a *definite* height; a
 * panel that gets its size from a flex parent has a height that measures 262 and
 * is not definite, so `max-height: calc(100% - 16px)` silently computes to none
 * and a card that outgrows its panel is clipped by the panel's hidden overflow
 * with no scrollbar to say so. The measurement is right here in this function,
 * so it is stated as pixels and the question never arises.
 */
export interface Spot {
  left: number
  top?: number
  bottom?: number
  /** The room between the anchored edge and the far edge of the panel. */
  maxHeight: number
}

/** The margin a card keeps from every edge of its panel, in CSS pixels. */
const EDGE = 8

/** How far the card sits from the press itself, across and down. */
const ACROSS = 12
const DOWN = 8

export function spotIn(panel: DOMRect | undefined, at: Point, wants: Room): Spot {
  const width = panel?.width ?? 0
  const height = panel?.height ?? 0

  // Sideways it only ever slides. A card has a fixed width, so it never grows
  // into the edge it was moved away from — the whole reason the vertical case
  // needs more than this.
  const left = Math.max(EDGE, Math.min(at.x + ACROSS, width - wants.width))

  /** Pinned by its top, with the room between there and the bottom edge. */
  const below = (top: number): Spot => ({ left, top, maxHeight: room(height - top - EDGE) })
  /** Pinned by its bottom, with the room between there and the top edge. */
  const above = (bottom: number): Spot => ({ left, bottom, maxHeight: room(height - bottom - EDGE) })

  const fitsBelow = at.y + DOWN + wants.height <= height
  const fitsAbove = at.y - DOWN - wants.height >= EDGE

  // Below the press: the ordinary reading of "next to", and the card grows
  // downward into the room that made it the right choice.
  if (fitsBelow) return below(at.y + DOWN)

  // Above the press, pinned by the bottom so it grows upward instead.
  if (fitsAbove) return above(Math.max(EDGE, height - (at.y - DOWN)))

  /*
   * **Neither: the card is too tall for this panel, and it is pinned to a panel
   * edge rather than placed relative to the press at all.**
   *
   * The obvious last resort — slide it up until it fits — computes a top from
   * the reservation, which is a hand-written number for a card that grows. The
   * moment it grows past that number the extra hangs off the bottom of a panel
   * that hides its overflow, and the human is looking at a menu with its buttons
   * cut off. Pinned to an edge with the room stated, whatever the card does is
   * bounded by the panel and turns into a scroll.
   *
   * The near edge, so it is at least on the side of the panel the hand is.
   */
  return at.y * 2 > height ? above(EDGE) : below(EDGE)
}

/** Never a useless or negative ceiling, however small the panel measures. */
function room(available: number): number {
  return Math.max(80, available)
}
