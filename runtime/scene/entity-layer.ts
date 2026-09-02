import * as Phaser from 'phaser'

import type { Pivot } from '../formats/meta-schema'
import { screenOf, spriteOf, type Entity, type ScreenComponent } from '../formats/scene-schema'
import {
  lineageOf,
  toPinnedScreenPoint,
  toScreenPoint,
  toScreenRadians,
  worldTransformsOf,
  type Camera,
  type Size,
} from './coordinates'

/**
 * The entity layer: a set of drawn objects kept in step with a list of
 * entities.
 *
 * This is the part of the runtime that turns documents into things on screen.
 * It is deliberately not a scene *loader* that builds everything from scratch —
 * it is a `sync`, matching by id, creating what is new, updating what moved and
 * destroying what is gone. The difference matters at both ends of the tool's
 * life: in the editor it is what makes typing an X move a sprite instead of
 * reloading a level per keystroke, and in a shipped game it is what a save-game
 * restore or a streamed chunk will want. Rebuilding would be simpler and would
 * be the reason the editor stutters later, when nobody remembers why.
 *
 * Where a sprite sits is decided in exactly two places, both of them elsewhere:
 * the camera and the y-up flip in `coordinates.ts`, and the pivot in the
 * texture's `.meta`. This file reads both and invents neither. Where an
 * *entity* is — its own transform composed onto its parent's, when it has one —
 * is the same module's `worldTransformsOf` (editor-kernel D37); nothing here
 * reads `entity.transform` to decide where to draw.
 */

/** What an entity should draw, once its texture has been resolved. */
export interface ResolvedSprite {
  /** The key the texture is registered under in this renderer. */
  textureKey: string
  /** The frame to draw — the first one when the texture is sliced. */
  frame: string
  /** From the texture's `.meta`. The only definition of where the sprite sits. */
  pivot: Pivot
}

/** Answers what an entity draws, or null when it draws nothing. */
export type ResolveSprite = (entity: Entity) => ResolvedSprite | null

/**
 * What was drawn, per entity, in CSS pixels from the canvas's top-left.
 *
 * Reported rather than left to be worked out again, because the overlay that
 * outlines the selected entity has to line up with the picture exactly, and two
 * pieces of code deriving the same rectangle is two pieces of code that can
 * disagree with nothing on screen saying so (editor-kernel D2).
 */
export interface DrawnEntity {
  id: string
  /** Where the entity's position in the level — composed onto its parent's, when it has one — landed. Always reported. */
  origin: { x: number; y: number }
  /** The rectangle it covers, or null when it draws nothing at all. */
  bounds: { x: number; y: number; width: number; height: number } | null
  /**
   * Set when the entity is pinned to the screen (`screen` component) rather
   * than standing in the world. Reported so that anything measuring *the
   * level* — the extent that framing and an exported page's fit read — can
   * leave it out: a counter in the corner is not part of how wide a level is,
   * and framing that chased it would never settle.
   */
  pinned?: true
  /**
   * How solidly it was drawn, **read back off the drawn object** rather than
   * echoed from the component (phaser4-runtime P4) — and present only when it
   * is not fully solid, so the ordinary entity's report is exactly what it was
   * before this existed. A faded sprite is otherwise invisible to every
   * instrument the editor has: it lands in the same place and covers the same
   * rectangle.
   */
  opacity?: number
}

export interface EntityLayer {
  /**
   * Brings the drawn objects into line with this list, in this order.
   *
   * Draw order is list order: the first entity is furthest back. That is the
   * scene format's rule and this is where it is honoured — `setDepth(index)`,
   * nothing else.
   */
  sync: (
    entities: readonly Entity[],
    resolve: ResolveSprite,
    camera: Camera,
    canvas: Size,
    pixelRatio: number,
  ) => DrawnEntity[]
  /** Removes everything. Used when no scene is open. */
  clear: () => void
}

/**
 * How solidly to draw this entity: its sprite's `opacity`, clamped to what an
 * alpha can be, and 1 for an entity that never mentioned it.
 */
function opacityOf(entity: Entity): number {
  const wanted = spriteOf(entity)?.opacity
  if (wanted === undefined) return 1
  return Math.min(1, Math.max(0, wanted))
}

