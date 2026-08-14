import type { DragEvent } from 'react'

import { usePlacing } from './placing'

/**
 * Making a file in the Assets panel something you can pick up.
 *
 * One helper rather than the handlers written into the row and again into the
 * tile: there are two ways of looking at a folder (`editor-ui` U34) and a file
 * has to be draggable out of both, and "what a drag carries" is exactly the kind
 * of thing that goes on meaning one thing in one view a month after it stopped
 * meaning it in the other.
 *
 * **Folders are not draggable, and nothing else is filtered.** What a file *is*
 * cannot be known from the panel — a `.json` is a level or a prefab depending on
 * what it says inside itself (`editor-ui` U11), and the panel has not read it.
 * So every file can be picked up and the *drop* decides, exactly as the startup
 * level picker offers every document and validates the one that is chosen
 * (`editor-ui` U28). A file that cannot be placed is answered with a sentence
 * saying what it is, which is worth far more than a row that quietly refuses to
 * be dragged for a reason nobody can see.
 *
 * The browser's own drag is used rather than a pointer gesture of our own: it
 * draws the ghost of the row being carried, it sets the cursor, and it crosses
 * from one docked panel into another without either of them arranging anything.
 * What it is *not* used for is carrying the path — see `placing.tsx`.
 */

/**
 * The type on the drag, saying it is one of ours.
 *
 * A marker and nothing more. It is the only thing a `dragover` handler can see —
 * the browser hides a drag's data until the drop, so a viewport that wanted to
 * name what it was about to place could not read it from here anyway — and it
 * is what keeps a text selection, or a file dragged in from Explorer, from being
 * treated as an asset.
 */
export const ASSET_DRAG_TYPE = 'application/x-kernel-2d-asset'

export interface AssetDragProps {
  draggable: boolean
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
}

/**
 * What a folder wears instead.
 *
 * Spelled out rather than left off. A button is not draggable by default, so
 * this changes nothing on screen — but "this cannot be picked up" is then a fact
 * written in the row rather than an absence, which is the difference between a
 * rule and an oversight, and the only version of it a test can read.
 */
export const NOT_DRAGGABLE: AssetDragProps = { draggable: false }

/** The props a row or a tile spreads onto its button to become draggable. */
export function useAssetDrag(): (path: string) => AssetDragProps {
  const { startDragging, stopDragging } = usePlacing()

  return (path: string) => ({
    draggable: true,
    onDragStart: (event) => {
      // The marker is what a `dragover` will see; the path travels in the
      // window's own state, where it can be read while the drag is happening.
      event.dataTransfer.setData(ASSET_DRAG_TYPE, path)
      // Text as well, so dragging a file into a text editor or a name field
      // gives the path rather than nothing. Costs a line and surprises nobody.
      event.dataTransfer.setData('text/plain', path)
      event.dataTransfer.effectAllowed = 'copy'
      startDragging(path)
    },
    // Fires whether it was dropped or abandoned, which is exactly the question
    // this answers: the drag is over either way.
    onDragEnd: stopDragging,
  })
}
