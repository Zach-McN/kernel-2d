import type { Entity } from '../formats/scene-schema.js'

/**
 * What the game remembers between runs — and which scene is running.
 *
 * A running level is a copy that dies at Stop, which is exactly right for
 * everything except the handful of facts a game means to keep: which levels
 * are done, mostly. Those facts cross the seam the way input does, **as data
 * on an entity** the runner injects (`run-level.ts`): the host recalls them
 * from wherever it keeps things (the browser's local storage, in both the
 * editor and an exported page) and the runner writes back whatever the run
 * `learn`s. A system reads a fact with `factOf` and states one with `learn`,
 * and never knows where they sleep.
 *
 * **The carrier also says which scene this run is.** A system cannot know its
 * own file name any other way — the entity list is its whole world — and the
 * first consumer needs it twice over: victory records "this level is done"
 * under a name the level-select scene can look up, and the natural name is
 * the scene's own path. The host states it; the game reads it with `sceneIn`.
 *
 * Facts are a flat name-to-value map and the values must survive JSON, since
 * every host keeps them as text. The whole map should stay small — it is a
 * memory, not a save file; the day a game wants an inventory is the day this
 * seam is re-asked, by that game.
 */

export const STORY_ENTITY_ID = 'run#story'

/** The carrier, ready to join a running level — or a test's fixture list. */
export function storyEntity(scene: string, facts: Record<string, unknown> = {}): Entity {
  return {
    id: STORY_ENTITY_ID,
    name: 'Story',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { story: { scene, facts: { ...facts } } },
  }
}

/** The project-relative path of the scene this run is, or null with no carrier. */
export function sceneIn(entities: readonly Entity[]): string | null {
  const story = storyOf(entities)
  if (story === null) return null
  const scene: unknown = story['scene']
  return typeof scene === 'string' && scene.length > 0 ? scene : null
}

/** Everything remembered, or an empty map — a game with no memory yet is not a fault. */
export function factsIn(entities: readonly Entity[]): Record<string, unknown> {
  const story = storyOf(entities)
  if (story === null) return {}
  const facts: unknown = story['facts']
  if (typeof facts !== 'object' || facts === null || Array.isArray(facts)) return {}
  return facts as Record<string, unknown>
}

/** One remembered fact, or undefined — absent and never-stated look the same. */
export function factOf(entities: readonly Entity[], name: string): unknown {
  return factsIn(entities)[name]
}

/**
 * States a fact, replacing what was there. Quiet with no carrier — a system
 * learning things in a test that built no story entity is a system that
 * remembers nothing, not one that throws (the component-reader rule).
 */
export function learn(entities: readonly Entity[], name: string, value: unknown): void {
  const carrier = entities.find((entity) => entity.id === STORY_ENTITY_ID)
  if (carrier === undefined) return
  const story = storyOf(entities)
  if (story === null) return
  const facts: unknown = story['facts']
  const held = typeof facts === 'object' && facts !== null && !Array.isArray(facts) ? (facts as Record<string, unknown>) : {}
  held[name] = value
  carrier.components['story'] = { ...story, facts: held }
}

function storyOf(entities: readonly Entity[]): Record<string, unknown> | null {
  const carrier = entities.find((entity) => entity.id === STORY_ENTITY_ID)
  if (carrier === undefined) return null
  const component: unknown = carrier.components['story']
  if (typeof component !== 'object' || component === null) return null
  return component as Record<string, unknown>
}