/**
 * Whether this entity is pinned to the screen, and to which corner: its own
 * `screen` component, or the nearest one above it. A child of a pinned counter
 * rides the counter — its composed transform is then the offset from the
 * counter's corner — and an entity pinned itself with no parent is exactly what
 * it always was.
 */
function pinOf(entity: Entity, entities: readonly Entity[]): ScreenComponent | null {
  for (const one of lineageOf(entity, entities)) {
    const pin = screenOf(one)
    if (pin !== null) return pin
  }
  return null
}

export function createEntityLayer(scene: Phaser.Scene): EntityLayer {
  const drawn = new Map<string, Phaser.GameObjects.Image>()

  const clear = (): void => {
    for (const image of drawn.values()) image.destroy()
    drawn.clear()
  }

  return {
    clear,

    sync: (entities, resolve, camera, canvas, pixelRatio) => {
      const living = new Set(entities.map((entity) => entity.id))
      for (const [id, image] of [...drawn]) {
        if (living.has(id)) continue
        image.destroy()
        drawn.delete(id)
      }

      // Every entity's place in the level, answered once for the whole list
      // (editor-kernel D37): a child's stored transform is an offset from its
      // parent, and this is the one place that turns it into a position.
      const worlds = worldTransformsOf(entities)

      return entities.map((entity, index) => {
        // The camera arrives already sitting on the device's pixel grid, so
        // nothing is rounded here. Rounding each sprite individually would keep
        // the art just as crisp and would make the distance between two
        // entities depend on the zoom, which is a worse trade than it sounds
        // (see `snapCamera`).
        // A pinned entity is placed against the canvas and ignores where the
        // camera is looking; everything else is placed through the camera.
        const pin = pinOf(entity, entities)
        const world = worlds.get(entity.id) ?? entity.transform
        const position =
          pin === null
            ? toScreenPoint(world, camera, canvas)
            : toPinnedScreenPoint(world, pin.anchor, camera, canvas)
        const sprite = resolve(entity)

        if (sprite === null) {
          // An entity with no sprite — one just added, or one whose texture is
          // not in the project — is still somewhere. Its position is reported
          // so the editor can mark the spot rather than leaving it nowhere.
          const existing = drawn.get(entity.id)
          if (existing !== undefined) {
            existing.destroy()
            drawn.delete(entity.id)
          }
          return { id: entity.id, origin: position, bounds: null, ...(pin === null ? {} : { pinned: true }) }
        }

        let image = drawn.get(entity.id)
        if (image === undefined) {
          image = scene.add.image(0, 0, sprite.textureKey, sprite.frame)
          drawn.set(entity.id, image)
        } else {
          // `setTexture` with the frame rather than a rebuild: swapping what an
          // Image points at costs nothing, and the alternative churns a display
          // object every time a texture is re-sliced.
          image.setTexture(sprite.textureKey, sprite.frame)
        }

        image
          .setOrigin(sprite.pivot.x, sprite.pivot.y)
          .setPosition(position.x * pixelRatio, position.y * pixelRatio)
          .setRotation(toScreenRadians(world.rotation))
          // The entity's own scale times the camera's: how big the designer
          // made it, and how close the viewport is standing.
          .setScale(world.scaleX * camera.scale * pixelRatio, world.scaleY * camera.scale * pixelRatio)
          .setDepth(index)
          // Clamped here rather than refused by the schema: an opacity outside
          // 0..1 is a typo, and a failed component parse would take the whole
          // sprite away, which is a much worse answer to a typo than drawing
          // it solid. Always set, so an entity that stops being faint goes
          // back to solid rather than keeping the alpha it had last frame.
          .setAlpha(opacityOf(entity))

        // Read back off the object rather than recomputed from the transform,
        // so the rectangle handed out is the one the renderer is actually
        // using — the same instinct as reading a filter off a live texture
        // (phaser4-runtime P4).
        const bounds = image.getBounds()

        return {
          id: entity.id,
          origin: position,
          bounds: {
            x: bounds.x / pixelRatio,
            y: bounds.y / pixelRatio,
            width: bounds.width / pixelRatio,
            height: bounds.height / pixelRatio,
          },
          ...(pin === null ? {} : { pinned: true as const }),
          ...(image.alpha === 1 ? {} : { opacity: image.alpha }),
        }
      })
    },
  }
}
