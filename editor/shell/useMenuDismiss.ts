import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

/**
 * The two ways a menu closes without being chosen from: a press somewhere else,
 * and `Escape`.
 *
 * Lifted at the third caller, which is the bar this repo already keeps
 * (`editor-ui` U35's note on `place-into-scene`): the Assets panel's cog and
 * the Windows menu in the status strip each wrote it out, and the new-document
 * menu made three. Two menus in one bar built two different ways is the thing
 * this exists to prevent — a menu that closed on Escape but not on a press
 * elsewhere is not a variation, it is a bug nobody notices for a week.
 *
 * **`Escape` is handled on the menu's own subtree and stopped from travelling**,
 * because the viewport already owns Escape for calling off a grab
 * (`editor-ui` U33). One key, and whichever thing is open should be the one
 * that hears it.
 *
 * **The press listener is on the window and is only attached while the menu is
 * open**, so a closed menu costs nothing. It is `pointerdown` rather than
 * `click`: a menu that waited for the release would still be on screen while
 * the human was pressing the thing behind it.
 *
 * **What counts as "inside" is the box, and the box must contain the button
 * that opens the menu as well as the menu itself.** Otherwise pressing that
 * button while the menu is open closes it on the way down and the click reopens
 * it — a toggle that never appears to toggle.
 */
export interface MenuDismiss {
  /** Everything that counts as inside: the menu, and the control that opens it. */
  box: RefObject<HTMLDivElement | null>
  /** Put on the same element as `box`. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export function useMenuDismiss(
  open: boolean,
  /**
   * Close it. `escape` is passed for the key, so a caller can hand focus back
   * to the button it came from — which is right for a key and wrong for a
   * press, where the human has already aimed somewhere else.
   */
  close: (how: 'escape' | 'elsewhere') => void,
): MenuDismiss {
  const box = useRef<HTMLDivElement | null>(null)
  // Read inside a listener attached once per opening, so a caller is free to
  // pass a fresh closure on every render without re-attaching it.
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return

    const onPressElsewhere = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && box.current?.contains(target) === true) return
      closeRef.current('elsewhere')
    }

    window.addEventListener('pointerdown', onPressElsewhere)
    return () => {
      window.removeEventListener('pointerdown', onPressElsewhere)
    }
  }, [open])

  return {
    box,
    onKeyDown: (event) => {
      if (event.key !== 'Escape' || !open) return
      event.stopPropagation()
      closeRef.current('escape')
    },
  }
}
