import { useEffect, type RefObject } from 'react'

import { useAssetBrowsing } from './asset-browsing'

/**
 * The mouse's back and forward buttons, hopping along the folder trail.
 *
 * The two side buttons are the one gesture every file manager on every desktop
 * agrees about, and they cost nothing to support — but only for a hand that is
 * over the folder being browsed, which is why this is the browsing area's rather
 * than the window's (`editor-ui` U20, the same scoping as the viewport's keys).
 * A hand over the level has other things those buttons could plausibly mean, and
 * guessing is worse than not answering.
 *
 * **All three events are cancelled, and the one that matters is `mouseup`.**
 * Chrome maps these two buttons to *browser* history, so a press that reaches
 * the browser navigates the page the editor is — and an editor that walks itself
 * off screen because somebody wanted to leave a folder is the worst possible
 * answer. Cancelling `mousedown` looks like it works: the event reports
 * `defaultPrevented`, the folder changes, and nothing appears to be wrong.
 * **Chromium acts on the release.** So the press cancels, the release navigates,
 * and the editor is replaced by whatever the tab was showing beforehand — which
 * is usually nothing at all, so the first symptom is a blank window. `auxclick`
 * is taken as well, because it is the one Firefox acts on.
 *
 * They are cancelled whether or not the gesture does anything here. The editor
 * never wants the page navigated, and a rule with an exception in it is a rule
 * that will be found by the exception.
 *
 * Attached by hand rather than through React's props for the same reason
 * `useSceneGestures` is (`editor-ui` UG6): what matters here is the cancelling,
 * and cancelling wants a real listener on a real element.
 */
export function useFolderHistoryButtons({
  surface,
  enabled,
}: {
  /** The browsing area. Presses anywhere else are none of this hook's business. */
  surface: RefObject<HTMLElement | null>
  /** False in the tree-only view, where there is no folder to be inside of. */
  enabled: boolean
}): void {
  const { goBack, goForward } = useAssetBrowsing()

  useEffect(() => {
    const element = surface.current
    if (element === null) return

    /** Back is 3 and forward is 4, counting from the left button as 0. */
    const isSideButton = (event: MouseEvent): boolean => event.button === 3 || event.button === 4

    const onMouseDown = (event: MouseEvent): void => {
      if (!isSideButton(event)) return
      // Always, even with the gesture switched off: see above.
      event.preventDefault()
      if (!enabled) return
      if (event.button === 3) goBack()
      else goForward()
    }

    /** Cancelled and nothing else: the folder already moved on the press. */
    const swallow = (event: MouseEvent): void => {
      if (isSideButton(event)) event.preventDefault()
    }

    element.addEventListener('mousedown', onMouseDown)
    element.addEventListener('mouseup', swallow)
    element.addEventListener('auxclick', swallow)

    return () => {
      element.removeEventListener('mousedown', onMouseDown)
      element.removeEventListener('mouseup', swallow)
      element.removeEventListener('auxclick', swallow)
    }
  }, [surface, enabled, goBack, goForward])
}
