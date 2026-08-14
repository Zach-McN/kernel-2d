import type { Entity } from '../formats/scene-schema.js'

/**
 * A game asking to be somewhere else.
 *
 * A system's whole world is the entity list (`system.ts`), and opening another
 * scene is the one thing that world cannot contain: which file to read, how to
 * load it and what to do with the current run all belong to the host — the
 * editor's play mode, or an exported page. So the request crosses the seam the
 * same way input does, **as data on an entity**: a system that wants to leave
 * pushes the door entity with `openDoor`, and the runner (`run-level.ts`)
 * takes it at the end of the frame and tells the host, which stops this run
 * and starts the named scene. The first real consumer is tower-defense's
 * level select — a menu scene whose banners open levels — and the seam is
 * exactly as big as that demanded: one scene path, no payload, no answer.
 *
 * A run whose host was given no door handler keeps the entity where a test
 * can read it with `doorIn`, which is also how a game's own suite asserts
 * "clicking the banner asks for level two" with no host anywhere.
 *
 * The path is the scene's project-relative path (`scenes/level-02.json`),
 * because that is the one name a scene already has everywhere — in the level
 * select's own content, in `project.json`, and on the host's loader. A wrong
 * path is the host's to refuse; the seam carries it without judging it.
 */

export const DOOR_ENTITY_ID = 'run#door'

/** Asks the host to open the named scene. One door per run; a second ask rewrites it. */
export function openDoor(entities: Entity[], scene: string): void {
  const standing = entities.find((entity) => entity.id === DOOR_ENTITY_ID)
  if (standing !== undefined) {
    standing.components['door'] = { scene }
    return
  }
  entities.push({
    id: DOOR_ENTITY_ID,
    name: 'Door',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { door: { scene } },
  })
}

/** The scene asked for, or null when nothing is asking (or the ask is mangled). */
export function doorIn(entities: readonly Entity[]): string | null {
  const standing = entities.find((entity) => entity.id === DOOR_ENTITY_ID)
  if (standing === undefined) return null

  const component: unknown = standing.components['door']
  if (typeof component !== 'object' || component === null) return null
  const scene: unknown = (component as { scene?: unknown }).scene
  return typeof scene === 'string' && scene.length > 0 ? scene : null
}

/** The runner's half: reads the ask and removes it, so a door opens exactly once. */
export function takeDoor(entities: Entity[]): string | null {
  const scene = doorIn(entities)
  const at = entities.findIndex((entity) => entity.id === DOOR_ENTITY_ID)
  if (at !== -1) entities.splice(at, 1)
  return scene
}
