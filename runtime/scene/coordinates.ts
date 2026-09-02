/**
 * Scene space, how it becomes screen space, and the camera in between. The
 * single definition.
 *
 * A scene is authored y-up from the bottom-left corner: `y: 0` is the floor and
 * a bigger y is higher. A renderer's canvas is y-down from the top-left. The
 * flip between them happens here and nowhere else, for the same reason the
 * frame arithmetic lives in one file — two pieces of code converting the same
 * coordinate is two pieces of code that can disagree, and the symptom is a
 * sprite drawn somewhere the Inspector says it is not.
 *
 * The camera is a scale and an offset, and it lives here rather than in the
 * renderer on purpose. Phaser has a camera of its own and using it would be
 * less code; it would also move the authority over where things land into the
 * engine, and `getBounds()` would start answering in scene coordinates where
 * the editor's overlay needs the screen rectangle it is drawing on top of.
 * Either the overlay converts — a second conversion, which is the failure this
 * file exists to prevent — or the renderer converts back, which is this
 * arithmetic anyway with Phaser's underneath it. So it is ours.
 *
 * No Phaser import here, on purpose. This is arithmetic, and arithmetic is
 * testable without a browser, a canvas or a renderer.
 *
 * The other crossing that lives here is local-to-world: an entity attached to a
 * parent stores an offset, and `worldTransformOf` at the bottom of this file is
 * the one function that turns that into where the entity is. Same reason, same
 * file: two pieces of code composing a parent onto a child is two that can
 * disagree, and the symptom is a gizmo bug three files from the cause.
 */

import type { Transform } from '../formats/scene-schema.js'

export interface Point {
  x: number
  y: number
}

/** A canvas, in CSS pixels. */
export interface Size {
  width: number
  height: number
}

/**
 * An axis-aligned rectangle, with `x`/`y` at the corner holding the *smallest*
 * of each.
 *
 * In screen space that is the top-left corner and in scene space it is the
 * bottom-left one, because the two spaces disagree about which way y runs. That
 * is not a trap so much as the whole subject of this file: a rectangle is only
 * meaningful alongside the space it is measured in, and the functions below say
 * which they take.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where the viewport is looking.
 *
 * `focus` is the scene point sitting at the middle of the canvas, rather than
 * the one at a corner. Same information either way, but this parameterisation
 * is what makes a panel dragged wider reveal scene on both sides instead of
 * shifting everything — the middle of the panel keeps meaning the same place,
 * so the human keeps their place for free rather than by arrangement.
 *
 * Never serialized. Where somebody happened to be looking is a property of the
 * window, not of the level (`editor-ui` U8).
 */
export interface Camera {
  /** CSS pixels per scene unit. */
  scale: number
  /** The scene point at the centre of the canvas. */
  focus: Point
}

/** The camera a viewport starts with, before anything has been framed. */
export const DEFAULT_CAMERA: Camera = { scale: 1, focus: { x: 0, y: 0 } }

/** Where a scene position lands on the canvas, in CSS pixels from its top-left. */
export function toScreenPoint(scenePoint: Point, camera: Camera, canvas: Size): Point {
  return {
    x: canvas.width / 2 + (scenePoint.x - camera.focus.x) * camera.scale,
    y: canvas.height / 2 - (scenePoint.y - camera.focus.y) * camera.scale,
  }
}

/**
 * Where a screen-pinned entity lands on the canvas: an anchor given as
 * fractions of the canvas (y-up, so `(1, 1)` is the top-right corner), plus an
 * offset in scene units at the camera's scale. The camera's *focus* plays no
 * part — that is the whole of what "pinned to the screen" means — but its
 * scale does, so a pinned picture is exactly as big as the same picture in the
 * world beside it, and grows with the zoom like everything else.
 */
export function toPinnedScreenPoint(
  offset: Point,
  anchor: Point,
  camera: Camera,
  canvas: Size,
): Point {
  return {
    x: anchor.x * canvas.width + offset.x * camera.scale,
    y: (1 - anchor.y) * canvas.height - offset.y * camera.scale,
  }
}

/** The inverse of `toPinnedScreenPoint`, for a pointer landing on a pinned entity. */
export function toPinnedOffset(screenPoint: Point, anchor: Point, camera: Camera, canvas: Size): Point {
  return {
    x: (screenPoint.x - anchor.x * canvas.width) / camera.scale,
    y: ((1 - anchor.y) * canvas.height - screenPoint.y) / camera.scale,
  }
}

