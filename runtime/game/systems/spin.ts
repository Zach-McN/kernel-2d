import { spinOf } from '../../formats/scene-schema.js'
import type { System } from '../system.js'

/**
 * Turning, at the rate the level asked for.
 *
 * The kernel's only system, and it is here to be a real consumer of the runner
 * rather than to be a feature. Everything about it is deliberately the simplest
 * correct thing: one component, one field, one line of arithmetic, no state of
 * its own between steps.
 *
 * **Degrees stay degrees.** The level stores rotation in degrees and this is a
 * rate in degrees per second, so the sum is a sum and nothing converts. The one
 * conversion there is — degrees counter-clockwise to the engine's radians —
 * happens where it has always happened, in `coordinates.ts`, on the way to the
 * screen (`editor-kernel` D23's fourth point). A system that reached for radians
 * would be the second place that conversion lived.
 *
 * **The angle is wrapped into a single turn.** Left alone, an entity turning at
 * 90°/s carries a rotation of 324,000 after an hour, and a float that large has
 * lost the precision that made small turns smooth. Wrapping also means a level
 * paused and resumed does not have an angle that reads as a bug in the
 * Inspector. Nothing downstream can tell: 370° and 10° are the same picture.
 */
export const spinSystem: System = {
  id: 'spin',

  step: (entities, dtSeconds) => {
    for (const entity of entities) {
      const spin = spinOf(entity)
      // Null covers both "this entity does not turn" and "somebody typed
      // something that is not a rate into the file". Neither is a fault worth
      // stopping a level for, and the Inspector is where a broken component
      // gets named.
      if (spin === null) continue

      entity.transform.rotation = wrapDegrees(
        entity.transform.rotation + spin.degreesPerSecond * dtSeconds,
      )
    }
  },
}

/** Into `[0, 360)`, whichever way round the rate goes. */
function wrapDegrees(degrees: number): number {
  const wrapped = degrees % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}
