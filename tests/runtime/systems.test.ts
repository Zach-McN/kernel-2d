import { describe, expect, it } from 'vitest'

import { defaultEntity, type Entity } from '../../runtime/formats/scene-schema'
import { BUILT_IN_SYSTEMS, spinSystem } from '../../runtime/game/systems/index'
import { stepSystems, type System } from '../../runtime/game/system'

/**
 * The kernel's one system, and the rule that runs a list of them.
 *
 * A system is an ordinary function over plain objects, which is the whole point
 * of the interface being as small as it is: this file needs no browser, no
 * renderer, no level file and no clock but the number it passes in.
 *
 * The cases worth having are the two either side of the happy path — an entity
 * that does not turn, and one whose rate somebody typed into a text editor as
 * something that is not a rate. The second is the one that matters: a system runs
 * sixty times a second, so a throw from inside one is the hardest kind of fault
 * to trace back to the file that caused it.
 */

function entityTurning(rate: unknown, rotation = 0): Entity {
  const entity = defaultEntity('spinner01', 'Spinner')
  entity.transform.rotation = rotation
  entity.components['spin'] = { degreesPerSecond: rate }
  return entity
}

describe('spin', () => {
  it('turns an entity by its rate, in the unit the transform already uses', () => {
    const entity = entityTurning(90)
    spinSystem.step([entity], 1)

    expect(entity.transform.rotation).toBe(90)
  })

  it('turns by the fraction of a second it was given', () => {
    const entity = entityTurning(90)
    // A quarter of a second at 90°/s. Whole numbers on both sides, so this is
    // about the arithmetic rather than about a float.
    spinSystem.step([entity], 0.25)

    expect(entity.transform.rotation).toBe(22.5)
  })

  it('adds to the angle the level already had, rather than replacing it', () => {
    const entity = entityTurning(90, 45)
    spinSystem.step([entity], 1)

    expect(entity.transform.rotation).toBe(135)
  })

  it('turns the other way for a negative rate', () => {
    const entity = entityTurning(-90, 0)
    spinSystem.step([entity], 1)

    // Wrapped rather than left at -90: the two are the same picture, and the
    // Inspector should not show somebody a negative angle they never typed.
    expect(entity.transform.rotation).toBe(270)
  })

  it('keeps the angle inside one turn however long it runs', () => {
    /*
     * Left unwrapped, an entity at 90°/s carries a rotation of 324,000 after an
     * hour — a float large enough to have lost the precision that made small
     * turns smooth, and a number that reads as a bug in the Inspector. Ten
     * seconds is enough to have gone round more than twice.
     */
    const entity = entityTurning(90)
    for (let step = 0; step < 600; step += 1) spinSystem.step([entity], 1 / 60)

    expect(entity.transform.rotation).toBeGreaterThanOrEqual(0)
    expect(entity.transform.rotation).toBeLessThan(360)
    expect(entity.transform.rotation).toBeCloseTo(180, 6)
  })

  it('leaves an entity that does not turn exactly as it was', () => {
    const still = defaultEntity('still01', 'Ground')
    still.transform.rotation = 12

    spinSystem.step([still], 1)

    expect(still.transform).toEqual({ x: 0, y: 0, rotation: 12, scaleX: 1, scaleY: 1 })
  })

  const brokenRates: Array<[string, unknown]> = [
    ['a string', '90'],
    ['nothing at all', undefined],
    ['the wrong shape', { rate: 90 }],
  ]

  it.each(brokenRates)(
    'ignores a rate that is %s, rather than throwing sixty times a second',
    (_description, rate) => {
      const entity = entityTurning(rate, 30)

      expect(() => {
        spinSystem.step([entity], 1)
      }).not.toThrow()
      expect(entity.transform.rotation).toBe(30)
    },
  )

  it('turns every entity that asks, in one pass', () => {
    const entities = [entityTurning(90), defaultEntity('still01', 'Ground'), entityTurning(-45)]
    spinSystem.step(entities, 1)

    expect(entities.map((entity) => entity.transform.rotation)).toEqual([90, 0, 315])
  })
})

describe('running a list of systems', () => {
  it('runs them in the order they were given', () => {
    const order: string[] = []
    const remember = (id: string): System => ({ id, step: () => order.push(id) })

    stepSystems([remember('first'), remember('second'), remember('third')], [], 1 / 60)

    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('does nothing at all when there are no systems', () => {
    // The case that proves nothing moves unless something moves it — which is
    // also how "nothing moves in edit mode" is true rather than arranged.
    const entity = entityTurning(90)
    stepSystems([], [entity], 1)

    expect(entity.transform.rotation).toBe(0)
  })
})

describe('what the kernel ships', () => {
  it('is one system, and that is the honest state of things', () => {
    // Not tidiness: this list growing is the kernel acquiring game features
    // ahead of a game to justify them (`genre-spinup` S1). If it ever has two,
    // the second one had better be here on purpose.
    expect(BUILT_IN_SYSTEMS.map((system) => system.id)).toEqual(['spin'])
  })
})
