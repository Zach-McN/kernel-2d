import type { Entity } from '../formats/scene-schema.js'
import type { ScenePoint } from './input.js'

/**
 * A game steering the camera.
 *
 * A system's whole world is the entity list (`system.ts`), and where the
 * viewport looks is the one thing about a running picture that world cannot
 * contain: the canvas, the zoom and the drawing all belong to the host — the
 * editor's play mode, or an exported page. So the ask crosses the seam the way
 * the door does (`door.ts`), **as data on an entity**: a system that wants the
 * view somewhere calls `aimCamera` every step it cares, and the runner
 * (`run-level.ts`) reads the ask each frame that moved and tells the host
 * before the frame is drawn, so the picture and the viewpoint move together.
 * The first real consumer is the platformer's camera follow — a level wider
 * than the screen, watched through a window that chases the player.
 *
 * **The ask is a focus, and only a focus** — the scene point the game wants at
 * the middle of the canvas, in the same units every entity stands in. The
 * *scale* stays the host's: the editor draws at whatever zoom the human chose,
 * an exported page at the fit it framed, and a game that dictated pixels per
 * unit would be a game that knows how big a canvas is, which is exactly what a
 * system may not know. For the same reason the host is free to clamp the ask —
 * a camera aimed past the edge of the level is aimed at the edge
 * (`clampFocus` in `runtime/scene/coordinates.ts` is that arithmetic, shared
 * so both hosts clamp identically).
 *
 * A run whose host takes no camera leaves the ask standing in the level, which
 * is how a game's own tests assert "the camera chases the ninja" with no host,
 * no canvas and no renderer anywhere near them.
 */

export const CAMERA_ENTITY_ID = 'run#camera'

/** Asks the host to centre the view here. One ask stands at a time; asking again re-aims it. */
export function aimCamera(entities: Entity[], focus: ScenePoint): void {
  const standing = entities.find((entity) => entity.id === CAMERA_ENTITY_ID)
  if (standing !== undefined) {
    standing.components['camera'] = { focus: { x: focus.x, y: focus.y } }
    return
  }
  entities.push({
    id: CAMERA_ENTITY_ID,
    name: 'Camera',
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { camera: { focus: { x: focus.x, y: focus.y } } },
  })
}

/** Where the game is asking the view to look, or null when nothing is asking (or the ask is mangled). */
export function cameraIn(entities: readonly Entity[]): ScenePoint | null {
  const standing = entities.find((entity) => entity.id === CAMERA_ENTITY_ID)
  if (standing === undefined) return null

  const component: unknown = standing.components['camera']
  if (typeof component !== 'object' || component === null) return null
  const focus: unknown = (component as { focus?: unknown }).focus
  if (typeof focus !== 'object' || focus === null) return null
  const { x, y } = focus as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  if (typeof y !== 'number' || !Number.isFinite(y)) return null
  return { x, y }
}
