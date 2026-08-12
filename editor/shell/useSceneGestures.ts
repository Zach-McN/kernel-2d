import { useEffect, useRef, useState, type RefObject } from 'react'

import type { Point } from '../../runtime'

/**
 * Driving the scene camera with a mouse and two keys.
 *
 * **Middle-drag and space-drag pan; the wheel zooms toward the cursor.** That
 * is what Godot, Unity's 2D view and Tiled have all settled on, and the
 * space-and-drag half is the habit every art tool since Photoshop has taught.
 * Left-drag and right-drag are deliberately left alone: left-drag belongs to
 * placing entities, which is a later session, and right-drag is a 3D flythrough
 * idiom that collides with the context menu here.
 *
 * **Home frames the whole scene, F frames the selection.** Both are one-shot
 * presses rather than modes — a texture preview is something you look at, so it
 * can sensibly stay in a fitting mode, but a scene camera is something you
 * drive, and dragging the panel wider has to keep your place rather than reframe
 * (which is the acceptance criterion the mode would break).
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
}

export interface SceneGestures {
  /** True while the scene is actually being dragged. */
  dragging: boolean
  /** True while space is held, so the cursor can offer the hand before the drag. */
  ready: boolean
}

export function useSceneGestures(options: SceneGestureOptions): SceneGestures {
  const { host, enabled, pan, zoom, frameAll, frameEntity, selected } = options

  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)

  // Read inside listeners that are attached once. Set during render so a
  // listener never sees a value from the render before last.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const readyRef = useRef(ready)
  readyRef.current = ready

  useEffect(() => {
    const element = host.current
    if (element === null) return

    /** Where the pointer was last seen, and which pointer it is. */
    let holding: { id: number; x: number; y: number } | null = null

    const onPointerDown = (event: PointerEvent): void => {
      if (!enabledRef.current || holding !== null) return

      const middle = event.button === 1
      const spaceDrag = event.button === 0 && readyRef.current
      if (!middle && !spaceDrag) return

      event.preventDefault()
      holding = { id: event.pointerId, x: event.clientX, y: event.clientY }
      element.setPointerCapture(event.pointerId)
      setDragging(true)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (holding === null || event.pointerId !== holding.id) return

      const dx = event.clientX - holding.x
      const dy = event.clientY - holding.y
      holding = { id: holding.id, x: event.clientX, y: event.clientY }
      if (dx !== 0 || dy !== 0) pan(dx, dy)
    }

    const release = (event: PointerEvent): void => {
      if (holding === null || event.pointerId !== holding.id) return
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
      holding = null
      setDragging(false)
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

      const box = element.getBoundingClientRect()
      const at = { x: event.clientX - box.left, y: event.clientY - box.top }
      zoom(at, event.deltaY < 0 ? 1 : -1)
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', release)
    element.addEventListener('lostpointercapture', release)
    element.addEventListener('mousedown', onMouseDown)
    // Not through React's `onWheel`, which cannot preventDefault. See above.
    element.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', release)
      element.removeEventListener('pointercancel', release)
      element.removeEventListener('lostpointercapture', release)
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

  return { dragging, ready: ready && enabled }
}

/** Whether a key belongs to whatever the human is typing into. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}
