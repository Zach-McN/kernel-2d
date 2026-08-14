import { useEffect, useRef, useState, type RefObject } from 'react'

import type { Point } from '../../runtime'

/**
 * Driving the scene viewport with a mouse and two keys.
 *
 * **Left-press picks and places. Middle-drag and space-drag pan; the wheel zooms
 * toward the cursor.** That is what Godot, Unity's 2D view and Tiled have all
 * settled on, and the space-and-drag half is the habit every art tool since
 * Photoshop has taught. Right-drag is deliberately still unclaimed: it is a 3D
 * flythrough idiom and it collides with the context menu here.
 *
 * **One place decides what a press means.** Placing arrived after panning, and
 * the tempting shape is a second pointer layer on the same element for the new
 * button — which is two listeners racing to interpret one gesture, and the first
 * thing it breaks is space-drag starting on top of a sprite. So the rules live
 * here, in order: space wins, then repeat-placing, then whatever is under the
 * pointer, then empty space.
 *
 * **Repeat-placing sits above "whatever is under the pointer" on purpose.** A
 * board being drawn is covered by its own backdrop, so nearly every press that
 * means "put another one here" lands on top of something — and a mode that
 * placed only where the level was empty would place nothing at all on the first
 * level anybody tried it on.
 *
 * Three traps live in here, each of which fails silently:
 *
 * 1. **The wheel listener is attached by hand, non-passive.** React registers
 *    its own wheel handling passively at the root, so `preventDefault` inside an
 *    `onWheel` prop does nothing at all — no error, no warning in production.
 *    Without it a trackpad pinch (which arrives as a ctrl-wheel) zooms the whole
 *    editor instead of the level.
 * 2. **Middle-button `mousedown` has to be prevented**, or Chrome on Windows
 *    opens its autoscroll widget over the viewport and the drag turns into a
 *    page scroll.
 * 3. **A bare letter must not fire while the human is typing.** The only other
 *    keyboard handler in the editor is modifier-only (`useUndoShortcuts`), so it
 *    never had to care; an `f` typed into an entity's name has to be an `f`.
 */

/** What the panel does about a press. Everything here is in CSS pixels. */
export interface ScenePlacement {
  /** What is at this point on the canvas, or null for empty space. */
  pick: (at: Point) => string | null
  /**
   * A press landed. Null means empty space.
   *
   * Called on the press rather than on the release, because it is also the
   * moment the panel has to remember where the entity *was* — a drag is applied
   * as travel from the press, not as a sum of wobbles, so that rounding cannot
   * accumulate and the sprite cannot creep.
   */
  select: (entityId: string | null) => void
  /** Total travel since the press. `free` is Alt: place it anywhere. */
  moveBy: (entityId: string, screenDx: number, screenDy: number, free: boolean) => void
  /** The press ended, whether or not anything moved. */
  drop: () => void
  /**
   * True while every press puts a copy of something down instead of picking.
   *
   * Read on each press rather than turned into a second gesture surface: the
   * whole reason this hook exists is that one element cannot have two opinions
   * about one `pointerdown`.
   */
  stamping: boolean
  /** A press landed while stamping. Nothing is selected and nothing is dragged. */
  stampAt: (at: Point) => void
  /** Esc. Harmless when nothing is being stamped. */
  stopStamping: () => void
}

export interface SceneGestureOptions {
  /** The element the canvas sits in. Gestures are read from this. */
  host: RefObject<HTMLElement | null>
  /** False when there is no scene to look at, which makes every gesture a no-op. */
  enabled: boolean
  pan: (screenDx: number, screenDy: number) => void
  zoom: (at: Point, direction: 1 | -1) => void
  frameAll: () => void
  frameEntity: (entityId: string) => void
  /** The selected entity, or null. What `F` frames. */
  selected: string | null
  placement: ScenePlacement
}

export interface SceneGestures {
  /** True while the scene is being dragged under the pointer. */
  panning: boolean
  /** True while space is held, so the cursor can offer the hand before the drag. */
  ready: boolean
  /** The entity under the pointer, or null. Drives the cursor. */
  picked: string | null
  /** The entity being moved, or null. */
  dragging: string | null
}

/** How far the pointer travels before a click becomes a drag, in CSS pixels. */
const DRAG_THRESHOLD = 3

