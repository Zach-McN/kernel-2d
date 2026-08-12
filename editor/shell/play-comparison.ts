import type { DrawnEntity, ShownScene } from '../../runtime'

/**
 * Checking that the running level looks like the one that was being edited.
 *
 * `editor-kernel` D2 claims the editor's preview "cannot lie" because there is
 * only one renderer. That was true of the *renderer* and never checked of
 * everything upstream of it — the editor resolved a level one way and, as of
 * play mode, the runtime resolves it another. Two derivations of what a level
 * contains is exactly the failure D25 warns about, and it is invisible: both
 * pictures look like levels.
 *
 * So it is checked, rather than argued for. The renderer already reports what it
 * actually drew — which entity, at which point on the canvas, covering which
 * rectangle — so the editor keeps the report from the moment before Play and
 * compares it with the running level's, thing by thing. A divergence is named in
 * the viewport and fails the test suite, instead of being left for somebody to
 * notice.
 *
 * **Why this compares the drawn report rather than the two requests.** The
 * request is the input; the report is the picture. Comparing inputs would miss
 * everything that happens between them — a pivot applied differently, a frame
 * cut differently, a texture that failed to decode on one side. Those are
 * precisely the cases where the two loaders could disagree.
 *
 * This lives in the editor, not the runtime: no shipped game compares itself to
 * an editor, and a comparison in `runtime/` would be editor chrome inside the
 * layer that ships (D1). It is the same line the frame guides are on.
 */

export type PlayComparison =
  /** Every entity drawn in the same place, at the same size. */
  | { kind: 'same'; count: number }
  | { kind: 'different'; differences: Difference[] }
  /** The two pictures are not of the same thing, so comparing them would mislead. */
  | { kind: 'unavailable'; why: string }

export interface Difference {
  /** The entity's id, or null for a difference about the level as a whole. */
  entity: string | null
  /** One clause, to be joined into a sentence by whoever is showing it. */
  detail: string
}

/**
 * How far apart two positions may be and still count as the same.
 *
 * Both numbers come out of the same renderer through the same camera, so a real
 * agreement is exact and any real disagreement is whole pixels. This exists only
 * so that a value that made a round trip through JSON — which the play request
 * does, through the service — cannot fail on the last bit of a float.
 */
const TOLERANCE = 0.001

/**
 * @param names entity id to the name the human gave it, so the sentences read
 *   "Knight" rather than an id. Names come from the level being edited, which is
 *   the copy the human is looking at.
 */
export function comparePictures(
  editing: ShownScene,
  playing: ShownScene,
  names: ReadonlyMap<string, string>,
): PlayComparison {
  // Both reports have to be of the same level, through the same camera, onto the
  // same canvas. Otherwise the differences would all be real and none of them
  // would be about what this is checking — a panel resized mid-play is the
  // ordinary way to get here.
  if (editing.path !== playing.path) {
    return { kind: 'unavailable', why: 'the level changed while it was running' }
  }
  if (!sameSize(editing.canvasSize, playing.canvasSize)) {
    return { kind: 'unavailable', why: 'the panel changed size while it was running' }
  }
  if (!sameCamera(editing.camera, playing.camera)) {
    return { kind: 'unavailable', why: 'the view moved while it was running' }
  }

  const differences: Difference[] = []
  const before = new Map(editing.entities.map((one) => [one.id, one]))
  const after = new Map(playing.entities.map((one) => [one.id, one]))
  const nameOf = (id: string): string => names.get(id) ?? id

  for (const [id, drawn] of before) {
    const played = after.get(id)
    if (played === undefined) {
      differences.push({ entity: id, detail: `${nameOf(id)} is missing` })
      continue
    }
    const detail = differenceBetween(drawn, played)
    if (detail !== null) differences.push({ entity: id, detail: `${nameOf(id)} ${detail}` })
  }

  for (const id of after.keys()) {
    if (!before.has(id)) differences.push({ entity: id, detail: `${nameOf(id)} is here and was not` })
  }

  if (differences.length > 0) return { kind: 'different', differences }
  return { kind: 'same', count: after.size }
}

/**
 * What is different about one entity, or null.
 *
 * Position is reported before size because it is the one a human can see, and
 * only one clause is produced per entity: a sprite drawn with the wrong pivot is
 * both in the wrong place and — often — a different rectangle, and saying it
 * twice would suggest two faults.
 */
function differenceBetween(editing: DrawnEntity, playing: DrawnEntity): string | null {
  if (!near(editing.origin.x, playing.origin.x) || !near(editing.origin.y, playing.origin.y)) {
    return `is drawn ${describeShift(playing.origin.x - editing.origin.x, playing.origin.y - editing.origin.y)}`
  }

  if (editing.bounds === null && playing.bounds === null) return null
  if (playing.bounds === null) return 'has no picture here'
  if (editing.bounds === null) return 'has a picture here and had none'

  if (!near(editing.bounds.width, playing.bounds.width) || !near(editing.bounds.height, playing.bounds.height)) {
    return `is ${round(playing.bounds.width)}×${round(playing.bounds.height)} here and was ${round(editing.bounds.width)}×${round(editing.bounds.height)}`
  }

  if (!near(editing.bounds.x, playing.bounds.x) || !near(editing.bounds.y, playing.bounds.y)) {
    // Same position and same size, different rectangle: the pivot moved.
    return `sits on a different pivot here`
  }

  return null
}

/** Screen pixels, in the direction a human would say it. */
function describeShift(dx: number, dy: number): string {
  const parts: string[] = []
  if (!near(dx, 0)) parts.push(`${round(Math.abs(dx))}px ${dx < 0 ? 'left' : 'right'}`)
  if (!near(dy, 0)) parts.push(`${round(Math.abs(dy))}px ${dy < 0 ? 'up' : 'down'}`)
  return `${parts.join(' and ')} of where the editor drew it`
}

/** One comparison, as the sentence the viewport shows. */
export function describeComparison(comparison: PlayComparison): string {
  if (comparison.kind === 'unavailable') {
    return `Cannot be checked against the editing view: ${comparison.why}.`
  }

  if (comparison.kind === 'same') {
    return comparison.count === 0
      ? 'Nothing to draw, exactly as in the editing view.'
      : `Drawn exactly as the editing view had it.`
  }

  const { differences } = comparison
  const count = differences.length === 1 ? '1 difference' : `${differences.length} differences`
  // Every one of them, not the first: a caption that says "and 4 others" is a
  // caption that hides the four somebody needs.
  return `${count} from the editing view — ${differences.map((one) => one.detail).join('; ')}.`
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function sameSize(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return a.width === b.width && a.height === b.height
}

function sameCamera(
  a: { scale: number; focus: { x: number; y: number } },
  b: { scale: number; focus: { x: number; y: number } },
): boolean {
  return near(a.scale, b.scale) && near(a.focus.x, b.focus.x) && near(a.focus.y, b.focus.y)
}
