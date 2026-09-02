import { toScenePoint, toSceneRect, type Rect } from './coordinates'
import type { ShownScene } from './scene-view'

/**
 * What was drawn, in the level's own units instead of in screen pixels.
 *
 * The renderer reports where each sprite landed on the canvas, which is the right
 * answer for anything drawn *over* that canvas — an outline, a crosshair, a frame
 * guide. It is the wrong answer for comparing **two pictures of one level on two
 * different surfaces**, which is what an exported game and the editor's viewport
 * are: different sizes, so different framings, so every screen number differs and
 * none of the differences is about whether the two agree.
 *
 * In the level's units they agree exactly, because a sprite's rectangle there is
 * decided by its transform, its pivot and its frame size and by nothing about the
 * window it is being looked at through.
 *
 * Two things make this a projection rather than a second derivation, which is the
 * distinction that matters (`editor-kernel` D2, `editor-ui` U16):
 *
 *   - It inverts the rectangles the renderer **reported**. It never goes back to
 *     the transforms and works them out again; two derivations of one geometry are
 *     two answers that agree until they don't.
 *   - It inverts through `drawnWith`, the pixel-snapped camera the renderer
 *     actually used, so the inversion is exact. Inverting through `camera` — the
 *     one that was *asked* for — is off by the sub-pixel nudge that keeps pixel
 *     art crisp, which at 8× is an eighth of a level unit: small enough to look
 *     like a rounding artefact and large enough to fail a comparison.
 *
 * One function, called by the editor's viewport and by the exported game, so
 * "what did you draw" has one answer on both sides of the export.
 */

export interface DrawnInScene {
  id: string
  /** Where the entity is, in level units — its position in the level (composed onto its parent's, when it has one), round-tripped. */
  x: number
  y: number
  /**
   * What it covers, in level units, or null when it had nothing to draw — a
   * missing texture, or an entity with no sprite at all.
   */
  bounds: Rect | null
  /**
   * How solidly it was drawn, when that is not fully — carried straight
   * through from the renderer's own read-back, because it is the one thing
   * about a sprite that no rectangle can show. Absent means solid, so a level
   * with nothing faded in it projects exactly as it did before.
   */
  opacity?: number
}

/** In list order, which is draw order. */
export function inSceneUnits(shown: ShownScene): DrawnInScene[] {
  return shown.entities.map((entity) => {
    const position = toScenePoint(entity.origin, shown.drawnWith, shown.canvasSize)

    return {
      id: entity.id,
      x: position.x,
      y: position.y,
      bounds:
        entity.bounds === null ? null : toSceneRect(entity.bounds, shown.drawnWith, shown.canvasSize),
      ...(entity.opacity === undefined ? {} : { opacity: entity.opacity }),
    }
  })
}
