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
 */

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
