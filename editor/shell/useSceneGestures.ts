import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { Point } from '../../runtime'

/**
 * Driving the scene viewport with a mouse and a handful of keys.
 *
 * **Left-press picks and places. Middle-drag and space-drag pan; the wheel zooms
 * toward the cursor. A right-click asks about what is under it** — the panel
 * decides what appears — **and while a placing mode is on it is the way out of
 * the mode instead**, which is what the second button means in every editor
 * with one. The browser's own context menu never opens over the picture: the
 * right button belongs to the editor here, and to the game while one runs.
 * Right-*drag* is deliberately still unclaimed: it is a 3D flythrough idiom
 * and a click is not a drag.
 *
 * **Shift and Ctrl turn the left press into three presses**, not two gestures:
 * plain replaces the selection and starts a drag, Shift adds to it, Ctrl takes
 * away from it, and neither modified press drags anything. That decision is
 * made in the one place below that already decides what a press means, which is
 * the whole point of the paragraph after this one. **`Delete` removes
 * everything selected**, from here or from the Outliner — the key listener is
 * on the window, which is why `Shift-D` has always worked with the hand in
 * either panel.
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
 * **`Ctrl` held during a move inverts the snap toggle**, whichever gesture is
 * doing the moving. Not "place freely" — the *other* thing, so with snapping off
 * it puts the entity on the grid. It takes effect on the keypress rather than on
 * the next mouse movement, which matters because a grab often sits with the hand
 * completely still. There is no conflict with the `Ctrl`-click that takes an
 * entity out of the selection: that press starts no drag, so this reading is
 * only ever reached inside a move a plain press began.
 *
 * **A grab is a move with no button held, and while one is running it owns the
 * picture.** `G` starts the selected entity moving with the pointer wherever the
 * pointer happens to be — over the sprite, across the panel, or nowhere near it
 * — and the travel is measured from where the pointer was when the key was
 * pressed, so nothing jumps. It is Blender's, and it is worth having for the
 * reason Blender has it: the sprite you are placing is usually the thing your
 * cursor is covering. `X` and `Y` lock it to one axis *from where the entity
 * started*, a press ends it, and `Esc` puts the entity back.
 *
 * Owning the picture is what makes the rest of it simple: while a grab is
 * running, a press cannot select or pan, the wheel cannot zoom, and `F` cannot
 * reframe. Every one of those changes either what the travel is measured
 * against or what the entity is, and each would show up as the sprite jumping
 * out from under the cursor.
 *
 * Four traps live in here, each of which fails silently:
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
 * 4. **A grab has to be called off by anything that ends its world.** The window
 *    losing focus, the level closing, Play starting, or the selection moving to
 *    something else all leave a grab that is still running with no way for the
 *    human to see it, and the next mouse movement over the picture would then
 *    move an entity nobody was moving.
 */

/**
 * What a press does to the selection, decided by the modifiers it arrived with.
 *
 * The same three the Outliner's rows read, and deliberately so: a modifier that
 * meant one thing in the list and another over the picture would be worse than
 * no modifier at all.
 */
export type SelectMode = 'replace' | 'add' | 'remove'

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
   *
   * A press that is not a plain one never begins a move: `add` and `remove` are
   * about which entities are selected and nothing else.
   */
  select: (entityId: string | null, mode: SelectMode) => void
  /**
   * The Delete key. Removes whatever is selected, in one step.
   *
   * Here rather than behind a window listener of its own, because this hook has
   * already answered the four questions such a listener would have to re-answer
   * — is the human typing, is a grab running, is a level playing, is there a
   * scene at all — and a second listener would race this one on all four.
   */
  deleteSelected: () => void
  /**
   * Remember where this entity is, without selecting it or moving it — what a
   * grab starts with, since it has no press to record it on.
   *
   * False when there is nothing to move: no scene, or an entity that has gone.
   * The gesture then never starts, rather than starting and doing nothing.
   */
  beginMove: (entityId: string) => boolean
  /**
   * Total travel since the press.
   *
   * `invert` is `Ctrl`: it flips the snap toggle for as long as it is held, so
   * with snapping on it places freely and with snapping off it lands on the
   * grid. Deliberately not called `free` — that was its meaning while `Alt`
   * owned this, and a boolean whose sense has inverted while its name has not is
   * how the next reader writes the inversion backwards (`editor/shell/snap.ts`).
   */
  moveBy: (entityId: string, screenDx: number, screenDy: number, invert: boolean) => void
  /** The press ended, whether or not anything moved. */
  drop: () => void
  /**
   * The move was called off: put the entity back where it started and leave no
   * trace of it in the undo history.
   */
  cancelMove: () => void
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
  /**
   * A right-click landed: what is under it, and where, in the host's own
   * pixels. Null means empty space. This layer decides only that the press
   * means "ask about this spot" — what appears is the panel's business.
   */
  context: (entityId: string | null, at: Point) => void
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
  /** The selected entity, or null. What `F` frames and what `G` grabs. */
  selected: string | null
  /** Shift-D: a copy of this entity, selected afterwards. */
  duplicate: (entityId: string) => void
  placement: ScenePlacement
}

