// Imported from the modules themselves rather than through `runtime/index.ts`,
// and that is not a style choice. The barrel re-exports the renderers, so
// touching it loads Phaser — which needs a browser, and which would put this
// module out of reach of a unit test that has no business booting one. The
// three types below are erased entirely; only `isOnScreen` survives, and its
// module imports nothing at all.
import { isOnScreen, type Point, type Rect } from '../../runtime/scene/coordinates'
import type { DrawnEntity } from '../../runtime/scene/entity-layer'
import type { ShownScene } from '../../runtime/scene/scene-view'

/**
 * Questions about the picture the renderer just drew.
 *
 * Three of them now — what rectangle an entity covers, which entities are
 * actually on the canvas, and which one is under the pointer — and they live
 * together because they are the same question asked three ways. Picking is the
 * one that makes it matter: if what you can click were worked out separately
 * from what gets outlined, the two would agree until they didn't, and the
 * symptom would be clicking a sprite and selecting its neighbour.
 *
 * Everything here is in CSS pixels from the canvas's top-left, which is the
 * space the renderer reports in (`editor-kernel` D2). No camera is needed to
 * answer any of it: the camera's work is already done by the time these
 * rectangles exist.
 */

/**
 * Where an entity landed, as a rectangle.
 *
 * An entity with nothing to draw is a point rather than a box — it is still
 * somewhere, and treating it as nowhere would leave it unframeable and
 * unclickable. Callers that need to *touch* one give it a tolerance.
 */
export function screenRectOf(entity: DrawnEntity): Rect {
  return entity.bounds ?? { x: entity.origin.x, y: entity.origin.y, width: 0, height: 0 }
}

/** Which entities are on the canvas at all, and how many. */
export function onScreen(shown: ShownScene): { count: number; ids: ReadonlySet<string> } {
  const ids = new Set<string>()
  for (const entity of shown.entities) {
    if (isOnScreen(screenRectOf(entity), shown.canvasSize)) ids.add(entity.id)
  }

  return { count: ids.size, ids }
}

/**
 * How close the pointer has to be to an entity with no picture before it counts
 * as being on it, in CSS pixels.
 *
 * Only ever applied to a point-sized entity. Growing every sprite's hit area by
 * a few pixels would make two sprites that are merely near each other overlap
 * for picking purposes, and then which one you get stops matching what you see.
 */
export const PICK_TOLERANCE = 6

/**
 * The entity under a point on the canvas, or null.
 *
 * Searched from the back of the list forwards, because list order is draw order
 * and the one drawn last is the one on top — which is the one the human was
 * pointing at. The rectangle tested is the same one the selection outline draws,
 * so a click can never disagree with what is on screen. A rotated sprite is
 * therefore slightly generous at its corners, which is the price of not keeping
 * a second opinion about where a sprite is.
 */
export function entityAt(shown: ShownScene, at: Point): string | null {
  for (let index = shown.entities.length - 1; index >= 0; index -= 1) {
    const entity = shown.entities[index]
    if (entity === undefined) continue

    const rect = screenRectOf(entity)
    const grow = entity.bounds === null ? PICK_TOLERANCE : 0

    if (
      at.x >= rect.x - grow &&
      at.x <= rect.x + rect.width + grow &&
      at.y >= rect.y - grow &&
      at.y <= rect.y + rect.height + grow
    ) {
      return entity.id
    }
  }

  return null
}
