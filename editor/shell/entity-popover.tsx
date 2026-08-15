import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'

import type { Point } from '../../runtime'

/**
 * The right-click window: which entity it is about, and which panel it is
 * hanging off.
 *
 * **One window in the editor, with two doors into it.** A right-click on a
 * sprite in the picture and a right-click on that entity's row in the Outliner
 * open the same window on the same entity — so the state lives above both
 * panels rather than once in each. Two copies would spend most of their time
 * agreeing and the rest of it showing the human two windows about one entity,
 * which is the state this file exists to make unspellable. It is the same
 * argument Duplicate and `Shift-D` settled by sharing one implementation
 * (`editor/shell/useDuplicateEntity.ts`), one level up: there, one *action* with
 * two buttons; here, one *window* with two ways of opening it.
 *
 * `owner` is what makes that work across panels that cannot see each other's
 * pixels. `at` is in the owning panel's own coordinates and is meaningless in
 * any other, so a panel draws the window only when it is the owner — and
 * opening from either door overwrites the one slot, which closes the other
 * panel's window without either panel knowing the other exists.
 *
 * **Not in the document** — it sits beside selection, the camera and the
 * placing settings (`editor-ui` U8, U19): held for the life of the window,
 * never serialized, never in a transaction, invisible to Ctrl-Z.
 *
 * **What closes it stays with the panel that opened it**, deliberately: the
 * viewport's anchor is taken away by the camera moving, the Outliner's by the
 * list scrolling, and neither panel can answer the other's question. What both
 * share is the entity itself going away, or the selection moving off it, and
 * each closes on those in its own render.
 */

/** Which panel the window is hanging off, and so which one draws it. */
export type PopoverOwner = 'viewport' | 'outliner'

export interface EntityPopoverAnchor {
  owner: PopoverOwner
  /** The scene the entity is in, so a window cannot outlive the level it is about. */
  scene: string
  entity: string
  /** Where it sits, in the owning panel's own pixels — already clamped by it. */
  at: Point
}

export interface EntityPopovers {
  /** The window that is open, or null. */
  anchor: EntityPopoverAnchor | null
  /** Open it here, closing wherever it was before. */
  show: (anchor: EntityPopoverAnchor) => void
  close: () => void
}

const EntityPopoverContext = createContext<EntityPopovers | null>(null)

export function EntityPopoverProvider({ children }: { children: ReactNode }): ReactElement {
  const [anchor, setAnchor] = useState<EntityPopoverAnchor | null>(null)

  const show = useCallback((next: EntityPopoverAnchor) => setAnchor(next), [])
  const close = useCallback(() => setAnchor(null), [])

  const value = useMemo<EntityPopovers>(() => ({ anchor, show, close }), [anchor, show, close])

  return <EntityPopoverContext.Provider value={value}>{children}</EntityPopoverContext.Provider>
}

export function useEntityPopover(): EntityPopovers {
  const popover = useContext(EntityPopoverContext)
  if (popover === null) throw new Error('useEntityPopover was called outside the editor shell')
  return popover
}

/**
 * How much room the window needs, in CSS pixels, so a click near an edge puts
 * it on the near side rather than hanging it off the panel.
 *
 * Wider than the window itself by the margin it is kept from the edge, and one
 * number for both panels: the window is the same size in either.
 */
export const POPOVER_ROOM = { width: 240, height: 104 }

/**
 * Where the window sits for a click at `at`, in the panel's own pixels.
 *
 * Next to the click, kept inside the panel. Shared by both doors so the window
 * cannot appear to behave like two different windows depending on which one
 * opened it.
 */
export function popoverSpot(panel: DOMRect | undefined, at: Point): Point {
  return {
    x: Math.max(8, Math.min(at.x + 12, (panel?.width ?? 0) - POPOVER_ROOM.width)),
    y: Math.max(8, Math.min(at.y + 8, (panel?.height ?? 0) - POPOVER_ROOM.height)),
  }
}