/** A grab in progress, as anything drawing it needs to know it. */
export interface Grab {
  entity: string
  /** The axis the move is held to, or null while it is free in both. */
  axis: 'x' | 'y' | null
}

export interface SceneGestures {
  /** True while the scene is being dragged under the pointer. */
  panning: boolean
  /** True while space is held, so the cursor can offer the hand before the drag. */
  ready: boolean
  /** The entity under the pointer, or null. Drives the cursor. */
  picked: string | null
  /** The entity being dragged with the button held, or null. */
  dragging: string | null
  /** The keyboard grab in progress, or null. */
  grabbing: Grab | null
}

/**
 * A grab as the listeners hold it: the same thing, plus where the travel is
 * being measured from.
 *
 * Null until the pointer is next seen over the picture, which is what makes
 * `G` work with the cursor anywhere — including outside the panel, where there
 * is no sensible origin until the hand comes back.
 */
interface LiveGrab extends Grab {
  origin: Point | null
}

/** How far the pointer travels before a click becomes a drag, in CSS pixels. */
const DRAG_THRESHOLD = 3

export function useSceneGestures(options: SceneGestureOptions): SceneGestures {
  const { host, enabled, pan, zoom, frameAll, frameEntity, selected, duplicate, placement } = options

  const [panning, setPanning] = useState(false)
  const [ready, setReady] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [grabbing, setGrabbing] = useState<Grab | null>(null)

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
  const duplicateRef = useRef(duplicate)
  duplicateRef.current = duplicate

  /**
   * The grab, as the two listener sets share it.
   *
   * A ref rather than the state above, because the keyboard starts it and the
   * pointer drives it: a grab read from state would be one render behind on the
   * first mouse movement after `G`, and the entity would jump by however far the
   * pointer travelled in that frame. The state is the copy React draws.
   */
  const grabRef = useRef<LiveGrab | null>(null)
  /** Where the pointer was last seen over the picture, in client pixels. */
  const pointerAt = useRef<Point | null>(null)
  /** True while a button is held, so `G` cannot start a second move over a drag. */
  const pressed = useRef(false)

  /**
   * The travel of the move in progress, whichever gesture is doing it.
   *
   * Kept so that **pressing or releasing `Ctrl` can re-place the entity without
   * the pointer moving.** The same argument the axis lock already makes below —
   * the human pressed the key because they want the effect *now*, and a modifier
   * that waited for the next wobble reads as not having worked — and it matters
   * more here than there, because a `G` grab routinely sits with the hand
   * completely still while the eye decides.
   *
   * A ref rather than state: nothing draws it, and it is written from a pointer
   * listener that must not cause a render per mouse movement.
   */
  const lastMove = useRef<{ entity: string; dx: number; dy: number } | null>(null)

  /**
   * The entity, moved to wherever the pointer has got to.
   *
   * Travel from the grab's own origin, never a sum of the movements in between
   * — the same rule a drag keeps, and for the same reason: added-up rounded
   * steps let a sprite creep away from the pointer and never come back.
   */
  const applyGrab = useCallback((invert: boolean): void => {
    const grab = grabRef.current
    const at = pointerAt.current
    if (grab === null || grab.origin === null || at === null) return

    // A lock zeroes the travel on the other axis rather than remembering a
    // second position, so the entity sits exactly where it started on that axis
    // however far the pointer has wandered off it.
    const dx = grab.axis === 'y' ? 0 : at.x - grab.origin.x
    const dy = grab.axis === 'x' ? 0 : at.y - grab.origin.y
    lastMove.current = { entity: grab.entity, dx, dy }
    placementRef.current.moveBy(grab.entity, dx, dy, invert)
  }, [])

  /**
   * The move in progress, put down again under a modifier that has just changed.
   *
   * The travel is unchanged — only how it lands is — which is exactly why the
   * remembered delta is replayed rather than recomputed: a grab's origin and a
   * drag's press are two different things to measure from, and this needs to
   * work for both without knowing which is running.
   */
  const reapply = useCallback((invert: boolean): boolean => {
    const move = lastMove.current
    if (move === null) return false
    placementRef.current.moveBy(move.entity, move.dx, move.dy, invert)
    return true
  }, [])

  const endGrab = useCallback((how: 'drop' | 'cancel'): void => {
    if (grabRef.current === null) return
    grabRef.current = null
    lastMove.current = null
    setGrabbing(null)
    if (how === 'cancel') placementRef.current.cancelMove()
    else placementRef.current.drop()
  }, [])

  const startGrab = useCallback((): void => {
    if (grabRef.current !== null || pressed.current) return
    // One mode at a time: while every press is placing a copy, a grab's own
    // press-to-finish would be two meanings for one button (`placing.tsx`).
    if (placementRef.current.stamping) return

    const entity = selectedRef.current
    if (entity === null || !placementRef.current.beginMove(entity)) return

    grabRef.current = { entity, axis: null, origin: pointerAt.current }
    setGrabbing({ entity, axis: null })
  }, [])

  /**
   * `X` or `Y` while a grab is running.
   *
   * Pressing the axis it is already held to lets it go again, which is the only
   * way back to moving freely without starting over — Blender spends the second
   * press on local axes, and a 2D entity has none to offer.
   *
   * It moves the entity on the spot rather than waiting for the next mouse
   * movement: the human presses `X` because they want the vertical travel gone
   * *now*, and a lock that took effect on the next wobble would read as not
   * having worked.
   */
  const lockGrab = useCallback(
    (axis: 'x' | 'y', free: boolean): void => {
      const grab = grabRef.current
      if (grab === null) return

      const held = grab.axis === axis ? null : axis
      grabRef.current = { ...grab, axis: held }
      setGrabbing({ entity: grab.entity, axis: held })
      applyGrab(free)
    },
    [applyGrab],
  )

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
      const right = event.button === 2
      if (!middle && !left && !right) return

      event.preventDefault()

      // Takes focus off whatever the human was typing in, so `F` and `Home` are
      // this panel's again. Without it, clicking a sprite and pressing F types
      // an f into the entity's name field.
      element.focus({ preventScroll: true })

      // A grab owns the picture, so finishing it is the whole of what this
      // press does — it picks nothing, changes no selection and starts no pan.
      // Above space, deliberately: a grab is a move already in progress and the
      // human has to be able to put it down without letting go of anything.
      // The right button is swallowed with everything else: Esc is the way out.
      if (grabRef.current !== null) {
        if (left) endGrab('drop')
        return
      }

      // Space wins over everything, so a pan can start anywhere — including on
      // top of a sprite, which is exactly where the human will try it. Only the
      // buttons that pan, though: a right-click while space is held is still a
      // right-click.
      if (middle || (left && readyRef.current)) {
        holding = { id: event.pointerId, x: event.clientX, y: event.clientY }
        pressed.current = true
        element.setPointerCapture(event.pointerId)
        setPanning(true)
        return
      }

      if (right) {
        // While a mode is on, the second button is the way out of the mode —
        // before it is anything else. Otherwise it asks about what is under it.
        if (placementRef.current.stamping) {
          placementRef.current.stopStamping()
          return
        }
        const at = pointIn(event)
        placementRef.current.context(placementRef.current.pick(at), at)
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
      const mode = modeOf(event)

      // A modifier held over empty space changes nothing. Clearing would be the
      // one thing that makes this gesture not worth using: a selection built up
      // over six careful clicks, gone to a seventh that missed.
      if (entity === null && mode !== 'replace') return

      placementRef.current.select(entity, mode)
      if (entity === null) return

      // Only a plain press starts a move. Shift and Ctrl are about *which*
      // entities are selected, and a modified press that also began a drag
      // would move one entity out of a set the human was still assembling.
      if (mode !== 'replace') return

      placing = { id: event.pointerId, entity, x: event.clientX, y: event.clientY, moved: false }
      pressed.current = true
      element.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      // Kept up to date whatever else is going on, because it is what a grab
      // started later measures its travel from.
      pointerAt.current = { x: event.clientX, y: event.clientY }

      const grab = grabRef.current
      if (grab !== null) {
        // The first sighting of the pointer since `G` is the origin rather than
        // a movement. Without this a grab started with the cursor outside the
        // panel would throw the entity across the level on the way back in.
        if (grab.origin === null) grab.origin = pointerAt.current
        else applyGrab(event.ctrlKey || event.metaKey)
        return
      }

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

        // Read off the event rather than remembered from the press, so Ctrl can
        // be taken or let go mid-drag.
        lastMove.current = { entity: placing.entity, dx, dy }
        placementRef.current.moveBy(placing.entity, dx, dy, event.ctrlKey || event.metaKey)
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
        pressed.current = false
        setPanning(false)
        return
      }

      if (placing !== null && event.pointerId === placing.id) {
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
        placing = null
        pressed.current = false
        lastMove.current = null
        setDragging(null)
        // Always, even for a press that never moved: it seals the undo step, and
        // sealing one that was never opened costs nothing.
        placementRef.current.drop()
      }
    }

    const onPointerLeave = (): void => {
      // Where the pointer is stops being known, so a grab started while the hand
      // is somewhere else does not measure its travel from a point it left ten
      // minutes ago. A grab already running keeps the origin it has — its travel
      // is from where it started, and the pointer is free to leave and come back.
      if (grabRef.current === null) pointerAt.current = null
      if (holding === null && placing === null) setPicked(null)
    }

    // Chrome's autoscroll starts on the middle mousedown rather than on the
    // pointer event, and it is not always suppressed by preventing the pointer.
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button === 1 && enabledRef.current) event.preventDefault()
    }

    // The browser's menu never opens over the picture — not gated on `enabled`,
    // because while a level runs the right button is the game's, and the menu
    // appearing over a running game is the same wrong answer.
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
    }

    const onWheel = (event: WheelEvent): void => {
      if (!enabledRef.current) return
      // Always, including the ctrl-wheel a trackpad pinch arrives as: without
      // this the browser zooms the editor rather than the level.
      event.preventDefault()
      if (event.deltaY === 0) return
      // Prevented but ignored while a grab is running: the scale is what turns
      // the pointer's travel into level units, so zooming mid-grab would move
      // the entity without the pointer having moved at all.
      if (grabRef.current !== null) return

      zoom(pointIn(event), event.deltaY < 0 ? 1 : -1)
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', release)
    element.addEventListener('lostpointercapture', release)
    element.addEventListener('pointerleave', onPointerLeave)
    element.addEventListener('mousedown', onMouseDown)
    element.addEventListener('contextmenu', onContextMenu)
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
      element.removeEventListener('contextmenu', onContextMenu)
      element.removeEventListener('wheel', onWheel)
    }
  }, [host, pan, zoom, applyGrab, endGrab])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!enabledRef.current) return
      if (isTyping(event.target)) return

      /*
       * `Ctrl` while something is being moved is the snap modifier, and it is
       * answered here — above the guard below, which exists to let `Ctrl-Z`
       * through to the undo shortcuts and would otherwise swallow this.
       *
       * Only the modifier key *itself*, and only while a move is running, so
       * `Ctrl-Z` and every other Ctrl chord are untouched. The entity is put
       * down again on the press rather than on the next mouse movement — a grab
       * often has the pointer sitting perfectly still, and a modifier that
       * waited for a wobble would read as not having worked.
       */
      if (event.key === 'Control' || event.key === 'Meta') {
        if (reapply(true)) event.preventDefault()
        return
      }

      /*
       * Every other Ctrl chord belongs to the window — `Ctrl-Z` above all — and
       * is passed straight through. **Except while a grab is running**, because
       * a grab owns the keyboard: the block below has to see `X` and `Y` with
       * `Ctrl` held, which is precisely the hand position this feature creates.
       * The cost is that `Ctrl-Z` mid-grab is swallowed rather than undoing, and
       * that is the better answer anyway — a grab has an open merge run, and
       * reversing into it is the kind of half-taken-back move this hook is
       * careful about everywhere else. `Esc` is still the way to call it off.
       */
      if ((event.ctrlKey || event.metaKey) && grabRef.current === null) return

      const key = event.key.toLowerCase()

      /*
       * A grab owns the keyboard for as long as it runs. The snap modifier has
       * already been answered above it, which is the right order for the same
       * reason it used to be: `Ctrl` is exactly what the human is holding when
       * they decide to lock an axis or call the whole thing off, and a lock that
       * only worked with an empty hand would be a lock that stopped working
       * halfway through the gesture it exists for.
       *
       * Everything else is swallowed rather than passed on. `Home` and `F` both
       * move the camera, and moving the camera mid-grab changes what the travel
       * so far means.
       */
      if (grabRef.current !== null) {
        if (event.key === 'Escape') {
          event.preventDefault()
          endGrab('cancel')
        } else if (event.key === 'Enter') {
          event.preventDefault()
          endGrab('drop')
        } else if (key === 'x' || key === 'y') {
          event.preventDefault()
          lockGrab(key, event.ctrlKey || event.metaKey)
        }
        return
      }

      // Alt no longer means anything over the picture — the snap modifier is
      // Ctrl. Any Alt chord reaching here is the window's or the system's, so a
      // bare `f` inside one must not frame anything.
      if (event.altKey) return

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

      if (key === 'f') {
        event.preventDefault()
        const entity = selectedRef.current
        // Nothing selected means nothing to frame. Home is the other key.
        if (entity !== null) frameEntity(entity)
        return
      }

      // Nothing selected means nothing to grab — and no press is needed, which
      // is the whole point: the cursor is usually on top of the thing being
      // moved, so a gesture that had to start on the sprite is a gesture that
      // starts by hiding it.
      if (key === 'g') {
        event.preventDefault()
        startGrab()
        return
      }

      // Removes everything selected rather than the one entity `F` would frame
      // — the whole selection is what the human built, and it is one press of
      // Ctrl-Z to get it back (`editor/shell/useDeleteEntities.ts`).
      //
      // Every guard it needs has already run above it: `isTyping` keeps it out
      // of a name field, `enabled` keeps it out of a running level, and the
      // grab block keeps it out of a move in progress — a grab measures its
      // travel against an entity, and deleting that entity mid-move would leave
      // one running against nothing.
      if (event.key === 'Delete') {
        event.preventDefault()
        placementRef.current.deleteSelected()
        return
      }

      if (key === 'd' && event.shiftKey) {
        event.preventDefault()
        const entity = selectedRef.current
        if (entity !== null) duplicateRef.current(entity)
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setReady(false)
      // Letting the modifier go puts the entity back under the toggle, on the
      // spot — the other half of applying it on the press. Without this, a snap
      // turned off by Ctrl would stay off until the hand moved again.
      if (event.key === 'Control' || event.key === 'Meta') reapply(false)
    }

    // Alt-tabbing away while holding space would otherwise leave the editor
    // believing it is still held, and the next left-click would pan. A grab is
    // worse: it is driven by a pointer this window can no longer see, so it
    // would still be running — invisibly — when the human came back.
    const onBlur = (): void => {
      setReady(false)
      endGrab('cancel')
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [frameAll, frameEntity, startGrab, endGrab, lockGrab, reapply])

  /*
   * The two ways a grab can be ended by something other than the human.
   *
   * A level closing or Play starting takes the picture away, and the selection
   * moving to something else — which only another panel can do, since a press in
   * this one is consumed by the grab — leaves a move running on an entity whose
   * outline is no longer on screen. Both put the entity back rather than
   * dropping it where it happens to be: nothing was decided, so nothing should
   * be kept.
   */
  useEffect(() => {
    if (!enabled) endGrab('cancel')
  }, [enabled, endGrab])

  useEffect(() => {
    if (grabRef.current !== null && grabRef.current.entity !== selected) endGrab('cancel')
  }, [selected, endGrab])

  return { panning, ready: ready && enabled, picked: enabled ? picked : null, dragging, grabbing }
}

/**
 * What a press means for the selection, read off the modifiers.
 *
 * Shift before Ctrl when both are held, arbitrarily but consistently: one of
 * them has to win, and the alternative — doing nothing — is a press that
 * appears to have missed.
 *
 * `metaKey` counts as Ctrl for the Mac keyboards that reach this editor, the
 * same pairing `useUndoShortcuts` makes. Ctrl-left-click on a Mac also raises a
 * context menu, which this hook already suppresses over the picture, so taking
 * the entity out of the selection is all that happens.
 */
function modeOf(event: PointerEvent): SelectMode {
  if (event.shiftKey) return 'add'
  if (event.ctrlKey || event.metaKey) return 'remove'
  return 'replace'
}

/** Whether a key belongs to whatever the human is typing into. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}
