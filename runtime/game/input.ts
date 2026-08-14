import type { Entity } from '../formats/scene-schema.js'

/**
 * What the player pressed, as an entity in the running level.
 *
 * A system's whole world is the entity list and the size of one step
 * (`system.ts`), and that smallness is load-bearing: it is why a system runs in
 * plain Node under a hand-moved clock. Input joins that world the only way
 * anything does — **as data on an entity** — rather than as a third parameter,
 * a registry, or anything else every existing system and test would have to
 * learn about. The runner injects one entity into the copy it steps
 * (`run-level.ts`), writes what was pressed into it before each step, and a
 * system that cares reads it with `pressedIn` exactly as it reads any other
 * component. A test hands input to a system by putting `inputEntity(['Space'])`
 * in the fixture list, which is no machinery at all.
 *
 * **Presses, not held keys.** `pressed` holds the `KeyboardEvent.code` values
 * (`'Space'`, `'KeyW'` — physical buttons, independent of keyboard layout) that
 * went down since the previous step, so a press is seen by exactly one step and
 * a system acts on it exactly once. Held state is deliberately absent: the
 * first real consumer (tower-defense's Call Wave) needs a press, and a field
 * nothing reads would be a guess about the second game (`genre-spinup` S1).
 * The day a game holds a key to aim is the day this grows, shaped by that game.
 *
 * **Clicks arrive in scene units, and that is the load-bearing choice.** A
 * system knows nothing of cameras, canvases or pixels — entities stand in
 * scene coordinates, so a click a system can compare against them must arrive
 * already converted, by the host that has the camera (the editor's play mode,
 * an exported page — each using the renderer's own report, so a click means
 * the same spot in both). `clicked` holds the points put down since the
 * previous step, same one-step discipline as presses. It arrived the way the
 * keyboard did: demanded by a real consumer, tower-defense's build-during-play.
 *
 * The entity never touches a file. A running level is a copy that is thrown
 * away at Stop, and this entity exists only inside that copy — so the `input`
 * component is run-only vocabulary, in no schema and no registry, exactly like
 * the components a game invents. A hand-typed `input` component in a scene
 * file is ignored by the reader below, which goes by the entity's id: the id
 * carries a `#`, which no minted id ever does.
 */

export const INPUT_ENTITY_ID = 'run#input'

/** A point in scene units, exactly as an entity's transform speaks them. */
export interface ScenePoint {
  x: number
  y: number
}

/** One step's worth of the player: what went down since the previous one. */
export interface InputSample {
  pressed: readonly string[]
  clicked: readonly ScenePoint[]
}

export const NOTHING: InputSample = { pressed: [], clicked: [] }

/**
 * The carrier, ready to join a running level — or a test's fixture list, which
 * is the other place input comes from and the reason this is exported.
 */
export function inputEntity(pressed: readonly string[] = [], clicked: readonly ScenePoint[] = []): Entity {
  return {
    id: INPUT_ENTITY_ID,
    name: 'Input',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { input: { pressed: [...pressed], clicked: [...clicked] } },
  }
}

/** What this step was handed. Replaces, never appends: input belongs to one step. */
export function writeInput(carrier: Entity, sample: InputSample): void {
  carrier.components['input'] = { pressed: [...sample.pressed], clicked: [...sample.clicked] }
}

/**
 * The codes pressed since the previous step, or nothing.
 *
 * Nothing covers every quiet case at once — no carrier (the runner was given no
 * input source, or a test built no entity) and a malformed component — because
 * no system could act differently on the difference, and a throw from inside a
 * step is the hardest fault to trace (the same grounds as every component
 * reader in a game folder).
 */
export function pressedIn(entities: readonly Entity[]): readonly string[] {
  const pressed: unknown = fieldOf(entities, 'pressed')
  if (!Array.isArray(pressed)) return []
  return pressed.filter((code): code is string => typeof code === 'string')
}

/** The scene points clicked since the previous step, or nothing — same grounds. */
export function clickedIn(entities: readonly Entity[]): readonly ScenePoint[] {
  const clicked: unknown = fieldOf(entities, 'clicked')
  if (!Array.isArray(clicked)) return []
  return clicked.filter(
    (point): point is ScenePoint =>
      typeof point === 'object' &&
      point !== null &&
      typeof (point as { x?: unknown }).x === 'number' &&
      typeof (point as { y?: unknown }).y === 'number',
  )
}

function fieldOf(entities: readonly Entity[], field: 'pressed' | 'clicked'): unknown {
  const carrier = entities.find((entity) => entity.id === INPUT_ENTITY_ID)
  if (carrier === undefined) return undefined

  const component: unknown = carrier.components['input']
  if (typeof component !== 'object' || component === null) return undefined
  return (component as Record<string, unknown>)[field]
}
