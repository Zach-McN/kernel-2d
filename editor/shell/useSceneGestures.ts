import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { Point } from '../../runtime'
import { angleFrom, tooNear } from './rotate'
import { alongAxis, factorFrom, reachFrom } from './scale'

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
 * the whole point of the paragraph after this one. **`Delete` — or `Backspace`,
 * which many keyboards have instead — removes everything selected**, from here
 * or from the Outliner. The key listener is
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
 * **`R` turns the selection, and it is `G` with a different verb.** A gizmo
 * follows the pointer with a line back to the pivot — one entity's own position,
 * or the mean of several, which then swing round it as one rigid group. A press
 * confirms, `Esc` puts them back. Everything the grab does about owning the
 * picture and about being taken away, this does identically, which is the point:
 * the second modal gesture is what turns "how a grab behaves" into a shape.
 *
 * **`S` scales the selection, and it is `R` with a different number.** The turn
 * measures a bearing from the pivot; the scale measures a *distance*, as a ratio
 * against the distance the pointer was at when `S` was pressed — so half the
 * reach is half the size, wherever the hand started. `X` and `Y` hold it to one
 * axis, and that axis is the **sprite's own**, not the level's: an entity's
 * `scaleX` stretches it along its own side however it is turned, which is what
 * makes the lock mean the same thing on a rotated sprite as on a straight one
 * (`./scale.ts`). Everything else — one press to confirm, `Esc` to put it back,
 * `Ctrl` for the snap — is the turn's, unchanged.
 *
 * **One modal gesture at a time, and it is now a rule rather than a
 * coincidence.** Each of `G`, `R` and `S` is refused while either of the others
 * runs. With one of them there was nothing to say; with three, "the selection is
 * being moved *and* turned *and* scaled by gestures measuring from three
 * origins" is a state worth being unable to reach.
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
   * `Delete` or `Backspace`. Removes whatever is selected, in one step.
   *
   * Here rather than behind a window listener of its own, because this hook has
   * already answered the four questions such a listener would have to re-answer
   * — is the human typing, is a grab running, is a level playing, is there a
   * scene at all — and a second listener would race this one on all four.
   */
  deleteSelected: () => void
  /**
   * Remember where these entities are and what they are turned to, and say
   * where they turn around — in the host's own pixels, for the gizmo's line.
   *
   * Null when there is nothing to turn: no scene, nothing selected, or entities
   * that have gone. The gesture then never starts, rather than starting and
   * doing nothing.
   */
  beginTurn: (entityIds: readonly string[]) => Point | null
  /**
   * Turn them all by this many degrees from where they started, rigidly about
   * the pivot. `invert` is `Ctrl`, exactly as it is for a move.
   *
   * **Returns the angle that actually landed**, which is not always the one
   * asked for: the snap lives on the other side of this call, so with the grid
   * on a pointer at 37° turns the group by 30°. The caption and the gizmo's arc
   * read the answer rather than the request, or they would describe a rotation
   * that did not happen.
   */
  turnBy: (degrees: number, invert: boolean) => number
  /** The turn is over: `drop` seals the undo step, `cancel` takes it all back. */
  endTurn: (how: 'drop' | 'cancel') => void
  /**
   * Remember where these entities are and how big they are, and say where they
   * scale away from — in the host's own pixels, for the gizmo's line.
   *
   * The turn's twin, down to the null: nothing to scale means the gesture never
   * starts, rather than starting and doing nothing.
   */
  beginScale: (entityIds: readonly string[]) => Point | null
  /**
   * Scale them all by this much from where they started, rigidly about the
   * pivot. A pair, so a lock to one axis is a 1 in the other rather than a
   * branch (`./scale.ts`). `invert` is `Ctrl`, exactly as it is for a move.
   *
   * **Returns the factor that actually landed**, for the reason `turnBy` does:
   * the snap lives on the other side of this call, so with the grid on a pointer
   * at ×1.17 grows the group by ×1.2, and the caption has to say what happened.
   */
  scaleBy: (factor: Point, invert: boolean) => Point
  /** The scale is over: `drop` seals the undo step, `cancel` takes it all back. */
  endScale: (how: 'drop' | 'cancel') => void
  /**
   * Remember where this entity is, without selecting it or moving it — what a
   * grab starts with, since it has no press to record it on.
   *
   * False when there is nothing to move: no scene, or an entity that has gone.
   * The gesture then never starts, rather than starting and doing nothing.
   */
  beginMove: (entityId: string) => boolean
  /**
   * Is this entity part of what is currently selected?
   *
   * Asked on a press so the gesture layer can tell "pick this one up" from
   * "pick up the group it is in" without holding a copy of the selection —
   * which would be a second answer to what is selected, refreshed on its own
   * schedule (`editor-ui` U9's argument, one layer down).
   */
  selected: (entityId: string) => boolean
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
  /**
   * The press ended, whether or not anything moved.
   *
   * `finished` is passed by the gestures that came from a press on an entity,
   * and carries the one thing only the release knows: whether the press ever
   * became a drag. A press that did not is a *click*, and a click inside a
   * multi-selection means "just this one" — see the note on the implementation.
   * A keyboard grab passes nothing, because it changes no selection.
   */
  drop: (finished?: { entity: string; moved: boolean }) => void
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
  /**
   * Every selected entity. What `R` turns — all of them, as one rigid group,
   * which is why this is the whole list rather than the primary one.
   */
  selectedEntities: readonly string[]
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