/** The inverse. Its existence is what makes the flip testable as a round trip. */
export function toScenePoint(screenPoint: Point, camera: Camera, canvas: Size): Point {
  return {
    x: camera.focus.x + (screenPoint.x - canvas.width / 2) / camera.scale,
    y: camera.focus.y - (screenPoint.y - canvas.height / 2) / camera.scale,
  }
}

/**
 * A rectangle on screen, expressed in scene units.
 *
 * The camera is a uniform scale, a translation and a flip, so an axis-aligned
 * screen rectangle inverts to an axis-aligned scene one exactly — which is what
 * lets the renderer report the extent of what it drew in the level's own units
 * without deriving that extent a second way.
 */
export function toSceneRect(screenRect: Rect, camera: Camera, canvas: Size): Rect {
  // The screen rectangle's bottom edge is the scene rectangle's smallest y.
  const far = toScenePoint({ x: screenRect.x, y: screenRect.y + screenRect.height }, camera, canvas)

  return {
    x: far.x,
    y: far.y,
    width: screenRect.width / camera.scale,
    height: screenRect.height / camera.scale,
  }
}

/** The smallest rectangle covering both. Neither may be empty. */
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)

  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** Whether any of this screen rectangle is on a canvas of that size. */
export function isOnScreen(screenRect: Rect, canvas: Size): boolean {
  return (
    screenRect.x < canvas.width &&
    screenRect.y < canvas.height &&
    screenRect.x + screenRect.width > 0 &&
    screenRect.y + screenRect.height > 0
  )
}

/**
 * The camera moved by a drag, in screen pixels.
 *
 * Drag right and the scene goes right, which means the camera looks further
 * left — so the focus moves against the gesture. The y term does not, because
 * the flip already reversed it.
 */
export function panBy(camera: Camera, screenDx: number, screenDy: number): Camera {
  return {
    scale: camera.scale,
    focus: {
      x: camera.focus.x - screenDx / camera.scale,
      y: camera.focus.y + screenDy / camera.scale,
    },
  }
}

/**
 * The camera at a new scale, with whatever is under this screen point left
 * exactly where it is.
 *
 * Zooming toward the cursor rather than toward the middle is what makes a wheel
 * usable for getting somewhere: the alternative is zoom in, discover the thing
 * you wanted has slid off, pan back, repeat.
 */
export function zoomAbout(camera: Camera, screenPoint: Point, scale: number, canvas: Size): Camera {
  const anchor = toScenePoint(screenPoint, camera, canvas)

  return {
    scale,
    focus: {
      x: anchor.x - (screenPoint.x - canvas.width / 2) / scale,
      y: anchor.y + (screenPoint.y - canvas.height / 2) / scale,
    },
  }
}

/**
 * A camera pointed at the middle of this content, at the scale it is given.
 *
 * Which scale that should be is not decided here: choosing it means choosing a
 * step on the zoom ladder, and the ladder is editor policy (`editor-ui` U17) in
 * a layer this one may not import from. The caller composes the two.
 *
 * Nothing to frame means an empty scene, and the honest thing to point at then
 * is the origin — which is where the first entity somebody adds will be.
 */
export function framing(content: Rect | null, scale: number): Camera {
  if (content === null) return { scale, focus: { x: 0, y: 0 } }

  return {
    scale,
    focus: { x: content.x + content.width / 2, y: content.y + content.height / 2 },
  }
}

/**
 * A focus a game asked for, held to what there is to see.
 *
 * The camera seam (`runtime/game/camera.ts`) lets a running level aim the view;
 * this is the host's half of the bargain, shared so the editor's play mode and
 * an exported page clamp identically. On each axis the view — `canvas` at
 * `scale` — is kept inside `content`; when the content is smaller than the
 * view on an axis, the view centres on it, which is the only answer that does
 * not jitter between the two edges. A null content clamps nothing, because
 * there is nothing to hold the view to.
 *
 * Both rectangles are scene-space (`Rect`'s corner is the bottom-left there).
 */
export function clampFocus(focus: Point, content: Rect | null, canvas: Size, scale: number): Point {
  if (content === null) return { x: focus.x, y: focus.y }

  const half = { x: canvas.width / 2 / scale, y: canvas.height / 2 / scale }
  const axis = (wanted: number, min: number, max: number, halfSpan: number): number => {
    if (max - min <= halfSpan * 2) return (min + max) / 2
    return Math.min(max - halfSpan, Math.max(min + halfSpan, wanted))
  }

  return {
    x: axis(focus.x, content.x, content.x + content.width, half.x),
    y: axis(focus.y, content.y, content.y + content.height, half.y),
  }
}

