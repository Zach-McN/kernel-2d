import type { Point } from '../../runtime/scene/coordinates'
import { freely } from './snap'

/**
 * Turning entities about a pivot — the arithmetic, on its own.
 *
 * Here rather than inside the panel that calls it because it is the part with
 * the traps in it, and a trap that can be unit-tested should be. Imported from
 * the coordinates module directly rather than through `runtime/index.ts`, which
 * would load Phaser and put this out of a unit test's reach — the same reason
 * `snap.ts` does it.
 *
 * **Scene space is y-up and rotation is degrees counter-clockwise**
 * (`runtime/formats/scene-schema.ts`). Every number in this file is in scene
 * units, and the conversion from where-the-mouse-is happens before anything
 * here is called. Keeping the screen out of this file is what makes the two
 * sign traps a single question asked once, in `angleFrom` below, rather than
 * a question re-asked at every use.
 */

/**
 * One entity as a *move* found it: what has to be remembered to carry it.
 *
 * Here beside `Turned` rather than in the panel that uses it because the two are
 * the same idea one field apart — a gesture remembers where things started and
 * applies its travel to that, never to wherever they have got to.
 */
export interface Moved {
  id: string
  x: number
  y: number
}

/** One entity as a turn found it: a `Moved`, plus the angle it was facing. */
export interface Turned extends Moved {
  rotation: number
}

/**
 * Where a group turns around: the mean of their positions.
 *
 * The *mean of the positions*, deliberately, not the middle of the rectangle
 * they cover. Two sprites of wildly different sizes have a bounding box whose
 * centre sits nearer the big one, which is not what "rotate around the middle
 * of these" means to somebody who selected two things — and it is not what
 * Blender's median point does either.
 *
 * One entity's mean is its own position, which is why turning one thing in
 * place needs no special case anywhere below.
 */
export function pivotOf(entities: readonly Turned[]): Point | null {
  if (entities.length === 0) return null
  let x = 0
  let y = 0
  for (const entity of entities) {
    x += entity.x
    y += entity.y
  }
  return { x: x / entities.length, y: y / entities.length }
}

/**
 * The group, turned rigidly about the pivot.
 *
 * Rigid means both halves: each entity **orbits** the pivot *and* **spins** by
 * the same amount. Doing only the first slides sprites around a circle while
 * they stay upright; doing only the second spins them on the spot. Neither is
 * a rotation of the group, and the first is the one that passes a test written
 * only about positions — which is why the unit test asserts the rotations too.
 *
 * Always computed from the remembered start rather than from where the entity
 * has got to, the same rule the drag keeps: applying a delta to a delta
 * accumulates rounding, and over a long turn the group would visibly deform.
 * It also makes a full 360° exactly the identity, which is the cheapest way to
 * find out that somebody has changed this to accumulate.
 */
export function turnAbout(entities: readonly Turned[], pivot: Point, degrees: number): Turned[] {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return entities.map((entity) => {
    const dx = entity.x - pivot.x
    const dy = entity.y - pivot.y
    return {
      id: entity.id,
      // The standard counter-clockwise rotation, which is what this is in a
      // y-up world — no sign flipped here, because the screen's y-down never
      // reaches this file.
      x: freely(pivot.x + dx * cos - dy * sin),
      y: freely(pivot.y + dx * sin + dy * cos),
      rotation: freely(entity.rotation + degrees),
    }
  })
}

/**
 * How far round the pointer is from the pivot, in **scene** degrees, given both
 * in screen pixels.
 *
 * The one place the y-flip happens, and the reason this function exists rather
 * than an `atan2` at each call site. Screen y counts *down*, so an angle that
 * grows clockwise on screen is a scene rotation that shrinks — hence the
 * negated `dy`. Negating it twice, or not at all, is not a crash: the sprite
 * simply turns the wrong way, which reads as the feature being backwards rather
 * than as arithmetic.
 */
export function angleFrom(pivot: Point, at: Point): number {
  return (Math.atan2(-(at.y - pivot.y), at.x - pivot.x) * 180) / Math.PI
}

/**
 * How near the pivot the pointer stops meaning anything, in screen pixels.
 *
 * On the pivot itself `atan2(0, 0)` is zero by convention rather than by
 * meaning, and a pixel of mouse noise a pixel away from the pivot swings the
 * angle through tens of degrees. Inside this radius the turn keeps the angle it
 * had, so crossing the middle of a sprite on the way somewhere does not spin it.
 */
export const DEAD_RADIUS = 12

/** True when the pointer is too near the pivot for its angle to mean anything. */
export function tooNear(pivot: Point, at: Point): boolean {
  return Math.hypot(at.x - pivot.x, at.y - pivot.y) < DEAD_RADIUS
}

/**
 * The shortest way of writing an angle, for a caption.
 *
 * Turning three times round is 1080°, and a bar that says so is a bar reporting
 * an implementation detail: what the human wants to know is where the thing has
 * ended up. Kept to (-180, 180], so a half turn reads as 180 rather than -180.
 */
export function shortestTurn(degrees: number): number {
  const wrapped = ((degrees % 360) + 540) % 360 - 180
  return freely(wrapped === -180 ? 180 : wrapped)
}
