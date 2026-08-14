import { useRef, useState, type DragEvent } from 'react'

import { toScenePoint, type ShownScene } from '../../runtime'
import { basename } from './asset-kinds'
import { usePlacing } from './placing'
import { ASSET_DRAG_TYPE } from './useAssetDrag'
import { useDropIntoScene } from './useDropIntoScene'

/**
 * The picture, as somewhere a file can be let go.
 *
 * The other half of `useAssetDrag`, and the half that has to answer three
 * questions the browser asks separately: may this be dropped here, is the
 * pointer over the picture right now, and what happened when it landed.
 *
 * **Where it lands is inverted through the camera the renderer *drew* with**,
 * the same as a press while repeat-placing and for the same reason: the camera
 * asked for and the camera drawn with differ by less than a device pixel — the
 * nudge that keeps pixel art crisp (`phaser4-runtime` P5) — and at 8× that is an
 * eighth of a level unit, which is enough to drop a tile on the wrong side of a
 * snap boundary.
 *
 * Two details that are the difference between this working and this half-working:
 *
 *   - **`dragover` must cancel the event on every single move**, or the browser
 *     refuses the drop and the ghost springs back to the panel with nothing
 *     said. Cancelling `dragenter` alone is not enough.
 *   - **`dragleave` fires when the pointer crosses onto a child**, and the
 *     canvas is a child, so a naive handler switches the highlight off in the
 *     middle of the picture. Counted rather than compared against
 *     `relatedTarget`, because the count is right whatever the panel gains
 *     later.
 */

export interface SceneDropTarget {
  /** Whether a droppable drag is over the picture right now, for the highlight. */
  over: boolean
  /** What is being dragged, named for the caption, or null. */
  carrying: string | null
  /** Why the last drop put nothing down, or null. Cleared by the next drag. */
  refused: string | null
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

export function useSceneDropTarget({
  shown,
  enabled,
}: {
  /** The picture as the renderer reported it, or null when there is none. */
  shown: ShownScene | null
  /** False while a level is running, or when there is nothing to drop into. */
  enabled: boolean
}): SceneDropTarget {
  const placing = usePlacing()
  const { drop } = useDropIntoScene()

  const [over, setOver] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const depth = useRef(0)

  const dragging = placing.dragging
  const accepting = enabled && shown !== null && dragging !== null

  const leave = (): void => {
    depth.current = 0
    setOver(false)
  }

  return {
    over: over && accepting,
    carrying: accepting && dragging !== null ? basename(dragging) : null,
    refused,

    onDragEnter: (event) => {
      if (!accepting || !isOurs(event)) return
      event.preventDefault()
      depth.current += 1
      setOver(true)
      // Whatever went wrong last time is about the file that was dropped then.
      setRefused(null)
    },

    // Every move, not just the first: a drag that is not cancelled here is a
    // drag the browser will not let go of.
    onDragOver: (event) => {
      if (!accepting || !isOurs(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },

    onDragLeave: () => {
      depth.current -= 1
      if (depth.current <= 0) leave()
    },

    onDrop: (event) => {
      if (!accepting || !isOurs(event) || shown === null || dragging === null) return
      event.preventDefault()
      leave()

      const box = event.currentTarget.getBoundingClientRect()
      const at = toScenePoint(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        shown.drawnWith,
        shown.canvasSize,
      )

      void drop(dragging, at).then((outcome) => {
        setRefused(outcome.ok ? null : outcome.problem)
      })
    },
  }
}

/** Ours rather than a text selection, or a file dragged in from Explorer. */
function isOurs(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes(ASSET_DRAG_TYPE)
}