/**
 * A turn in progress, as anything drawing it needs to know it.
 *
 * Carries where to draw as well as what is happening, because the overlay's
 * standing rule is that it recomputes nothing: the pivot and the pointer are
 * both already in the host's pixels here, so the gizmo is drawn from what the
 * gesture actually used rather than from a second derivation of it.
 */
export interface Turn {
  /** Every entity being turned, in selection order. */
  entities: readonly string[]
  /** Where they turn around, in the host's pixels. */
  pivot: Point
  /** Where the pointer is, in the host's pixels — where the gizmo sits. */
  at: Point
  /** Where the line started, so the swept angle can be drawn as an arc. */
  from: Point
  /** How far it has turned so far, in degrees, as applied to the document. */
  degrees: number
}

/**
 * A scale in progress, as anything drawing it needs to know it.
 *
 * The turn's twin, carrying where to draw as well as what is happening, for the
 * same reason: the overlay recomputes nothing, so the pivot and the pointer are
 * already in the host's pixels here.
 */
export interface Scale {
  /** Every entity being scaled, in selection order. */
  entities: readonly string[]
  /** What they scale away from, in the host's pixels. */
  pivot: Point
  /** Where the pointer is, in the host's pixels — where the gizmo sits. */
  at: Point
  /** How far out the pointer was when `S` was pressed, in the host's pixels. */
  from: number
  /** How much bigger they are so far, as applied to the document. */
  factor: Point
  /** The axis the scale is held to, or null while it is both. */
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
  /** The keyboard turn in progress, or null. */
  turning: Turn | null
  /** The keyboard scale in progress, or null. */
  scaling: Scale | null
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

/**
 * A turn as the listeners hold it: the same thing, plus the angle it started at.
 *
 * `origin` is null until the pointer is next seen over the picture, which is
 * what makes `R` work with the cursor anywhere — the same treatment a grab's
 * origin gets, and for the same reason: there is no sensible angle to measure
 * from until the hand comes back.
 */
interface LiveTurn extends Turn {
  /** The pointer's angle from the pivot when `R` was pressed, or null. */
  origin: number | null
}

/**
 * A scale as the listeners hold it: the same thing, plus the reach it started
 * at.
 *
 * Null until the pointer is next seen far enough from the pivot to measure
 * from, which is the same treatment the other two modal gestures give their
 * origins — `S` works with the hand anywhere, including outside the panel.
 */
interface LiveScale extends Scale {
  /** The pointer's distance from the pivot when `S` was pressed, or null. */
  origin: number | null
}

/** How far the pointer travels before a click becomes a drag, in CSS pixels. */
const DRAG_THRESHOLD = 3

export function useSceneGestures(options: SceneGestureOptions): SceneGestures {
  const {
    host,
    enabled,
    pan,
    zoom,
    frameAll,
    frameEntity,
    selected,
    selectedEntities,
    duplicate,
    placement,
  } = options

  const [panning, setPanning] = useState(false)
  const [ready, setReady] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [grabbing, setGrabbing] = useState<Grab | null>(null)
  const [turning, setTurning] = useState<Turn | null>(null)
  const [scaling, setScaling] = useState<Scale | null>(null)

  // Read inside listeners that are attached once. Set during render so a
  // listener never sees a value from the render before last. `placement` in
  // particular is rebuilt whenever the picture changes, and re-attaching every
  // listener on every redraw would drop a gesture mid-drag.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const selectedEntitiesRef = useRef(selectedEntities)
  selectedEntitiesRef.current = selectedEntities
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
  /** The turn, held for the same reason and read by the same two listener sets. */
  const turnRef = useRef<LiveTurn | null>(null)
  /** And the scale, which is the turn again with a distance instead of a bearing. */
  const scaleRef = useRef<LiveScale | null>(null)
  /** Where the pointer was last seen over the picture, in client pixels. */
  const pointerAt = useRef<Point | null>(null)
  /**
   * The same sighting, in the host's own pixels.
   *
   * Two refs rather than one conversion, because the two gestures want different
   * things. A move is a *delta*, and a delta is the same number in either space,
   * so the grab is happy with client pixels. A turn is an *angle about a fixed
   * point*, which needs both ends in one space — and the pivot has to be in host
   * pixels because that is the space the overlay draws the gizmo in.
   */
  const pointerInHost = useRef<Point | null>(null)
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
  /**
   * The entities, turned to wherever the pointer has got to.
   *
   * The angle is **measured, not accumulated**: it is the pointer's bearing from
   * the pivot now, less its bearing when `R` was pressed. Adding up per-frame
   * deltas would let rounding creep over a long turn — the same rule the drag
   * keeps about travel, and here it is also what makes a full circle land
   * exactly where it started.
   *
   * How far it *actually* turned comes back from the placement rather than being
   * assumed, because the snap lives there: with the grid on, a pointer at 37°
   * turns the group by 30°, and the caption and the gizmo's arc must say 30 or
   * they are describing a rotation that did not happen.
   */
  const applyTurn = useCallback((invert: boolean): void => {
    const turn = turnRef.current
    const at = pointerInHost.current
    if (turn === null || turn.origin === null || at === null) return
    // Too near the middle for a bearing to mean anything: keep the angle it has
    // rather than letting a pixel of noise spin the group (`./rotate.ts`).
    if (tooNear(turn.pivot, at)) return

    const wanted = angleFrom(turn.pivot, at) - turn.origin
    const degrees = placementRef.current.turnBy(wanted, invert)
    turnRef.current = { ...turn, at, degrees }
    setTurning({ entities: turn.entities, pivot: turn.pivot, at, from: turn.from, degrees })
  }, [])

  /**
   * The entities, scaled to wherever the pointer has got to.
   *
   * The factor is **measured, not accumulated** — the pointer's distance from
   * the pivot now over its distance when `S` was pressed — which is `applyTurn`'s
   * rule and matters more here: multiplying a multiplied number means that
   * scaling out and back does not return the group to the size it started at,
   * and nothing on screen would say so.
   *
   * How far it *actually* scaled comes back from the placement rather than being
   * assumed, because the snap lives there: with the grid on, a pointer at ×1.17
   * grows the group by ×1.2, and the caption and the gizmo must say ×1.2.
   */
  const applyScale = useCallback((invert: boolean): void => {
    const scale = scaleRef.current
    const at = pointerInHost.current
    if (scale === null || scale.origin === null || at === null) return
    // Too near the middle for a distance to mean anything: keep the factor it
    // has rather than letting a pixel of noise collapse the group to nothing.
    if (tooNear(scale.pivot, at)) return

    const wanted = factorFrom(scale.origin, reachFrom(scale.pivot, at))
    const factor = placementRef.current.scaleBy(alongAxis(wanted, scale.axis), invert)
    scaleRef.current = { ...scale, at, factor }
    setScaling({ entities: scale.entities, pivot: scale.pivot, at, from: scale.from, factor, axis: scale.axis })
  }, [])

  /**
   * Whatever is being moved, turned or scaled, put down again under a modifier
   * that has just changed.
   *
   * One function for all three so the `Ctrl` handler does not have to know which
   * is running — it asks for "again, with this modifier" and gets it. A move
   * replays its remembered travel; a turn and a scale re-measure, which is free
   * because neither was ever accumulated in the first place.
   */
  const reapply = useCallback(
    (invert: boolean): boolean => {
      if (turnRef.current !== null) {
        applyTurn(invert)
        return true
      }
      if (scaleRef.current !== null) {
        applyScale(invert)
        return true
      }
      const move = lastMove.current
      if (move === null) return false
      placementRef.current.moveBy(move.entity, move.dx, move.dy, invert)
      return true
    },
    [applyTurn, applyScale],
  )

  const endTurn = useCallback((how: 'drop' | 'cancel'): void => {
    if (turnRef.current === null) return
    turnRef.current = null
    setTurning(null)
    placementRef.current.endTurn(how)
  }, [])

  /**
   * `R`: start turning everything selected about its mean pivot.
   *
   * Refused while anything else modal is running — a grab, a press, or a
   * repeat-placing mode — for the reason written at the top of this file: two
   * gestures measuring from two origins is a state worth being unable to reach.
   */
  const startTurn = useCallback((): void => {
    if (turnRef.current !== null || grabRef.current !== null || scaleRef.current !== null) return
    if (pressed.current || placementRef.current.stamping) return

    const entities = selectedEntitiesRef.current
    if (entities.length === 0) return

    const pivot = placementRef.current.beginTurn(entities)
    if (pivot === null) return

    // The bearing is null until the pointer is next seen, so `R` works with the
    // hand anywhere — including outside the panel, where there is no angle to
    // measure from until it comes back.
    const at = pointerInHost.current
    const origin = at === null || tooNear(pivot, at) ? null : angleFrom(pivot, at)
    const from = at ?? pivot

    turnRef.current = { entities, pivot, at: from, from, degrees: 0, origin }
    setTurning({ entities, pivot, at: from, from, degrees: 0 })
  }, [])

  const endScale = useCallback((how: 'drop' | 'cancel'): void => {
    if (scaleRef.current === null) return
    scaleRef.current = null
    setScaling(null)
    placementRef.current.endScale(how)
  }, [])

  /**
   * `S`: start scaling everything selected about its mean pivot.
   *
   * `startTurn` with a different verb, refusals and all — one modal gesture at a
   * time, because two of them measuring from two origins is a state worth being
   * unable to reach.
   */
  const startScale = useCallback((): void => {
    if (scaleRef.current !== null || turnRef.current !== null || grabRef.current !== null) return
    if (pressed.current || placementRef.current.stamping) return

    const entities = selectedEntitiesRef.current
    if (entities.length === 0) return

    const pivot = placementRef.current.beginScale(entities)
    if (pivot === null) return

    // The reach is null until the pointer is next seen, so `S` works with the
    // hand anywhere — including outside the panel, and including sitting on the
    // pivot, where there is no distance to measure a ratio against.
    const at = pointerInHost.current
    const origin = at === null || tooNear(pivot, at) ? null : reachFrom(pivot, at)
    const started: Scale = {
      entities,
      pivot,
      at: at ?? pivot,
      from: origin ?? 0,
      factor: { x: 1, y: 1 },
      axis: null,
    }

    scaleRef.current = { ...started, origin }
    setScaling(started)
  }, [])

  /**
   * `X` or `Y` while a scale is running: hold it to that axis, and put the
   * entities down again on the spot.
   *
   * The grab's lock exactly — including that pressing the axis it is already
   * held to lets it go again — and for the same reason it applies immediately:
   * the human pressed `X` because they want the vertical stretch gone *now*.
   *
   * The one difference is that letting an axis go has to put the *other* one
   * back: while locked to X the entities were left at their original height, and
   * a free scale means both axes carry the factor. Re-applying does that,
   * because everything is measured from the remembered start rather than from
   * where the group has got to.
   */
  const lockScale = useCallback(
    (axis: 'x' | 'y', invert: boolean): void => {
      const scale = scaleRef.current
      if (scale === null) return

      const held = scale.axis === axis ? null : axis
      scaleRef.current = { ...scale, axis: held }
      setScaling({ ...scale, axis: held })
      applyScale(invert)
    },
    [applyScale],
  )

  const endGrab = useCallback((how: 'drop' | 'cancel'): void => {
    if (grabRef.current === null) return
    grabRef.current = null
    lastMove.current = null
    setGrabbing(null)
    if (how === 'cancel') placementRef.current.cancelMove()
    else placementRef.current.drop()
  }, [])

  const startGrab = useCallback((): void => {
    if (grabRef.current !== null || turnRef.current !== null || scaleRef.current !== null) return
    if (pressed.current) return
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

      // A modal gesture owns the picture, so finishing it is the whole of what
      // this press does — it picks nothing, changes no selection and starts no
      // pan. Above space, deliberately: the entity is already in the air and the
      // human has to be able to put it down without letting go of anything.
      // The right button is swallowed with everything else: Esc is the way out.
      if (grabRef.current !== null) {
        if (left) endGrab('drop')
        return
      }

      if (turnRef.current !== null) {
        if (left) endTurn('drop')
        return
      }

      if (scaleRef.current !== null) {
        if (left) endScale('drop')
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

      /*
       * **A press inside the selection does not collapse it**, which is what
       * makes a group draggable at all: the whole point of pressing one of six
       * selected sprites is usually to move all six. The selection layer is
       * asked instead to remember where everything is and start a move.
       *
       * A press on something *not* selected replaces the selection first, as it
       * always has. Which of the two happened is decided by `beginMove` from the
       * selection as it was before this press — the only reading available here,
       * since React has not re-rendered, and the right one either way.
       *
       * The click that *does* collapse a group is the one that never moves, and
       * it is answered on the release: until the pointer travels, nobody knows
       * whether this was a click or the start of a drag.
       */
      if (entity !== null && mode === 'replace' && placementRef.current.selected(entity)) {
        placementRef.current.beginMove(entity)
      } else {
        placementRef.current.select(entity, mode)
      }
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
      // Kept up to date whatever else is going on, because it is what a gesture
      // started later measures its travel — or its bearing — from.
      pointerAt.current = { x: event.clientX, y: event.clientY }
      pointerInHost.current = pointIn(event)

      const turn = turnRef.current
      if (turn !== null) {
        // The first sighting since `R` is the bearing to measure from rather
        // than a movement, exactly as a grab's first sighting is its origin.
        if (turn.origin === null) {
          if (!tooNear(turn.pivot, pointerInHost.current)) {
            const at = pointerInHost.current
            turnRef.current = { ...turn, origin: angleFrom(turn.pivot, at), at, from: at }
            setTurning({ entities: turn.entities, pivot: turn.pivot, at, from: at, degrees: 0 })
          }
        } else {
          applyTurn(event.ctrlKey || event.metaKey)
        }
        return
      }

      const scale = scaleRef.current
      if (scale !== null) {
        // The first sighting since `S` is the reach to measure from rather than
        // a movement, exactly as a turn's first sighting is its bearing.
        if (scale.origin === null) {
          if (!tooNear(scale.pivot, pointerInHost.current)) {
            const at = pointerInHost.current
            const from = reachFrom(scale.pivot, at)
            scaleRef.current = { ...scale, origin: from, at, from }
            setScaling({ ...scale, at, from })
          }
        } else {
          applyScale(event.ctrlKey || event.metaKey)
        }
        return
      }

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
        const finished = { entity: placing.entity, moved: placing.moved }
        placing = null
        pressed.current = false
        lastMove.current = null
        setDragging(null)
        // Always, even for a press that never moved: it seals the undo step, and
        // sealing one that was never opened costs nothing. What it also carries
        // is whether this press was a click, which is what decides whether a
        // multi-selection collapses onto the entity under it.
        placementRef.current.drop(finished)
      }
    }

    const onPointerLeave = (): void => {
      // Where the pointer is stops being known, so a gesture started while the
      // hand is somewhere else does not measure from a point it left ten minutes
      // ago. One already running keeps the origin it has — it measures from
      // where it started, and the pointer is free to leave and come back.
      if (grabRef.current === null && turnRef.current === null && scaleRef.current === null) {
        pointerAt.current = null
        pointerInHost.current = null
      }
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
      // the entity without the pointer having moved at all. A turn is worse —
      // zooming moves the pivot on screen, so the bearing it was measured from
      // stops meaning anything and the group jumps. A scale is worst of the
      // three: its whole number is a ratio of two on-screen distances, and the
      // wheel changes the second one without the hand moving.
      if (grabRef.current !== null || turnRef.current !== null || scaleRef.current !== null) return

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
  }, [host, pan, zoom, applyGrab, endGrab, applyTurn, endTurn, applyScale, endScale])

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
      if (
        (event.ctrlKey || event.metaKey) &&
        grabRef.current === null &&
        turnRef.current === null &&
        scaleRef.current === null
      ) {
        return
      }

      const key = event.key.toLowerCase()

      /*
       * A turn owns the keyboard the same way a grab does, and offers less:
       * there is one axis to rotate about in a flat level, so there is no lock
       * to spell. Put it down, or put it back.
       */
      if (turnRef.current !== null) {
        if (event.key === 'Escape') {
          event.preventDefault()
          endTurn('cancel')
        } else if (event.key === 'Enter') {
          event.preventDefault()
          endTurn('drop')
        }
        return
      }

      /*
       * A scale owns the keyboard exactly as a grab does, and offers the same
       * two axis keys — for a different reason. A grab's lock is about *where*
       * the entity may travel; a scale's is about which way the sprite stretches,
       * along its own axes rather than the level's (`./scale.ts`). One key, one
       * hand position, two meanings decided by which gesture is running.
       */
      if (scaleRef.current !== null) {
        if (event.key === 'Escape') {
          event.preventDefault()
          endScale('cancel')
        } else if (event.key === 'Enter') {
          event.preventDefault()
          endScale('drop')
        } else if (key === 'x' || key === 'y') {
          event.preventDefault()
          lockScale(key, event.ctrlKey || event.metaKey)
        }
        return
      }

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

      // Nothing selected means nothing to turn. The whole selection goes, not
      // the primary one: several entities turn as one rigid group about the
      // mean of their positions (`./rotate.ts`).
      if (key === 'r') {
        event.preventDefault()
        startTurn()
        return
      }

      // Nothing selected means nothing to scale. The whole selection again, as
      // one rigid group about the mean of their positions — a turn with a
      // different verb, which is what made it worth having (`./scale.ts`).
      if (key === 's') {
        event.preventDefault()
        startScale()
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
      // `Backspace` alongside `Delete`, because a great many keyboards — every
      // compact and most laptop layouts — have no `Delete` key at all, and
      // because reaching for Backspace to remove a thing is what hands do. There
      // is no case where one should work and the other should not: they are one
      // key with two names here, and every guard above applies to both.
      //
      // The typing guard is what makes this safe rather than reckless: inside a
      // name field Backspace is still a backspace, because this handler has
      // already returned.
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Prevented for a second reason than the rest: older browsers spend a
        // bare Backspace on going *back a page*, which would throw away the
        // editor's whole window state.
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
    // believing it is still held, and the next left-click would pan. A modal
    // gesture is worse: it is driven by a pointer this window can no longer see,
    // so it would still be running — invisibly — when the human came back.
    const onBlur = (): void => {
      setReady(false)
      endGrab('cancel')
      endTurn('cancel')
      endScale('cancel')
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [
    frameAll,
    frameEntity,
    startGrab,
    startTurn,
    startScale,
    endGrab,
    endTurn,
    endScale,
    lockGrab,
    lockScale,
    reapply,
  ])

  /*
   * The two ways a modal gesture can be ended by something other than the human.
   *
   * A level closing or Play starting takes the picture away, and the selection
   * moving to something else — which only another panel can do, since a press in
   * this one is consumed by the gesture — leaves it running on entities whose
   * outlines are no longer on screen. Both put everything back rather than
   * dropping it where it happens to be: nothing was decided, so nothing should
   * be kept.
   *
   * A turn watches the *whole* selection rather than one entity, and compares by
   * content rather than by identity: the selection list is rebuilt on every
   * render, so `!==` would cancel every turn on its first frame.
   */
  useEffect(() => {
    if (!enabled) {
      endGrab('cancel')
      endTurn('cancel')
      endScale('cancel')
    }
  }, [enabled, endGrab, endTurn, endScale])

  useEffect(() => {
    if (grabRef.current !== null && grabRef.current.entity !== selected) endGrab('cancel')
  }, [selected, endGrab])

  const selectionKey = selectedEntities.join(' ')
  useEffect(() => {
    if (turnRef.current !== null && turnRef.current.entities.join(' ') !== selectionKey) {
      endTurn('cancel')
    }
    if (scaleRef.current !== null && scaleRef.current.entities.join(' ') !== selectionKey) {
      endScale('cancel')
    }
  }, [selectionKey, endTurn, endScale])

  return {
    panning,
    ready: ready && enabled,
    picked: enabled ? picked : null,
    dragging,
    grabbing,
    turning,
    scaling,
  }
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
