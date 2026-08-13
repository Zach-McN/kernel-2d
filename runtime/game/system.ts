import type { Entity } from '../formats/scene-schema.js'

/**
 * What a system is.
 *
 * A rule that is handed the entities of a running level and how much time just
 * passed, and changes them. That is the whole interface, and the smallness is
 * the point: everything a system is *not* allowed to know is a thing that cannot
 * be got wrong later.
 *
 * A system does not read files, does not draw, does not know which level it is
 * in, does not know whether an editor exists, and is not told the wall clock —
 * only the size of one step, which is fixed (`loop.ts`). So it is an ordinary
 * function over plain objects: Vitest drives one with a clock it moves by hand,
 * in plain Node, with no browser anywhere near it.
 *
 * **The entities are a copy that lives as long as the run does.** Whoever starts
 * a level makes it (`run-level.ts`); a system may mutate it freely, and nothing
 * it does can reach the file it was read from, the editor's document store, or
 * the undo stack. That is not politeness enforced by review — it is true because
 * the object a system holds was never the object anything else holds.
 *
 * **Order is list order, and it is the caller's.** Systems run in the order they
 * were given, every step. Nothing here sorts, prioritises, or declares
 * dependencies; a game that needs its movement to run before its collision says
 * so by listing them in that order. The moment that stops being enough is the
 * moment to add something, and not before.
 *
 * **There is deliberately no registry and no extension API.** The list arrives
 * as an argument, from the one caller that has one. What a game folder's own
 * code will look like is shaped by the first game that has any (`genre-spinup`
 * S1); a general answer written now would be a guess with nothing to check it
 * against.
 */
export interface System {
  /**
   * What this system is called. Not used to look one up — the list is the list —
   * but a run that goes wrong is much easier to talk about when the systems have
   * names.
   */
  id: string
  /**
   * One step. `dtSeconds` is the fixed step size, so it is the same number every
   * time; it is passed rather than imported because a system that reads the
   * constant directly could not be tested at any other rate.
   */
  step: (entities: Entity[], dtSeconds: number) => void
}

/** Every system, in order, over the same entities. */
export function stepSystems(systems: readonly System[], entities: Entity[], dtSeconds: number): void {
  for (const system of systems) system.step(entities, dtSeconds)
}
