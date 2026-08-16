import { useCallback, useEffect, useRef, useState } from 'react'

import type { Point } from '../../runtime/scene/coordinates'
import type { EditRun } from '../store/documents'
import { beginRun, usePrefabDocument } from '../store/open-documents'
import { placePrefabInstance } from './place-into-scene'
import { usePlacing } from './placing'
import { useResolvedScene } from './scene-prefabs'
import { useSceneView } from './scene-view-context'
import { useSelection } from './selection'
import { cellCentre, cellKey, cellOf, cellsBetween, type Cell } from './stroke'

/**
 * Putting instances of a prefab into the open level: one, or a stroke of them.
 *
 * Shared rather than owned by the panel that first needed it, because placing
 * has to be reachable from **two** places and they are the same gesture. The
 * Inspector holds one thing at a time, so placing from a prefab — which selects
 * what it just placed — moves the panel off the prefab, and a second press would
 * have nothing to press. So the entity that was just placed offers it too, and
 * "place it fifty times" is fifty presses of whatever is in front of you rather
 * than fifty round trips back to the Assets panel.
 *
 * Two decisions live in here:
 *
 *   - **It lands where it is asked to, snapped the same way a drag is** — in the
 *     middle of what the Viewport is showing when nowhere is named. The level's
 *     origin is frequently nowhere near the screen once there is a camera, so
 *     placing there would be correct and invisible.
 *   - **The prefab comes from the document store**, which is what this hook is
 *     for. The recipe that writes the instance is not: a prefab dropped on the
 *     picture was read off disk a moment earlier and has never been in the
 *     store, so what an instance *is* lives in `place-into-scene.ts` and both
 *     callers use it.
 *
 * **Separate doors rather than one function taking an optional point**, because
 * the caller that has no point is a button: `onClick={place}` hands a React
 * event to whatever the first argument is, and an optional position would take
 * it, silently, as a place to put a prefab. The names also say which is which at
 * the call site, which an `undefined` does not.
 *
 * Selection happens outside the transaction, because what is selected afterwards
 * is not part of the edit (`editor-ui` U8). A stroke deliberately does *not*
 * select: it is the thing used twenty times in a row, and moving the Inspector
 * off the prefab on the first press is exactly the problem repeat-placing exists
 * to solve (`editor/shell/placing.tsx`).
 *
 * **The prefab comes from the document store, not from what the level already
 * references.** Reading the resolved level's set would be a neat symmetry and a
 * chicken-and-egg: a prefab nothing has placed yet is in no level's set, so a
 * brand-new one could never be placed for the first time. The store holds both
 * cases — the one the Inspector is showing, because selecting it is what read
 * it, and the ones the level points at, because resolving them put them there.
 *
 * ## The stroke
 *
 * A press while the mode is on is the start of a stroke, and dragging without
 * letting go stamps one more copy in every grid cell the pointer crosses —
 * including the ones a fast hand skipped between two samples (`stroke.ts`).
 * Three rules, each the answer to something that went wrong first:
 *
 *   - **One stroke is one press of Ctrl-Z**, through one open run in the
 *     transaction API (`editor-kernel` D7): each cell is applied as it is
 *     stamped, so the Outliner and the picture move with the hand, and the
 *     history holds one step however long the hand pauses. Not one transaction
 *     per cell merged afterwards — a merge is timed and keyed for typing, and a
 *     slow stroke would split while the stamp after it would fuse.
 *   - **A cell is stamped once per stroke, and never doubled.** The stroke keeps
 *     the cells it has visited, and the recipe itself declines a cell that
 *     already holds this prefab at that position — painting back over your own
 *     road adds nothing. A different prefab still stacks.
 *   - **Without the snap there is no stroke.** A cell is a grid's idea; with the
 *     switch off a press places one copy where it landed, exactly as before,
 *     and a drag says why nothing more happens rather than doing something
 *     nobody asked for.
 */