/**
 * The same camera, nudged by less than a pixel so the scene's origin lands on
 * the device's own pixel grid.
 *
 * Pixel art only stays crisp when one texture pixel covers a whole number of
 * device pixels *and starts on one*. A sprite drawn at a fractional position
 * with nearest-neighbour filtering samples between texels, so a 16-pixel
 * character at 4× comes out with some rows five device pixels tall and some
 * three — which reads as badly drawn art rather than as a badly placed sprite.
 * A camera's focus is fractional the moment it has been dragged, so without
 * this every pan would be a chance to blur the level.
 *
 * **Snapping the camera once rather than each sprite as it is drawn** is what
 * makes this safe to build on. Rounding every sprite's own position moves each
 * of them by its own fraction of a pixel, so the measured extent of a level
 * comes out slightly different depending on how far in you happen to be zoomed
 * — and framing then stops being idempotent, which shows up as pressing the
 * frame key twice and getting two different zooms. Adjusting the camera instead
 * keeps every distance between entities exact, so the level's extent is the
 * same measurement wherever it is measured from.
 *
 * The residue, stated so nobody looks for a bug in it: an entity at a
 * fractional position is still drawn at a fractional position, and is still
 * blurry. That is the designer's own number, honestly rendered.
 */
export function snapCamera(camera: Camera, canvas: Size, pixelRatio: number): Camera {
  const origin = toScreenPoint({ x: 0, y: 0 }, camera, canvas)
  const snapped = {
    x: Math.round(origin.x * pixelRatio) / pixelRatio,
    y: Math.round(origin.y * pixelRatio) / pixelRatio,
  }

  return {
    scale: camera.scale,
    focus: {
      x: (canvas.width / 2 - snapped.x) / camera.scale,
      y: (snapped.y - canvas.height / 2) / camera.scale,
    },
  }
}

/**
 * A scene rotation as the renderer wants it.
 *
 * Scenes record degrees counter-clockwise, which is what positive means when y
 * points up. Screen space has y pointing down, so the same visual rotation is
 * the negative angle there. Converting in one named function — rather than
 * writing a minus sign at the call site — is what stops the sign being
 * rediscovered, wrongly, by the next thing that needs it.
 *
 * Written out rather than reaching for `Phaser.Math.DegToRad`, so this module
 * stays free of Phaser and testable on its own.
 */
export function toScreenRadians(degreesCounterClockwise: number): number {
  // Subtracted from zero rather than negated with a unary minus, which would
  // turn an unrotated entity's 0 into -0. Nothing downstream is hurt by -0
  // today, and everything that compares angles with `Object.is` or writes one
  // to JSON would be.
  return 0 - (degreesCounterClockwise * Math.PI) / 180
}

// --- where an entity is, when it has a parent ------------------------------

/**
 * The part of an entity this module needs to place it: its id, the id of what
 * it is attached to, and its stored transform. An `Entity` satisfies it; the
 * type is structural so this arithmetic never imports the format.
 */
export interface Placed {
  id: string
  parent?: string | undefined
  transform: Transform
}

/**
 * A child's stored transform put onto its parent's, giving the child's own.
 *
 * Translate, rotate, scale — the offset is scaled by the parent, turned by the
 * parent's rotation (counter-clockwise, y-up, the same matrix a group turn
 * uses), then added to the parent's position; rotations add; scales multiply
 * per axis. **The one place a parent is composed onto a child** (editor-kernel
 * D37); `localTransformOf` is its inverse and nothing else may do either.
 *
 * Three things this deliberately approximates, stated so nobody looks for a bug
 * in them. A rotated child of a parent scaled unevenly would need a shear that
 * neither a transform nor a drawn image can hold, so it is drawn as the nearest
 * rotate-and-scale. A mirrored parent (a negative scale) does not reverse the
 * direction its children turn. And a parent scaled to zero on an axis collapses
 * its children on that axis, which is honest — the inverse cannot undo it,
 * because the information is gone.
 */
