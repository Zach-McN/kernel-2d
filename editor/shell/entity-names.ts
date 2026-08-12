/**
 * Naming a thing that has just been made, without taking a name already in use.
 *
 * Three of these had grown, in two files: one for a new entity, one for a copy,
 * one for a placed instance. They differed in exactly two ways — where the stem
 * comes from, and what number to start counting at — and were otherwise the same
 * loop written out three times.
 *
 * Names are **not** identifiers. Two entities may share one, and the id is what
 * anything actually refers to (`runtime/formats/scene-schema.ts`). This exists
 * for the human reading a list, which is why it is here in the editor rather
 * than in the format: fifty rows all reading "Slime" is a list nobody can use,
 * and that is a UI problem, not a data one.
 */

/** Every name already in use, for the callers below. */
export function namesIn(entities: readonly { name: string }[]): ReadonlySet<string> {
  return new Set(entities.map((entity) => entity.name))
}

/**
 * The first free name of the form `stem`, `stem 2`, `stem 3`, …
 *
 * `from` is where the counting starts, and it is the only real difference
 * between the callers: a copy counts from 2 because there is already a first
 * one, and a fresh entity counts from the length of the list so a scene of five
 * offers "Entity 6" rather than walking up from one.
 *
 * `bare` decides whether the unnumbered stem is offered first. A placed prefab
 * wants "Slime" before "Slime 2"; a copy of something never does, because the
 * original already has that name.
 */
export function freeName(
  taken: ReadonlySet<string>,
  stem: string,
  { from = 2, bare = false }: { from?: number; bare?: boolean } = {},
): string {
  if (bare && !taken.has(stem)) return stem
  for (let n = from; ; n += 1) {
    const name = `${stem} ${n}`
    if (!taken.has(name)) return name
  }
}

/** The stem of a name, with any trailing number taken off: `Slime 3` → `Slime`. */
export function stemOfName(name: string): string {
  return name.replace(/ \d+$/, '')
}