export function useSceneGestures(options: SceneGestureOptions): SceneGestures {
  const { host, enabled, pan, zoom, frameAll, frameEntity, selected, placement } = options

  const [panning, setPanning] = useState(false)
  const [ready, setReady] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  // Read inside listeners that are attached once. Set during render so a
  // listener never sees a value from the render before last. `placement` in
  // particular is rebuilt whenever the picture changes, and re-attaching every
  // listener on every redraw would drop a gesture mid-drag.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const readyRef = useRef(ready)
  readyRef.current = ready
  const placementRef = useRef(placement)
  placementRef.current = placement

  useEffect(() => {
    const element = host.current
    if (element === null) return

    /** A pan in progress: which pointer, and where it was last seen. */
    let holding: { id: number; x: number; y: number } | null = null
    /** A placement in progress: which entity, where the press was, and whether it has passed the threshold. */
    let placing: { id: number; entity: string; x: number; y: number; moved: boolean } | null = null

    /** Where an event happened, in the host's own pixels. Wheels and pointers alike. */
    const pointIn = (event: MouseEvent): Point => {
      const box = element.getBoundingClientRect()
      return { x: event.clientX - box.left, y: event.clientY - box.top }
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (!enabledRef.current || holding !== null || placing !== null) return

      const middle = event.button === 1
      const left = event.button === 0
      if (!middle && !left) return

      event.preventDefault()

      // Takes focus off whatever the human was typing in, so `F` and `Home` are
      // this panel's again. Without it, clicking a sprite and pressing F types
      // an f into the entity's name field.
      element.focus({ preventScroll: true })

      // Space wins over everything, so a pan can start anywhere — including on
      // top of a sprite, which is exactly where the human will try it.
      if (middle || readyRef.current) {
        holding = { id: event.pointerId, x: event.clientX, y: event.clientY }
        element.setPointerCapture(event.pointerId)
        setPanning(true)
        return
      }

      // Placing a copy is the whole of what this press does: it does not pick,
      // it does not change the selection, and it starts no drag. Twenty of them
      // in a row leave the Inspector exactly where it was, which is what makes
      // the twenty-first as cheap as the first.
      if (placementRef.current.stamping) {
        placementRef.current.stampAt(pointIn(event))
        return
      }

      const entity = placementRef.current.pick(pointIn(event))
      placementRef.current.select(entity)
      if (entity === null) return

      placing = { id: event.pointerId, entity, x: event.clientX, y: event.clientY, moved: false }
      element.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (holding !== null && event.pointerId === holding.id) {
        const dx = event.clientX - holding.x
        const dy = event.clientY - holding.y
        holding = { id: holding.id, x: event.clientX, y: event.clientY }
        if (dx !== 0 || dy !== 0) pan(dx, dy)
        return
      }

      if (placing !== null && event.pointerId === placing.id) {
        const dx = event.clientX - placing.x
        const dy = event.clientY - placing.y

        // A click must not nudge. Once past the threshold the travel is measured
        // from the press, including the first few pixels, so the sprite does not
        // lurch as the drag begins.
        if (!placing.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        if (!placing.moved) {
          placing.moved = true
          setDragging(placing.entity)
        }

        // Read off the event rather than remembered from the press, so Alt can
        // be taken or let go mid-drag.
        placementRef.current.moveBy(placing.entity, dx, dy, event.altKey)
        return
      }

      if (!enabledRef.current) return
      const under = placementRef.current.pick(pointIn(event))
      setPicked((previous) => (previous === under ? previous : under))
    }

    const release = (event: PointerEvent): void => {
      if (holding !== null && event.pointerId === holding.id) {
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
        holding = null
        setPanning(false)
        return
      }

      if (placing !== null && event.pointerId === placing.id) {
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
        placing = null
        setDragging(null)
        // Always, even for a press that never moved: it seals the undo step, and
        // sealing one that was never opened costs nothing.
        placementRef.current.drop()
      }
    }

    const onPointerLeave = (): void => {
      if (holding === null && placing === null) setPicked(null)
    }

    // Chrome's autoscroll starts on the middle mousedown rather than on the
    // pointer event, and it is not always suppressed by preventing the pointer.
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button === 1 && enabledRef.current) event.preventDefault()
    }

    const onWheel = (event: WheelEvent): void => {
      if (!enabledRef.current) return
      // Always, including the ctrl-wheel a trackpad pinch arrives as: without
      // this the browser zooms the editor rather than the level.
      event.preventDefault()
      if (event.deltaY === 0) return

      zoom(pointIn(event), event.deltaY < 0 ? 1 : -1)
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', release)
    element.addEventListener('lostpointercapture', release)
    element.addEventListener('pointerleave', onPointerLeave)
    element.addEventListener('mousedown', onMouseDown)
    // Not through React's `onWheel`, which cannot preventDefault. See above.
    element.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', release)
      element.removeEventListener('pointercancel', release)
      element.removeEventListener('lostpointercapture', release)
      element.removeEventListener('pointerleave', onPointerLeave)
      element.removeEventListener('mousedown', onMouseDown)
      element.removeEventListener('wheel', onWheel)
    }
  }, [host, pan, zoom])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!enabledRef.current || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target)) return

      if (event.code === 'Space') {
        // Held rather than pressed, so it must not repeat into anything — and
        // it must not scroll the page or re-press a focused button either.
        event.preventDefault()
        if (!event.repeat) setReady(true)
        return
      }

      // The way out of a mode, wherever the hand is. Not cancelled, because
      // Escape means "stop what you are doing" everywhere else in a browser too
      // and there is nothing here worth taking it away from.
      if (event.key === 'Escape') {
        placementRef.current.stopStamping()
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        frameAll()
        return
      }

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        const entity = selectedRef.current
        // Nothing selected means nothing to frame. Home is the other key.
        if (entity !== null) frameEntity(entity)
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setReady(false)
    }

    // Alt-tabbing away while holding space would otherwise leave the editor
    // believing it is still held, and the next left-click would pan.
    const onBlur = (): void => setReady(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [frameAll, frameEntity])

  return { panning, ready: ready && enabled, picked: enabled ? picked : null, dragging }
}

/** Whether a key belongs to whatever the human is typing into. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}