export function composeTransform(parent: Transform, local: Transform): Transform {
  const radians = (parent.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = local.x * parent.scaleX
  const dy = local.y * parent.scaleY

  return {
    x: parent.x + dx * cos - dy * sin,
    y: parent.y + dx * sin + dy * cos,
    rotation: parent.rotation + local.rotation,
    scaleX: parent.scaleX * local.scaleX,
    scaleY: parent.scaleY * local.scaleY,
  }
}

/**
 * The stored transform that would put an entity *here* under *this* parent —
 * the inverse of `composeTransform`, for attaching something without moving it
 * and for a gesture that works in the level's space and writes a child's.
 *
 * A parent scale of zero on an axis is divided by as if it were one: the
 * forward composition has already collapsed that axis, so there is no offset
 * that lands anywhere in particular, and writing `Infinity` or `NaN` into a
 * level would make the file unreadable on its next open (`.finite()`).
 */
export function localTransformOf(world: Transform, parentWorld: Transform): Transform {
  const radians = (parentWorld.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = world.x - parentWorld.x
  const dy = world.y - parentWorld.y
  const scaleX = parentWorld.scaleX === 0 ? 1 : parentWorld.scaleX
  const scaleY = parentWorld.scaleY === 0 ? 1 : parentWorld.scaleY

  return {
    x: (dx * cos + dy * sin) / scaleX,
    y: (dy * cos - dx * sin) / scaleY,
    rotation: world.rotation - parentWorld.rotation,
    scaleX: world.scaleX / scaleX,
    scaleY: world.scaleY / scaleY,
  }
}

/**
 * The entity, then its parent, then that one's parent, up to the root.
 *
 * Stops at a parent that is not in the list — the entity below it is then the
 * root, placed by its own numbers. **A chain that loops answers with the entity
 * alone**, whichever member of the loop is asked about, so every entity in a
 * cycle (and everything hanging off one) is placed by its own numbers rather
 * than some of them composing onto others depending on where the walk began.
 */
export function lineageOf<T extends Placed>(entity: T, entities: readonly T[]): T[] {
  return lineageIn(entity, byIdOf(entities))
}

function byIdOf<T extends Placed>(entities: readonly T[]): Map<string, T> {
  const byId = new Map<string, T>()
  for (const entity of entities) byId.set(entity.id, entity)
  return byId
}

function lineageIn<T extends Placed>(entity: T, byId: ReadonlyMap<string, T>): T[] {
  const chain = [entity]
  const seen = new Set([entity.id])
  let current = entity
  while (current.parent !== undefined) {
    const parent = byId.get(current.parent)
    if (parent === undefined) break
    if (seen.has(parent.id)) return [entity]
    seen.add(parent.id)
    chain.push(parent)
    current = parent
  }
  return chain
}

/**
 * Where an entity actually is: its stored transform composed onto its parent's,
 * and that onto its parent's, up to the root.
 *
 * **The one question every reader asks instead of reading `entity.transform`**
 * (editor-kernel D37). For an entity with no parent the answer is its own
 * transform and a reader can tell no difference; for a child it is the only
 * right answer, and a system judging contact with something riding a turning
 * arm is right for the same reason and on the same day the arm learned to
 * carry it. Exported to a game's own code through `runtime/game/api.ts`.
 */
export function worldTransformOf<T extends Placed>(entity: T, entities: readonly T[]): Transform {
  return worldAlong(lineageOf(entity, entities))
}

/**
 * The same answer for every entity in one pass, for the renderer — each
 * ancestor is composed once and remembered, rather than walked again for every
 * entity below it on every frame.
 */
export function worldTransformsOf<T extends Placed>(entities: readonly T[]): Map<string, Transform> {
  const byId = byIdOf(entities)
  const worlds = new Map<string, Transform>()

  for (const entity of entities) {
    if (worlds.has(entity.id)) continue
    const lineage = lineageIn(entity, byId)
    // Root first, composing downward; anything already answered is taken as
    // it stands, and everything below it is answered on the way past.
    let world: Transform | null = null
    for (let at = lineage.length - 1; at >= 0; at -= 1) {
      const one = lineage[at] as T
      const known = worlds.get(one.id)
      world = known ?? (world === null ? { ...one.transform } : composeTransform(world, one.transform))
      worlds.set(one.id, world)
    }
  }

  return worlds
}

/**
 * How far below the top level each entity sits — 0 for a root, 1 for its child
 * — for the list that indents its rows. An entity in a loop answers 0, because
 * that is where it is placed.
 */
export function depthsOf<T extends Placed>(entities: readonly T[]): Map<string, number> {
  const byId = byIdOf(entities)
  const depths = new Map<string, number>()
  for (const entity of entities) depths.set(entity.id, lineageIn(entity, byId).length - 1)
  return depths
}

function worldAlong(lineage: readonly Placed[]): Transform {
  let world: Transform = { ...(lineage[lineage.length - 1] as Placed).transform }
  for (let at = lineage.length - 2; at >= 0; at -= 1) {
    world = composeTransform(world, (lineage[at] as Placed).transform)
  }
  return world
}
