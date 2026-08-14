import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'

import { WHOLE_UNITS, type Snap } from './snap'

/**
 * How a press in the picture puts something down: what it lands on, and whether
 * it is placing at all.
 *
 * Two pieces of state, together because they are one subject — the *placing
 * settings of this window* — and because the second one is unusable without the
 * first. Dropping a prefab wherever you click is only worth having if the
 * copies line up, and a snap is only worth setting if placing is cheap enough
 * to do twenty times.
 *
 * **Neither is in the document.** They sit beside selection and the camera
 * (`editor-ui` U8, U19): held for the life of the window, never serialized,
 * never in a transaction, invisible to Ctrl-Z. A reload puts both back to their
 * defaults, and the defaults are exactly how the editor behaved before either
 * existed — whole units, and no press placing anything.
 *
 * Above the docking layout, because both ends of it are in different panels
 * (`editor-ui` U9): the Viewport reads them on every press, and the Inspector is
 * where the human turns placing on. State held in a panel would be lost the
 * first time a tab was dragged.
 *
 * **What is being stamped is a path, not the selection.** That is the whole
 * point of the mode: placing a prefab has always selected what it placed
 * (`editor-ui` U24), which is right for one placement and impossible for
 * twenty — the Inspector would move off the prefab on the first press. So the
 * prefab being placed is remembered here, and pressing in the picture is free
 * to change nothing at all.
 */

export interface Placing {
  snap: Snap
  setSnap: (snap: Snap) => void
  /**
   * The prefab every press in the picture puts a copy of, by path, or null when
   * a press means what it has always meant.
   */
  stamping: string | null
  startStamping: (prefabPath: string) => void
  stopStamping: () => void
}

const PlacingContext = createContext<Placing | null>(null)

export function PlacingProvider({ children }: { children: ReactNode }): ReactElement {
  const [snap, setSnap] = useState<Snap>(WHOLE_UNITS)
  const [stamping, setStamping] = useState<string | null>(null)

  const startStamping = useCallback((prefabPath: string) => setStamping(prefabPath), [])
  const stopStamping = useCallback(() => setStamping(null), [])

  const value = useMemo<Placing>(
    () => ({ snap, setSnap, stamping, startStamping, stopStamping }),
    [snap, stamping, startStamping, stopStamping],
  )

  return <PlacingContext.Provider value={value}>{children}</PlacingContext.Provider>
}

export function usePlacing(): Placing {
  const placing = useContext(PlacingContext)
  if (placing === null) throw new Error('usePlacing was called outside the editor shell')
  return placing
}
