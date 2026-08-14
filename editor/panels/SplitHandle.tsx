import { useState, type ReactElement, type RefObject } from 'react'

import { SPLIT_DEFAULT, useAssetBrowsing } from '../shell/asset-browsing'

/**
 * The edge between the tree and the tiles, and the way to move it.
 *
 * **What it sets is a fraction, not a width.** The panel is docked, so it is
 * resized constantly; a divider that remembered a number of pixels would leave
 * the tree the same width in a panel twice the size, which is not the split
 * anybody chose. Where it may go is clamped in `asset-browsing.tsx` rather than
 * here, so no caller can leave a pane too narrow to take hold of again.
 *
 * A pointer gesture with capture rather than a `mousemove` on the window: the
 * capture is what keeps the drag alive when the pointer crosses onto the canvas
 * of a panel next door, or leaves the window entirely and comes back.
 *
 * **Double-click puts it back.** A divider is the one control in a panel that
 * can be dragged into a state with no affordance left — a pane two pixels wide
 * has nothing in it to explain itself — so the way out has to be on the thing
 * that got you there.
 */
export function SplitHandle({ body }: { body: RefObject<HTMLElement | null> }): ReactElement {
  const { splitFraction, setSplitFraction } = useAssetBrowsing()
  const [dragging, setDragging] = useState(false)

  const moveTo = (clientX: number): void => {
    const box = body.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return
    setSplitFraction((clientX - box.left) / box.width)
  }

  return (
    <div
      className="assets__split-handle"
      data-testid="assets-split-handle"
      data-dragging={dragging}
      role="separator"
      aria-orientation="vertical"
      aria-label="How much of the panel the folder tree gets"
      aria-valuenow={Math.round(splitFraction * 100)}
      title="Drag to resize. Double-click to put it back."
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // Or the drag turns into a text selection the moment it leaves the
        // handle, and the pointer stops being where the panel thinks it is.
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (!dragging) return
        moveTo(event.clientX)
      }}
      onPointerUp={(event) => {
        if (!dragging) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        setDragging(false)
      }}
      onDoubleClick={() => {
        setSplitFraction(SPLIT_DEFAULT)
      }}
    />
  )
}
