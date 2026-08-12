import { useEffect } from 'react'

import { redo, undo } from '../store/open-documents'

/**
 * Ctrl-Z and Ctrl-Y, for the whole window.
 *
 * Listened for on the window rather than on any panel, because the undo stack
 * is one stack for the whole project and pressing Ctrl-Z should mean the same
 * thing wherever the cursor happens to be. What it reverses is the last thing
 * that was *changed*, never the last thing that was looked at — which is true
 * by construction rather than by care, because selection is not part of the
 * document (editor-ui U8).
 *
 * The browser's own undo is deliberately taken over, including inside a text
 * field. Leaving it in place would mean Ctrl-Z in a number field stepping back
 * through the individual keystrokes of a value the document only ever saw as
 * one change — which is the same key doing two different things depending on
 * where the cursor is. Every editor of this kind makes the same trade.
 */
export function useUndoShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return

      const key = event.key.toLowerCase()
      // Redo is spelled both ways: Ctrl-Y on Windows, Shift-Ctrl-Z everywhere
      // a Mac keyboard has been anywhere near.
      const isRedo = key === 'y' || (key === 'z' && event.shiftKey)
      const isUndo = key === 'z' && !event.shiftKey
      if (!isUndo && !isRedo) return

      event.preventDefault()
      if (isRedo) redo()
      else undo()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