export function usePlacePrefab(prefabPath: string | null): {
  /** The level a prefab would go into, or null when none is open. */
  scenePath: string | null
  /** Whether this prefab could be placed right now. */
  canPlace: boolean
  /** What this prefab is called, for anything that has to say so. */
  prefabName: string | null
  /** One, in the middle of the view, selected afterwards. */
  place: () => void
  /** A press, in the level's own units: the first cell of a stroke, or one copy when there is no grid. Selects nothing. */
  beginStroke: (at: Point) => void
  /** The pointer moved with the button held: every cell crossed since the last sample. */
  strokeTo: (at: Point) => void
  /** The button came up, or Esc: the stroke is over and what it placed stays. */
  endStroke: () => void
  /** What the caption should say about the stroke instead of its usual line, or null. */
  strokeNote: string | null
} {
  const resolved = useResolvedScene()
  const view = useSceneView()
  const selection = useSelection()
  const placing = usePlacing()
  const prefab = usePrefabDocument(prefabPath)
  const [strokeNote, setStrokeNote] = useState<string | null>(null)
  // The sentence is about this mode; when the mode ends or changes, so does it.
  useEffect(() => setStrokeNote(null), [prefabPath])

  /**
   * The stroke in progress. A ref rather than state, because it changes on
   * every pointer sample and nothing draws it — what is drawn is the level.
   */
  const stroke = useRef<{ run: EditRun; visited: Set<string>; last: Cell } | { run: null } | null>(null)

  /** Answers the id it minted, or null when there was nothing to place into. */
  const put = (at: Point, into?: { run: EditRun }): string | null => {
    const scenePath = resolved.path
    if (scenePath === null || prefab === null || prefabPath === null) return null

    // The recipe itself is shared with the drop, which has read its prefab off
    // disk rather than from the store (`place-into-scene.ts`).
    return (
      placePrefabInstance({
        scenePath,
        prefabPath,
        prefab,
        at,
        snap: placing.snap,
        ...(into === undefined ? {} : { into, unlessAlreadyThere: true }),
      })?.entity ?? null
    )
  }

  const place = (): void => {
    const focus = view.state === 'ready' && view.shown !== null ? view.shown.camera.focus : { x: 0, y: 0 }
    const id = put(focus)
    if (id !== null && resolved.path !== null) selection.selectEntity(resolved.path, id)
  }

  const stamp = (cell: Cell, run: EditRun): void => {
    put(cellCentre(cell, placing.snap), { run })
  }

  const beginStroke = (at: Point): void => {
    setStrokeNote(null)
    if (!placing.snap.on) {
      // No grid, no cells: one copy where the press landed, as it always was,
      // and a marker so a drag from here can be answered with a sentence.
      put(at)
      stroke.current = { run: null }
      return
    }
    const run = beginRun({ label: `Paint ${prefab?.name ?? 'prefab'}` })
    const first = cellOf(at, placing.snap)
    stroke.current = { run, visited: new Set([cellKey(first)]), last: first }
    stamp(first, run)
  }

  const strokeTo = (at: Point): void => {
    const current = stroke.current
    if (current === null) return
    if (current.run === null) {
      setStrokeNote('Turn Snap on to paint — without it a press places one.')
      return
    }
    const here = cellOf(at, placing.snap)
    for (const cell of cellsBetween(current.last, here)) {
      const key = cellKey(cell)
      if (current.visited.has(key)) continue
      current.visited.add(key)
      stamp(cell, current.run)
    }
    current.last = here
  }

  const endStroke = useCallback((): void => {
    const current = stroke.current
    stroke.current = null
    if (current !== null && current.run !== null) current.run.end()
  }, [])

  return {
    scenePath: resolved.path,
    canPlace: resolved.path !== null && prefab !== null,
    prefabName: prefab?.name ?? null,
    place,
    beginStroke,
    strokeTo,
    endStroke,
    strokeNote,
  }
}
