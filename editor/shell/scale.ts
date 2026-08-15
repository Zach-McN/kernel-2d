import type { Point } from '../../runtime/scene/coordinates'
import { freely } from './snap'

/**
 * Scaling entities about a pivot — the arithmetic, on its own.
 *
 * `./rotate.ts`'s sibling, and deliberately so: a turn and a scale are one
 * gesture with a different verb, so they share a pivot rule (`pivotOf`), a dead
 * radius, and the rule that everything is computed from the *remembered* start
 * rather than from wherever the group has got to. What differs is the number
 * being measured — a bearing there, a distance ratio here — and it is that
 * difference, not the shape around it, that earns a second file.
 *
 * **Scale is two numbers and a turn is one, and that is the whole reason this
 * file is not four lines longer than that one.** A factor is a `Point` here: an
 * unlocked scale is the same number twice, `X` is `{x: f, y: 1}`, `Y` is
 * `{x: 1, y: f}`. Writing the lock as a branch instead would put "which axis"
 * into the arithmetic, the drawing and the caption; writing it as a pair leaves
 * exactly one place — where the key is read — that knows an axis exists.
 *
 * **What "local" means, and where it stops.** An entity's own `scaleX` stretches
 * its sprite along the sprite's own x-axis, because a transform scales before it
 * rotates — so multiplying `scaleX` *is* the local-space answer, whatever the
 * entity is turned to, with nothing here needing to know its rotation. The
 * *positions* of a group spreading apart are a different question with no local
 * frame to answer it in — several entities have several locals — so those move
 * on the world axes. For one entity the two coincide exactly, because its offset
 * from its own pivot is zero. A world-axis mode for the group is deliberately
 * not here.
 */

/** One entity as a scale found it: where it was, and how big. */
export interface Scaled {
  id: string
  x: number
  y: number
  scaleX: number
  scaleY: number
}

/**
 * The group, scaled about the pivot.
 *
 * Rigid means both halves, exactly as a turn's does: each entity **moves away
 * from** the pivot *and* **grows**. Doing only the second scales six sprites in
 * place and leaves the gaps between them untouched, which is not a scale of the
 * group — and it is the half that passes any test written only about sizes,
 * which is why the unit test asserts the positions too.
 *
 * Always from the remembered start, never from where the entity has got to.
 * Multiplying a multiplied number is how a factor of 1 stops being the identity:
 * with a snap on, scaling out and back would leave the group a few percent from
 * where it began, and nothing would report it.
 */
export function scaleAbout(entities: readonly Scaled[], pivot: Point, factor: Point): Scaled[] {
  return entities.map((entity) => ({
    id: entity.id,
    x: freely(pivot.x + (entity.x - pivot.x) * factor.x),
    y: freely(pivot.y + (entity.y - pivot.y) * factor.y),
    scaleX: freely(entity.scaleX * factor.x),
    scaleY: freely(entity.scaleY * factor.y),
  }))
}

/**
 * How far the pointer is from the pivot, in whatever units both are given in.
 *
 * A distance rather than a bearing, which is the one thing this gesture measures
 * differently from a turn — and, unlike the bearing, it needs no y-flip: a
 * distance is the same number in a y-up world and a y-down one.
 */
export function reachFrom(pivot: Point, at: Point): number {
  return Math.hypot(at.x - pivot.x, at.y - pivot.y)
}

/**
 * The smallest factor a gesture will apply.
 *
 * A distance ratio cannot go negative, so nothing here can flip a sprite — but
 * it can reach zero, and an entity scaled to nothing is one that cannot be found
 * again by eye and cannot be picked up to be fixed. `Esc` and `Ctrl-Z` both
 * undo it, but a floor means the human never has to know that.
 */
export const MIN_FACTOR = 0.01

/**
 * The factor for a pointer that has reached `now`, having started at `began`.
 *
 * The *ratio*, which is what makes the gesture feel like scaling rather than
 * like dragging a number: half the distance is half the size, wherever the hand
 * started from. Starting distances inside the dead radius never get here — the
 * gesture has no origin until the pointer is far enough out for one
 * (`./rotate.ts`'s `tooNear`, shared) — so this cannot divide by nothing.
 */
export function factorFrom(began: number, now: number): number {
  if (!Number.isFinite(began) || began <= 0) return 1
  return Math.max(MIN_FACTOR, now / began)
}

/** The factor as a pair, given which axis — if any — the gesture is held to. */
export function alongAxis(factor: number, axis: 'x' | 'y' | null): Point {
  if (axis === 'x') return { x: factor, y: 1 }
  if (axis === 'y') return { x: 1, y: factor }
  return { x: factor, y: factor }
}

/**
 * How a factor is written in a caption: `×1.25`.
 *
 * Two decimals, because a scale is read rather than typed and `×1.2467` is a
 * number nobody is steering by. An axis-locked scale has two of these and the
 * caption says both, which is why this formats one rather than the pair.
 */
export function writeFactor(factor: number): string {
  return factor.toFixed(2)
}
