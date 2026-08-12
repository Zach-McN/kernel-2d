/**
 * Scene space, and how it becomes screen space. The single definition.
 *
 * A scene is authored y-up from the bottom-left corner: `y: 0` is the floor and
 * a bigger y is higher. A renderer's canvas is y-down from the top-left. The
 * flip between them happens here and nowhere else, for the same reason the
 * frame arithmetic lives in one file — two pieces of code converting the same
 * coordinate is two pieces of code that can disagree, and the symptom is a
 * sprite drawn somewhere the Inspector says it is not.
 *
 * No Phaser import here, on purpose. This is arithmetic, and arithmetic is
 * testable without a browser, a canvas or a renderer.
 *
 * The scene is drawn at 1:1 — one scene unit per CSS pixel — because there is
 * no camera yet. When one arrives it belongs in this file as a scale and an
 * offset, not as a second conversion somewhere else.
 */

export interface Point {
  x: number
  y: number
}

/**
 * Where a scene position lands on a canvas of this height, in CSS pixels.
 *
 * The height is the only thing the flip needs: x is unchanged, and y is
 * measured from the opposite edge.
 */
export function toScreenPoint(scenePoint: Point, canvasHeight: number): Point {
  return { x: scenePoint.x, y: canvasHeight - scenePoint.y }
}

/** The inverse. Its existence is what makes the flip testable as a round trip. */
export function toScenePoint(screenPoint: Point, canvasHeight: number): Point {
  return { x: screenPoint.x, y: canvasHeight - screenPoint.y }
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
