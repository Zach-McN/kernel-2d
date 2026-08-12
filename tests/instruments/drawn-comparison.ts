import { z } from 'zod'

/**
 * Comparing two pictures of one level drawn on two different surfaces.
 *
 * `editor-verification` V24 established the pattern for play mode: keep the report
 * the renderer gave for the editing view, keep the one it gave for the running level,
 * and compare them entity by entity — because everything that can go wrong between a
 * request and a picture is invisible to a diff of the requests.
 *
 * An exported game needs the same check and cannot use the same arithmetic. V24's
 * first condition is that both pictures came through the same camera onto the same
 * canvas, and an exported game is a browser window while the editor's viewport is a
 * docked panel: different sizes, so different framings, so every screen number
 * differs and none of the differences is about whether the two agree.
 *
 * So the comparison moves into **the level's own units**, where the two agree exactly
 * — a sprite's rectangle there is decided by its transform, its pivot and its frame
 * size, and by nothing about the window it is seen through. Both sides publish that
 * projection from one shared function in the runtime
 * (`runtime/scene/drawn-in-scene.ts`), so this is arithmetic over two plain lists.
 *
 * Two things kept from V24 because they are what make it a real check:
 *
 *   - **Every difference is named, never counted.** A verdict that says "3
 *     differences" is a verdict somebody has to reproduce by hand.
 *   - **A tolerance, but a tiny one.** Both numbers come out of one renderer through
 *     one projection, so a real agreement is exact; the tolerance exists only because
 *     each side made a round trip through JSON. Both edges of it are asserted in the
 *     test beside this file, or the tolerance quietly becomes the thing being tested.
 *
 * It lives in `tests/` because no product code compares itself to an editor — the same
 * line `editor/shell/play-comparison.ts` is on, one layer further out. It is parsed
 * out of JSON rather than typed against the runtime's own interface on purpose: what
 * arrives here came off a page as text, and saying so is more honest than borrowing a
 * type from a module this side of the repo cannot compile.
 */

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})

const DrawingSchema = z.array(
  z.object({
    id: z.string().min(1),
    x: z.number(),
    y: z.number(),
    bounds: RectSchema.nullable(),
  }),
)

export type Drawing = z.infer<typeof DrawingSchema>

/**
 * How far apart two numbers may be, in level units, and still count as the same.
 *
 * A thousandth of a unit. Both sides come from one renderer through one projection,
 * so agreement is exact and any real disagreement is a whole pixel or more; this is
 * only here so a value that went through `JSON.stringify` cannot fail on its last bit.
 */
const TOLERANCE = 0.001

export type DrawingComparison =
  /** Every entity in the same place, at the same size, in the same order. */
  | { kind: 'same'; count: number }
  | { kind: 'different'; differences: string[] }

/**
 * @param what how to name each side in a difference — `['the exported game', 'the editor']`.
 */
export function compareDrawings(
  a: Drawing,
  b: Drawing,
  what: readonly [string, string],
): DrawingComparison {
  const differences: string[] = []
  const [oneName, otherName] = what

  const byId = new Map(b.map((entity) => [entity.id, entity]))

  for (const entity of a) {
    const other = byId.get(entity.id)
    if (other === undefined) {
      differences.push(`${entity.id} is in ${oneName} and not in ${otherName}`)
      continue
    }

    const detail = differenceBetween(entity, other)
    if (detail !== null) differences.push(`${entity.id} ${detail}`)
  }

  const mine = new Set(a.map((entity) => entity.id))
  for (const entity of b) {
    if (!mine.has(entity.id)) {
      differences.push(`${entity.id} is in ${otherName} and not in ${oneName}`)
    }
  }

  // Draw order is part of the picture: two levels holding the same entities in a
  // different order are two different pictures wherever they overlap.
  if (differences.length === 0) {
    const left = a.map((entity) => entity.id).join(',')
    const right = b.map((entity) => entity.id).join(',')
    if (left !== right) differences.push(`the draw order differs: ${left} against ${right}`)
  }

  if (differences.length > 0) return { kind: 'different', differences }
  return { kind: 'same', count: a.length }
}

/**
 * What is different about one entity, or null. One clause per entity: a sprite drawn
 * on the wrong pivot is both in the wrong place and often a different rectangle, and
 * saying it twice would suggest two faults.
 */
function differenceBetween(a: Drawing[number], b: Drawing[number]): string | null {
  if (!near(a.x, b.x) || !near(a.y, b.y)) {
    return `is at ${round(a.x)},${round(a.y)} in the first and ${round(b.x)},${round(b.y)} in the second`
  }

  if (a.bounds === null && b.bounds === null) return null
  if (a.bounds === null) return 'has no picture in the first and has one in the second'
  if (b.bounds === null) return 'has a picture in the first and none in the second'

  if (!near(a.bounds.width, b.bounds.width) || !near(a.bounds.height, b.bounds.height)) {
    return `is ${round(a.bounds.width)}×${round(a.bounds.height)} in the first and ${round(b.bounds.width)}×${round(b.bounds.height)} in the second`
  }

  if (!near(a.bounds.x, b.bounds.x) || !near(a.bounds.y, b.bounds.y)) {
    // Same position and same size, different rectangle: the pivot moved.
    return 'sits on a different pivot in the two'
  }

  return null
}

/** One comparison, as the sentence a failing test prints. */
export function describeDrawingComparison(comparison: DrawingComparison): string {
  if (comparison.kind === 'same') {
    return comparison.count === 0
      ? 'both drew nothing at all'
      : `both drew the same ${String(comparison.count)} entities in the same places`
  }
  return comparison.differences.join('; ')
}

/** A drawing as it comes off a page: JSON text, or the value an evaluate handed back. */
export function parseDrawing(raw: unknown): Drawing {
  return DrawingSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw)
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
