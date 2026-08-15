import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'

import {
  describeLoadProblem,
  inSceneUnits,
  storyStore,
  toScenePoint,
  type Point,
  type SceneRequest,
  type ShownScene,
} from '../../runtime'
import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import { basename } from '../shell/asset-kinds'
import { entityAt, onScreen } from '../shell/drawn-entities'
import { useOpenScene, type OpenSceneState } from '../shell/open-scene'
import { usePlacing, type Placing } from '../shell/placing'
import { comparePictures, describeComparison, type PlayComparison } from '../shell/play-comparison'
import { usePlayMode, type PlayState } from '../shell/play-mode'
import { useProject } from '../shell/project-context'
import { useRunningLevel, type RunSeams } from '../shell/running-level'
import { describeProblem, problemsIn, useSceneAssets } from '../shell/scene-assets'
import { describePrefabProblem, prefabProblemsIn, useResolvedScene } from '../shell/scene-prefabs'
import { useDrawScene, useSceneView, type SceneViewState } from '../shell/scene-view-context'
import { pivotOf, shortestTurn, turnAbout, type Moved, type Turned } from '../shell/rotate'
import { ANGLE_STEP, SNAP_INTERVALS, freely, placeOn, turnOn } from '../shell/snap'
import { useSceneDropTarget, type SceneDropTarget } from '../shell/useSceneDropTarget'
import { useSceneGestures, type Grab, type ScenePlacement, type Turn } from '../shell/useSceneGestures'
import { useSelection } from '../shell/selection'
import { useDeleteEntities } from '../shell/useDeleteEntities'
import { useDuplicateEntity } from '../shell/useDuplicateEntity'
import { usePlacePrefab } from '../shell/usePlacePrefab'
import { describeZoom } from '../shell/zoom'
import { abandonEdits, editDocument, sealEdits } from '../store/open-documents'
import { EntityPopover } from './EntityPopover'
import { NumberField } from './NumberField'
import { SceneOverlay, describeScene } from './SceneOverlay'

/**
 * The open scene, drawn by the real runtime — and, when Play is pressed, the
 * same level as the runtime reads it off disk for itself.
 *
 * The panel's own job is small: host the canvas, measure itself, mark what is
 * selected, carry the gestures that drive the camera, and say what is going on
 * whenever there is no picture. The drawing is the runtime's, the scene is the
 * document store's, what its instances inherit is `scene-prefabs.tsx`, which
 * textures all of that needs is `scene-assets.tsx`, and where the camera is
 * looking is `scene-view-context.tsx` — this panel fetches nothing of its own,
 * so the picture and the Outliner and the Inspector are all describing one
 * object (`editor-ui` U12).
 *
 * It draws the **resolved** entities and edits the document, which is the rule
 * every panel that touches a level now keeps (`editor-ui` U23).
 *
 * Where the human is looking is not in the level. It lives for as long as the
 * window does, never reaches the document, and never reaches the scene file —
 * so Ctrl-Z after a pan reverses the last thing that was *changed*.
 *
 * **Play mode is a change of subject, plus a clock.** The renderer, the canvas
 * and the camera are all the same objects; what differs is that the request
 * comes from `runtime/scene/load-scene.ts` — which opened the file itself —
 * instead of from the editor's own resolution of it, and that once that picture
 * is on screen the runtime starts stepping a copy of it (`../shell/running-level.ts`).
 * Stop is still free: the copy is dropped, and the editing resolution has been
 * kept up to date behind the running picture the whole time. Four things follow,
 * and each is one line below: the gestures go off, so the camera cannot move and
 * the two pictures stay comparable; the framing effect is told the picture is
 * incomplete, so a running level can never re-frame the editing view; the
 * selection outline is not drawn over a running game; and the clock cannot start
 * until the picture the comparison is about has been drawn.
 */
export function ViewportPanel(): ReactElement {
  const selection = useSelection()
  const open = useOpenScene()
  const view = useSceneView()
  const assets = useSceneAssets()
  const resolved = useResolvedScene()
  const mode = usePlayMode()
  const host = useRef<HTMLDivElement>(null)

  const running = mode.play.state === 'running' ? mode.play : null

  // The **resolved** entities, not the file's own: an instance's picture is
  // named by the prefab it points at, so drawing the scene as written would show
  // every placed prefab as nothing. This copy is handed to the renderer and
  // nowhere else — every edit below writes through the transaction API, which
  // re-finds its entity in the document (`editor/shell/scene-prefabs.tsx`).
  const editing: SceneRequest | null =
    open.state === 'open'
      ? {
          path: open.path,
          scene: { ...open.scene, entities: [...resolved.entities] },
          textures: assets.textures,
        }
      : null

  // While a level runs, the picture is the runtime's own reading of the file.
  // The editor's resolution of the same level carries on being kept up to date
  // behind it, which is why Stop needs to do nothing but change this back.
  const subject = running?.request ?? editing

  // The second argument is what stops a level being framed against half of
  // itself: until every prefab and every texture has resolved, entities whose
  // sprite has not arrived count as points rather than as the area they cover.
  // Never true while a level is running — framing off a play report would move
  // the camera the human left, and Stop is meant to put them back exactly.
  const settled = useDrawScene(
    subject,
    !mode.active && subject !== null && !assets.loading && !resolved.loading,
    running === null ? 'editing' : 'playing',
  )

  const shown = view.state === 'ready' ? view.shown : null
  // Only the scene that is open, in case a report from the previous one is
  // still the last thing the renderer answered with.
  const current = shown !== null && subject !== null && shown.path === subject.path ? shown : null

  // The running level and the editing view are two pictures of one path, so the
  // path cannot tell them apart. Identity can.
  const playing =
    running !== null && view.state === 'ready' && view.shownFor === running.request ? current : null
  const comparison = usePlayComparison(running, playing, open)

  // The game's two ways out of its own entity list: a door asks play mode to
  // travel, and the story sleeps in the browser's storage under the project's
  // name — the same facts an exported folder of this game would keep.
  const project = useProject()
  const projectName = project.state === 'ready' ? project.tree.projectName : null
  const seams = useMemo<RunSeams | null>(() => {
    if (running === null || projectName === null) return null
    const store = storyStore(projectName)
    return {
      door: mode.go,
      story: { scene: running.path, recall: store.recall, remember: store.remember },
    }
  }, [running, projectName, mode.go])

  // Time starts here, and only once the picture above exists — so the level is
  // compared with the editing view on the frame it started, before any system
  // has moved anything. Everything after that frame is the runtime's, drawn
  // straight to the canvas without passing through React.
  const runningLevel = useRunningLevel(
    running?.request.scene.entities ?? null,
    playing !== null,
    host,
    playing,
    seams,
    running?.request.music ?? null,
  )

  // The primary entity — what `F` frames, what `G` grabs, what the caption
  // names. The whole selection is next door, and only the outline and the
  // Delete key are about all of it.
  const selected = selection.selectedEntity
  const removal = useDeleteEntities()
  const ready = view.state === 'ready' ? view : null

  // The right-click window: which entity it is about, where it sits in the
  // stage's pixels, and the camera it was opened under — it is anchored in
  // screen space, so a camera that moves takes its anchor away.
  const [popover, setPopover] = useState<PopoverAnchor | null>(null)

  const openPopover = (entityId: string | null, at: Point): void => {
    // A right-click on empty space asks about nothing, which closes whatever
    // was open — the same press that would have opened one, pointed away.
    if (entityId === null || current === null || open.state !== 'open') {
      setPopover(null)
      return
    }
    // Selected as well as asked about, so the outline, the Inspector and this
    // window all describe one entity.
    selection.selectEntity(open.path, entityId)
    // Next to the click, kept inside the stage: near an edge, "next to" means
    // the near side rather than hanging off the picture.
    const box = host.current?.getBoundingClientRect()
    setPopover({
      entity: entityId,
      at: {
        x: Math.max(8, Math.min(at.x + 12, (box?.width ?? 0) - POPOVER_ROOM.width)),
        y: Math.max(8, Math.min(at.y + 8, (box?.height ?? 0) - POPOVER_ROOM.height)),
      },
      camera: { scale: current.camera.scale, x: current.camera.focus.x, y: current.camera.focus.y },
    })
  }

  const closePopover = (): void => {
    setPopover(null)
    // Focus back on the picture, so Esc closing the window leaves the
    // viewport's own keys working without another click.
    host.current?.focus({ preventScroll: true })
  }

  const placing = usePlacing()
  const stamp = usePlacePrefab(placing.stamping)
  const placement = usePlacement(open, current, placing, stamp, openPopover, removal.deleteSelected)
  const copy = useDuplicateEntity()
  const gestures = useSceneGestures({
    host,
    enabled: current !== null && !mode.active,
    pan: ready?.pan ?? noPan,
    zoom: ready?.zoom ?? noZoom,
    frameAll: ready?.frameAll ?? noop,
    frameEntity: ready?.frameEntity ?? noop,
    selected,
    selectedEntities: removal.entities,
    duplicate: copy.duplicate,
    placement,
  })

  // A file let go over the picture. Off while a level is running, like every
  // other way of changing one.
  const dropTarget = useSceneDropTarget({ shown: current, enabled: !mode.active })

  const camera = current?.camera ?? null
  const visible = current === null ? null : onScreen(current)

  /*
   * Everything that takes the popover's situation away closes it: the entity
   * going, the selection moving elsewhere, the camera moving (the window is
   * anchored in screen space, so a moved camera leaves it pointing at
   * nothing), a drag or grab starting, the level closing, Play starting. The
   * same list-of-ways-out thinking as a grab's (`editor-ui` U33).
   */
  useEffect(() => {
    if (popover === null) return
    const entityGone =
      open.state !== 'open' || !open.scene.entities.some((one) => one.id === popover.entity)
    const cameraMoved =
      current === null ||
      current.camera.scale !== popover.camera.scale ||
      current.camera.focus.x !== popover.camera.x ||
      current.camera.focus.y !== popover.camera.y
    if (
      entityGone ||
      cameraMoved ||
      mode.active ||
      selected !== popover.entity ||
      gestures.dragging !== null ||
      gestures.grabbing !== null ||
      gestures.turning !== null
    ) {
      setPopover(null)
    }
  }, [popover, open, current, mode.active, selected, gestures.dragging, gestures.grabbing, gestures.turning])

  const popoverEntity =
    popover === null || open.state !== 'open'
      ? null
      : (open.scene.entities.find((one) => one.id === popover.entity) ?? null)

  // Dragged with the button held, or grabbed with the keyboard — two gestures,
  // one situation to describe, so the caption and the outline do not have to
  // know which of them is going on.
  const moving = gestures.dragging ?? gestures.grabbing?.entity ?? null
  const beingMoved =
    moving === null || open.state !== 'open'
      ? null
      : (open.scene.entities.find((one) => one.id === moving) ?? null)

  return (
    <div
      className="viewport scene"
      data-testid="viewport-panel"
      data-scene-showing={current?.path ?? ''}
      data-scene-drawn={current === null ? '' : String(current.entities.filter((e) => e.bounds !== null).length)}
      // The picture in the level's own units. Every other hook here is in screen
      // pixels, which is the right unit for anything drawn over this canvas and
      // the wrong one for comparing this picture with a picture of the same level
      // somewhere else — an exported game is a differently-sized window and so a
      // different framing. In level units the two agree exactly, which is what
      // makes "the folder I shipped draws what the editor drew" checkable rather
      // than eyeballed. One shared function, on the renderer's own report
      // (`runtime/scene/drawn-in-scene.ts`).
      //
      // While a level is running this is the frame it **started** on, and that is
      // the useful half of the pair rather than a limitation: it is the picture
      // the comparison against the editing view is about, and the one an exported
      // game's own starting picture is checked against. Where the level has got
      // to since is next door, in `data-play-units`.
      data-scene-units={current === null ? '' : JSON.stringify(inSceneUnits(current))}
      // The camera as it was asked for. The sub-pixel nudge the renderer adds on
      // top is presentation and is deliberately not here; `drawnWith` on the
      // report is where anything inverting the picture gets it from.
      data-scene-scale={camera === null ? '' : String(camera.scale)}
      data-scene-focus-x={camera === null ? '' : String(camera.focus.x)}
      data-scene-focus-y={camera === null ? '' : String(camera.focus.y)}
      data-scene-onscreen={visible === null ? '' : String(visible.count)}
      data-scene-picked={gestures.picked ?? ''}
      // How many entities are selected, and which ones. Read from the outside
      // as the answer to "did Shift-click add one" without going through the
      // overlay's own marks.
      data-scene-selected-count={String(removal.entities.length)}
      data-scene-selected={removal.entities.join(' ')}
      data-popover-entity={popover?.entity ?? ''}
      data-scene-dragging={gestures.dragging ?? ''}
      data-scene-grabbing={gestures.grabbing?.entity ?? ''}
      data-scene-grab-axis={gestures.grabbing?.axis ?? ''}
      // The turn, as the outside reads it: which entities, and how far round.
      // Empty whenever nothing is turning, which is how "R did nothing" is read.
      data-scene-turning={gestures.turning?.entities.join(' ') ?? ''}
      data-scene-turn-degrees={
        gestures.turning === null ? '' : String(shortestTurn(gestures.turning.degrees))
      }
      data-play-state={mode.play.state}
      data-play-scene={mode.play.state === 'stopped' ? '' : mode.play.path}
      data-play-match={comparison?.kind ?? ''}
      data-play-differences={comparison?.kind === 'different' ? String(comparison.differences.length) : ''}
      data-play-problems={running === null ? '' : String(running.problems.length)}
      // Where the running level has got to, in its own units, and how many steps
      // it took to get there. Updated ten times a second while the picture itself
      // is drawn sixty — the editor describes a running level, it does not drive
      // one. Empty whenever nothing is running, which is also how "nothing moves
      // in edit mode" is read from the outside.
      data-play-units={runningLevel === null ? '' : JSON.stringify(runningLevel.units)}
      data-play-steps={runningLevel === null ? '' : String(runningLevel.steps)}
      // What the sound is doing, read back off the sound system itself
      // (`phaser4-runtime` P4) — never an echo of what was asked for. Kept
      // fresh by the same ten-a-second description a running level already
      // publishes; empty whenever nothing runs, which is also how "editing is
      // silent" is read from the outside.
      data-play-music={running === null || view.state !== 'ready' ? '' : view.musicState()}
      // And what the game's own effects are doing, read back off the audio
      // clock the same way — `playing` while a cue is still sounding.
      data-play-sound={running === null || view.state !== 'ready' ? '' : view.soundState()}
    >
      <Stage
        host={host}
        view={view}
        grab={grabOf(gestures, placing.stamping !== null && !mode.active)}
        drop={dropTarget}
      >
        {/* No editor marks over a running game. */}
        {current !== null && !mode.active && (
          <SceneOverlay
            shown={current}
            selected={removal.entities}
            axis={gestures.grabbing?.axis ?? null}
            turning={gestures.turning}
          />
        )}
        {current !== null && !mode.active && popover !== null && popoverEntity !== null && open.state === 'open' && (
          <EntityPopover scenePath={open.path} entity={popoverEntity} at={popover.at} onClose={closePopover} />
        )}
      </Stage>

      {mode.play.state !== 'stopped' ? (
        <PlayCaption
          play={mode.play}
          onStop={mode.stop}
          comparison={comparison}
          undrawable={playing?.undrawable ?? []}
        />
      ) : (
        <Caption
          open={open}
          view={view}
          problems={problemsIn(assets)}
          prefabProblems={prefabProblemsIn(resolved)}
          selected={selected}
          offScreen={offScreenIn(open, current, selected)}
          moving={beingMoved}
          grab={gestures.grabbing}
          // The selection *is* what a move carries, by construction rather than
          // by being told: a press inside the selection keeps it and moves all
          // of it, and a press outside replaces it with the one entity it then
          // moves. So this needs no second copy of that rule to count from.
          movingCount={removal.entities.length}
          turning={gestures.turning}
          placing={placing}
          stampingName={
            placing.stamping === null ? null : (stamp.prefabName ?? basename(placing.stamping))
          }
          dropping={dropTarget.over ? dropTarget.carrying : null}
          dropRefused={dropTarget.refused}
          onPlay={mode.start}
          // Not merely "there is a picture": a level's textures arrive one at a
          // time, so a report can be a real report of this level with half of it
          // missing. Play would then run against a baseline the human never
          // actually saw, and the comparison would be checking the running level
          // against a half-drawn one.
          //
          // **A move in progress is its own reason, stated rather than relied
          // upon**, and that last clause is the whole of a bug this button had.
          // `settled` means "the picture on screen is of the level as it is
          // now", which during a move is true whenever the renderer has caught
          // up — so it went false on every mouse movement and true again in
          // every pause between them, and the button flickered. It flickered
          // *worst* in a `G` grab, where the hand is often perfectly still and
          // the move is nowhere near finished. A readiness signal is sampled;
          // an intent is not. Gating on the gesture makes the answer steady for
          // as long as the gesture lasts, which is what the human sees.
          canPlay={
            current !== null &&
            settled &&
            !assets.loading &&
            !resolved.loading &&
            gestures.dragging === null &&
            gestures.grabbing === null &&
            gestures.turning === null
          }
        />
      )}
    </div>
  )
}

/**
 * How the running level compares with the editing view it replaced.
 *
 * Only ever computed from a report that is definitely of the *running* level:
 * for the render or two between Play being pressed and the runtime's picture
 * arriving, the report on screen is still the editing view's, and comparing that
 * with itself would announce a match nobody had checked.
 */
function usePlayComparison(
  running: Extract<PlayState, { state: 'running' }> | null,
  playing: ShownScene | null,
  open: OpenSceneState,
): PlayComparison | null {
  const entities = open.state === 'open' ? open.scene.entities : null

  return useMemo(() => {
    if (running === null || playing === null) return null
    // A level arrived at through a door has no baseline: the editing view is
    // of some other level, and a comparison across that would be noise.
    if (running.baseline === null) return null
    // Names come from the level being edited, so a difference reads "Knight is
    // drawn 4px left" rather than naming an id at somebody.
    const names = new Map((entities ?? []).map((entity) => [entity.id, entity.name]))
    return comparePictures(running.baseline, playing, names)
  }, [running, playing, entities])
}

/**
 * What the undo history calls a turn.
 *
 * The count is in it for the same reason the delete's is: the history is read by
 * somebody deciding whether to press Ctrl-Z again, and "Rotate entity" against a
 * step that turned six of them is the one wrong answer available.
 */
function labelForTurn(count: number): string {
  return count === 1 ? 'Rotate entity' : `Rotate ${count} entities`
}

/** The same, for a move. */
function labelForMove(count: number): string {
  return count === 1 ? 'Move entity' : `Move ${count} entities`
}

const noop = (): void => {}
const noPan = (_dx: number, _dy: number): void => {}
const noZoom = (_at: { x: number; y: number }, _direction: 1 | -1): void => {}

/** The right-click window: which entity, where it sits, and the camera then. */
interface PopoverAnchor {
  entity: string
  at: Point
  camera: { scale: number; x: number; y: number }
}

/** Room the window needs inside the stage, so clamping keeps all of it visible. */
const POPOVER_ROOM = { width: 240, height: 104 }

/**
 * Which cursor the stage offers, in the order the gestures take priority.
 *
 * The same order the press itself is decided in, and it has to be: a cursor
 * that promised something other than what the button would do is worse than no
 * cursor at all. Space still wins over placing, here and there.
 */
function grabOf(gestures: ReturnType<typeof useSceneGestures>, stamping: boolean): string {
  // A grab is first because it is first everywhere: while one is running no
  // other gesture can happen, so no other cursor can be honest.
  if (gestures.grabbing !== null) return 'moving'
  if (gestures.turning !== null) return 'turning'
  if (gestures.panning) return 'holding'
  if (gestures.ready) return 'ready'
  if (stamping) return 'placing'
  if (gestures.dragging !== null) return 'moving'
  if (gestures.picked !== null) return 'pick'
  return ''
}

// --- picking and placing ---------------------------------------------------

/**
 * What a press in the picture does.
 *
 * Every position written goes through the transaction API and nothing else, the
 * same door the Inspector's fields use — so one drag is one press of Ctrl-Z and
 * this feature contains no undo code at all (`editor-kernel` D7). The merge key
 * carries the entity's id, so dragging one sprite and then another is two steps.
 */
function usePlacement(
  open: OpenSceneState,
  current: ShownScene | null,
  placing: Placing,
  stamp: ReturnType<typeof usePlacePrefab>,
  /** A right-click landed: the panel opens or closes its window about it. */
  onContext: (entityId: string | null, at: Point) => void,
  /** The Delete key, which is the Outliner's Delete button (`useDeleteEntities`). */
  deleteSelected: () => void,
): ScenePlacement {
  const selection = useSelection()
  const scenePath = open.state === 'open' ? open.path : null
  const scale = current?.camera.scale ?? null

  /**
   * Where everything being moved was when the move began, and the undo run it is.
   *
   * A move is applied as travel from where it started rather than as a running
   * sum of pointer wobbles: with snapping on, adding up rounded steps would let
   * a sprite creep away from the pointer over a long drag and never come back.
   *
   * The key is minted per gesture rather than per field, and that is what makes
   * `Esc` able to take a move back exactly (`editor/store/documents.ts`): the
   * run is identified by nothing else, so a key shared with the *previous* move
   * of the same entity would see that one taken back too.
   *
   * **`anchor` is the one under the cursor**, and it is the whole of how a group
   * stays rigid: the snap is applied to the anchor's position and every other
   * entity gets that same travel. Snapping each one to the grid independently
   * would pull three sprites three units apart onto one grid position — the same
   * argument a rotation makes about not snapping the positions it orbits.
   */
  const from = useRef<{ anchor: string; started: Moved[]; key: string } | null>(null)
  const moves = useRef(0)

  /**
   * What the entities looked like when a turn began, and the undo run it is.
   *
   * The same shape as a move's `from` and for the same two reasons: every angle
   * is applied to the *remembered* transforms rather than to wherever the group
   * has got to, so a long turn cannot deform it; and the key is minted per
   * gesture so `Esc` takes back this turn and not the one before it.
   */
  const turn = useRef<{ started: Turned[]; pivot: Point; key: string } | null>(null)
  const turns = useRef(0)

  const entities = open.state === 'open' ? open.scene.entities : null

  return useMemo<ScenePlacement>(() => {
    /**
     * Remembers where everything about to move is, so travel can be measured.
     *
     * **What moves is decided here, from the selection as it was *before* this
     * press** — and that is deliberate rather than convenient. Pressing an
     * entity that is already selected moves the whole selection; pressing one
     * that is not moves only it, because the press has just replaced the
     * selection with it.
     *
     * Reading the pre-press selection is also the only thing that *works*: the
     * press calls `select` and then this, and React has not re-rendered in
     * between, so `selection` here is still the old one either way. Deriving the
     * group from the rule above rather than from "whatever is selected now"
     * turns that from a hazard into the answer.
     */
    const begin = (anchorId: string): boolean => {
      from.current = null
      if (scenePath === null) return false

      const group = selection.selectedEntities.includes(anchorId)
        ? selection.selectedEntities
        : [anchorId]

      const started: Moved[] = []
      for (const id of group) {
        const entity = entities?.find((one) => one.id === id)
        if (entity !== undefined) started.push({ id, x: entity.transform.x, y: entity.transform.y })
      }
      // The anchor itself has to be in there, or there is nothing to measure the
      // travel against — an id that has gone since the selection was made.
      if (!started.some((one) => one.id === anchorId)) return false

      moves.current += 1
      from.current = {
        anchor: anchorId,
        started,
        key: `${scenePath}#${anchorId}#move${moves.current}`,
      }
      return true
    }

    return {
      pick: (at) => (current === null ? null : entityAt(current, at)),

      select: (entityId, mode) => {
        from.current = null

        if (entityId === null || scenePath === null) {
          selection.selectNothing()
          return
        }

        if (mode === 'add') {
          selection.addToSelection(scenePath, entityId)
          return
        }

        if (mode === 'remove') {
          selection.removeFromSelection(entityId)
          return
        }

        // Only a plain press remembers where the entity was, because only a
        // plain press can become a drag. Doing it for the others would leave a
        // start position primed for a move that this press cannot begin.
        begin(entityId)
        selection.selectEntity(scenePath, entityId)
      },

      deleteSelected,

      beginMove: (entityId) => begin(entityId),

      selected: (entityId) => selection.selectedEntities.includes(entityId),

      moveBy: (entityId, screenDx, screenDy, invert) => {
        const start = from.current
        if (start === null || start.anchor !== entityId) return
        if (scenePath === null || scale === null) return

        const anchor = start.started.find((one) => one.id === entityId)
        if (anchor === undefined) return

        // Screen y counts down and the level's counts up, so the vertical
        // travel is subtracted. The scale is the only part of the camera that
        // matters here: a drag is a distance, not a place.
        const wanted = { x: anchor.x + screenDx / scale, y: anchor.y - screenDy / scale }
        // The toggle and the held modifier are combined in one place, and this
        // is not it (`editor/shell/snap.ts`).
        const at = placeOn(wanted, placing.snap, invert)

        // **The snapped travel, taken once and given to everything.** The grid
        // is applied to the entity under the cursor and the rest are carried by
        // the same distance, so a group keeps its shape — snapping each one
        // separately would pull sprites three units apart onto one grid
        // position, which is a formation destroyed by being nudged.
        const dx = at.x - anchor.x
        const dy = at.y - anchor.y

        editDocument(
          scenePath,
          { label: labelForMove(start.started.length), merge: start.key },
          (document) => {
            if (document.format !== SCENE_FORMAT) return
            for (const one of start.started) {
              // Re-found by id rather than remembered as an index: between the
              // press and this move, a text editor may have changed the file.
              const target = document.entities.find((entity) => entity.id === one.id)
              if (target === undefined) continue
              // The anchor lands exactly where the snap put it; everything else
              // is placed freely, because it is carrying the anchor's travel
              // rather than being snapped on its own account.
              target.transform.x = one.id === entityId ? at.x : freely(one.x + dx)
              target.transform.y = one.id === entityId ? at.y : freely(one.y + dy)
            }
          },
        )
      },

      /**
       * The press is over.
       *
       * **A press on an already-selected entity that never moved collapses the
       * selection onto it**, and that is the other half of not collapsing on the
       * way down. Keeping the selection on the press is what lets a group be
       * dragged at all; without this, a selection of six would be a state with no
       * way out except clicking empty space, because every click inside it would
       * pick up all six again. Decided on the release, because that is the first
       * moment anybody knows a click was a click rather than a drag.
       */
      drop: (finished) => {
        from.current = null
        // Always, even for a press that never moved: it seals the undo step, and
        // sealing one that was never opened costs nothing.
        sealEdits()

        if (finished === undefined || finished.moved || scenePath === null) return
        if (selection.selectedEntities.length < 2) return
        if (!selection.selectedEntities.includes(finished.entity)) return
        selection.selectEntity(scenePath, finished.entity)
      },

      /**
       * The move never happened.
       *
       * The whole run is handed back to the transaction API, which reverses it
       * with the patches it already recorded. Writing the remembered position
       * back as one more edit would be this feature implementing an inverse of
       * its own — the exact thing document-level undo exists to make unnecessary
       * (`editor-kernel` D7) — and it would leave a step on the stack that
       * reverses nothing.
       */
      cancelMove: () => {
        const start = from.current
        from.current = null
        if (start === null) return
        abandonEdits(start.key)
      },

      stamping: placing.stamping !== null && current !== null && stamp.canPlace,

      /**
       * A press, turned into a place in the level.
       *
       * **Inverted through the camera the renderer *drew* with, not the one it
       * was asked for.** They differ by less than a device pixel — the nudge
       * that keeps pixel art crisp (`phaser4-runtime` P5) — which at 8× is an
       * eighth of a level unit: small enough to read as noise, and large enough
       * to drop a tile on the wrong side of a snap boundary.
       */
      stampAt: (at) => {
        if (current === null) return
        stamp.placeAt(toScenePoint(at, current.drawnWith, current.canvasSize))
      },

      stopStamping: placing.stopStamping,

      context: onContext,

      /**
       * A turn is about to start: remember every entity, and say where they
       * turn around — in the host's pixels, which is what the gizmo is drawn in.
       *
       * The pivot is worked out **twice, from two sources, on purpose**, and the
       * two are not interchangeable. The arithmetic uses the mean of the
       * *document's* positions, because that is what the entities are actually
       * rotated about and inverting a screen point back through the camera would
       * put rounding into every position it writes. The line uses the mean of
       * the *renderer's reported origins*, because the overlay's standing rule is
       * that every number in it came from what was really drawn. They describe
       * one point: the camera is affine, so the mean of the drawn origins is
       * where the mean of the positions was drawn.
       */
      beginTurn: (entityIds) => {
        turn.current = null
        if (scenePath === null || current === null) return null

        const started: Turned[] = []
        for (const id of entityIds) {
          const entity = entities?.find((one) => one.id === id)
          if (entity !== undefined) {
            started.push({
              id,
              x: entity.transform.x,
              y: entity.transform.y,
              rotation: entity.transform.rotation,
            })
          }
        }

        const centre = pivotOf(started)
        if (centre === null) return null

        // Only entities the renderer actually reported: one whose sprite has
        // not arrived has no drawn origin, and averaging a missing one in as
        // zero would put the gizmo's line in the corner of the level.
        const drawn = started
          .map((one) => current.entities.find((shownOne) => shownOne.id === one.id)?.origin ?? null)
          .filter((one): one is Point => one !== null)
        if (drawn.length === 0) return null

        turns.current += 1
        turn.current = {
          started,
          pivot: centre,
          key: `${scenePath}#turn${turns.current}`,
        }

        return {
          x: drawn.reduce((total, one) => total + one.x, 0) / drawn.length,
          y: drawn.reduce((total, one) => total + one.y, 0) / drawn.length,
        }
      },

      /**
       * The group, turned rigidly — every entity in one transaction, so however
       * many are selected the whole gesture is one press of Ctrl-Z.
       *
       * The angle that lands is returned rather than assumed by the caller: with
       * the grid on, a pointer at 37° turns the group by 30°, and the caption
       * and the gizmo's arc have to say what happened rather than what was asked
       * for.
       */
      turnBy: (degrees, invert) => {
        const run = turn.current
        if (run === null || scenePath === null) return 0

        const applied = turnOn(degrees, placing.snap, invert)
        // Positions are placed freely rather than on the grid. Rounding each one
        // to the pixel grid mid-rotation would shear the group out of shape —
        // a rigid rotation that lands on a grid is not a rigid rotation, and the
        // switch governs the *angle* for this gesture.
        const turned = turnAbout(run.started, run.pivot, applied)

        editDocument(scenePath, { label: labelForTurn(turned.length), merge: run.key }, (document) => {
          if (document.format !== SCENE_FORMAT) return
          for (const one of turned) {
            // Re-found by id inside the transaction rather than closed over as
            // an index: between the keypress and here, a text editor may have
            // changed the file.
            const target = document.entities.find((entity) => entity.id === one.id)
            if (target === undefined) continue
            target.transform.x = one.x
            target.transform.y = one.y
            target.transform.rotation = one.rotation
          }
        })

        return applied
      },

      /**
       * The turn is over.
       *
       * Cancelling hands the whole run back to the transaction API, which
       * reverses it with the patches it already recorded — the same argument as
       * a cancelled move (`editor-kernel` D7): writing the remembered transforms
       * back would be an inverse of our own, and would leave a step on the stack
       * that reverses nothing.
       */
      endTurn: (how) => {
        const run = turn.current
        turn.current = null
        if (run === null) return
        if (how === 'cancel') abandonEdits(run.key)
        else sealEdits()
      },
    }
  }, [current, scenePath, scale, entities, selection, placing, stamp, onContext, deleteSelected])
}

// --- the canvas ------------------------------------------------------------

interface StageProps {
  host: RefObject<HTMLDivElement | null>
  view: SceneViewState
  /** Which cursor to offer, decided by whichever gesture has priority. */
  grab: string
  /** The picture as somewhere a file from the Assets panel can be let go. */
  drop: SceneDropTarget
  children: ReactNode
}

/**
 * The canvas's host, and the surface the gestures are read from.
 *
 * The canvas belongs to the window rather than to this component, so it is
 * moved in on mount and taken back out on unmount — which is what lets the human
 * drag this tab across the layout without the renderer noticing, and what keeps
 * the camera pointing where they left it.
 */
function Stage({ host, view, grab, drop, children }: StageProps): ReactElement {
  const canvas = view.state === 'ready' ? view.canvas : null
  const measure = view.state === 'ready' ? view.measure : null

  useEffect(() => {
    const element = host.current
    if (element === null || canvas === null) return

    element.append(canvas)
    return () => {
      canvas.remove()
    }
  }, [host, canvas])

  useEffect(() => {
    const element = host.current
    if (element === null || measure === null) return

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const box = entry.contentRect
      // A panel behind another tab measures zero, and framing a level against
      // nothing puts the whole of it in one corner and then moves it the moment
      // a real measurement arrives.
      if (box.width === 0 || box.height === 0) return
      measure(box.width, box.height)
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [host, measure])

  return (
    <div
      className="viewport__stage"
      ref={host}
      data-testid="viewport-stage"
      data-grab={grab}
      data-dropping={drop.over}
      // Focusable, but never in the tab order. Pressing in the picture moves
      // focus here, which is what takes it off a field the human was typing in
      // — otherwise clicking a sprite and pressing F types an f into a name.
      tabIndex={-1}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    >
      {children}
    </div>
  )
}

// --- what it says ----------------------------------------------------------

/** Which of the two "you cannot see it" situations the human is in, if either. */
type OffScreen = { kind: 'none' } | { kind: 'all' } | { kind: 'selected'; name: string }

function offScreenIn(open: OpenSceneState, current: ShownScene | null, selected: string | null): OffScreen {
  if (open.state !== 'open' || current === null) return { kind: 'none' }

  const visible = onScreen(current)
  if (open.scene.entities.length > 0 && visible.count === 0) return { kind: 'all' }

  if (selected !== null && !visible.ids.has(selected)) {
    const entity = open.scene.entities.find((one) => one.id === selected)
    if (entity !== undefined) return { kind: 'selected', name: entity.name }
  }

  return { kind: 'none' }
}

interface CaptionProps {
  open: OpenSceneState
  view: SceneViewState
  problems: ReturnType<typeof problemsIn>
  /** Prefabs this level points at that could not be used. Said before textures:
   *  a prefab that is missing is why its texture is missing too. */
  prefabProblems: ReturnType<typeof prefabProblemsIn>
  selected: string | null
  offScreen: OffScreen
  /** The entity being moved right now, by either gesture, or null. */
  moving: Entity | null
  /** The keyboard grab in progress, which is the half of `moving` with keys. */
  grab: Grab | null
  /** How many entities the move is carrying. One, usually. */
  movingCount: number
  /** The turn in progress, or null. Its own sentence: it says an angle, not a position. */
  turning: Turn | null
  /** What a press lands on, and whether a press is placing at all. */
  placing: Placing
  /** What is being repeat-placed, in words, or null when nothing is. */
  stampingName: string | null
  /** The file hovering over the picture right now, named, or null. */
  dropping: string | null
  /** Why the last file let go here put nothing down, or null. */
  dropRefused: string | null
  onPlay: () => void
  /** False until there is a settled picture of this level to run — and to check against. */
  canPlay: boolean
}

/**
 * Every state gets its own sentence (`editor-ui` U10). "No scene is open",
 * "this scene is empty" and "everything in this scene is off screen" are three
 * different situations — the last one only became reachable when the camera
 * arrived, and collapsing it into either of the others would leave the human
 * looking at an empty panel with no idea which of the three they were in.
 */
function Caption({
  open,
  view,
  problems,
  prefabProblems,
  selected,
  offScreen,
  moving,
  grab,
  movingCount,
  turning,
  placing,
  stampingName,
  dropping,
  dropRefused,
  onPlay,
  canPlay,
}: CaptionProps): ReactElement {
  if (view.state === 'unavailable') {
    return (
      <Bar>
        <Note>The renderer would not start in this browser: {view.problem} The viewport needs WebGL.</Note>
      </Bar>
    )
  }

  if (open.state === 'none') {
    return (
      <Bar>
        <Note>No scene is open. Click a scene in the Assets panel to open it here.</Note>
      </Bar>
    )
  }

  const name = basename(open.path)

  if (open.state === 'gone') {
    return (
      <Bar>
        <Note>
          <strong>{name}</strong> is no longer in the project folder. What is drawn here is the last thing it
          held.
        </Note>
      </Bar>
    )
  }

  if (open.state === 'unavailable') {
    return (
      <Bar>
        <Note>Could not ask the editor service about {name}. Is the editor command still running?</Note>
      </Bar>
    )
  }

  if (open.state === 'unreadable') {
    return (
      <Bar>
        <Note>
          <strong>{name}</strong> {open.problem} It has been left exactly as it is on disk — nothing here
          rewrites a file it cannot read.
        </Note>
      </Bar>
    )
  }

  if (view.state === 'booting') {
    return (
      <Bar>
        <Note>Starting the renderer…</Note>
      </Bar>
    )
  }

  if (open.state === 'loading') {
    return (
      <Bar>
        <Note>Opening {name}…</Note>
      </Bar>
    )
  }

  if (view.problem !== null) {
    return (
      <Bar>
        <Note>
          <strong>{name}</strong> could not be drawn: {view.problem}
        </Note>
      </Bar>
    )
  }

  return (
    <Bar>
      {/*
       * Off screen is its own answer, because a camera made "there is nothing
       * here" and "it is all somewhere else" into two different situations, and
       * the second one is fixed by a key rather than by worrying.
       *
       * It *replaces* the count rather than joining it, which is prose as well
       * as layout: when the level is somewhere else, how many entities were
       * drawn is the less useful of the two things to say. The zoom is left off
       * both — it is written in the control row a few pixels to the right.
       */}
      {/*
       * A move says where it is putting the thing, in the level's own units, in
       * the place the human is already looking. It is also the only home a
       * modifier has: nothing else on screen could tell you Alt exists — and
       * the same is true of the way out of repeat-placing, which is why the
       * mode says its own name and its own key here rather than only in the
       * panel that switched it on.
       *
       * A grab needs it more than a drag does, and that is why the sentence
       * differs: a grab is a mode with no button held, so the axis keys and the
       * way out of it are things a human can only find out by being told.
       */}
      {/*
       * A file hovering over the picture takes the sentence, because it is the
       * most current thing on screen and because it is the only place the human
       * finds out the drop will land *here* rather than wherever the level's
       * origin happens to be.
       */}
      {/*
       * A turn gets a sentence of its own rather than borrowing the move's,
       * because the useful number is different: a move says where the thing has
       * got to, and a turn says how far round it has come. Reporting a position
       * mid-rotation would be true and useless — and with several selected there
       * is no single position to report anyway.
       */}
      {dropping !== null ? (
        <Note testId="viewport-dropping" title={`Let go to put ${dropping} in the level here`}>
          Drop <strong>{dropping}</strong> here.
        </Note>
      ) : turning !== null ? (
        // The angle leads, unlike every other caption here, and it is the one
        // place that ordering is worth breaking for: this bar is narrow enough
        // to clip mid-sentence, and the angle is the number the hand is being
        // steered by. Put the subject first and a narrow panel shows "Turning 2
        // e…" — a caption that has said nothing at all. Found by looking at the
        // screenshot rather than by anything failing (`editor-verification` V31).
        <Note
          testId="viewport-turning"
          title={`${shortestTurn(turning.degrees)}° — ${turnSubject(turning)}. ${turnAdvice(placing.snap.on, true)}`}
        >
          <strong>{shortestTurn(turning.degrees)}°</strong> — {turnSubject(turning)}.{' '}
          {turnAdvice(placing.snap.on, false)}
        </Note>
      ) : stampingName !== null ? (
        <Note testId="viewport-stamping" title={`Every click in the level places another ${stampingName}. Esc stops it.`}>
          Placing <strong>{stampingName}</strong> — Esc to stop.
        </Note>
      ) : moving !== null ? (
        <Note
          testId={grab === null ? 'viewport-dragging' : 'viewport-grabbing'}
          title={`${movingSubject(moving, movingCount)} — ${moving.transform.x}, ${moving.transform.y}. ${wholeAdvice(grab, placing.snap.on)}`}
        >
          <strong>{movingSubject(moving, movingCount)}</strong> — {moving.transform.x},{' '}
          {moving.transform.y}. {advice(grab, placing.snap.on)}
        </Note>
      ) : offScreen.kind === 'all' ? (
        <Note bad testId="viewport-offscreen">Everything is off screen — press Home to bring it back.</Note>
      ) : offScreen.kind === 'selected' ? (
        <Note bad testId="viewport-offscreen" title={`${offScreen.name} is off screen`}>
          <strong>{offScreen.name}</strong> is off screen — press F to go to it.
        </Note>
      ) : (
        <Note>{view.shown === null ? 'Opening…' : describeScene(view.shown, open.scene.entities.length)}</Note>
      )}

      {/*
       * A missing texture is named rather than drawn as nothing. A scene that
       * quietly shows fewer sprites than it has entities is a scene the human
       * has to debug by counting, and the answer — which file, under which name
       * — is right here.
       */}
      {/* A file that was let go here and could not become anything says what it
          was instead. It stays until the next drag, because it answers a
          question the human has only just asked. */}
      {dropRefused !== null && (
        <Note bad testId="viewport-drop-refused" title={dropRefused}>
          {dropRefused}
        </Note>
      )}

      {prefabProblems.map((problem) => (
        <Note key={problem.path} bad testId="viewport-problem" title={describePrefabProblem(problem)}>
          {describePrefabProblem(problem)}
        </Note>
      ))}

      {problems.map((problem) => (
        <Note key={problem.path} bad testId="viewport-problem" title={describeProblem(problem)}>
          {describeProblem(problem)}
        </Note>
      ))}

      <span className="viewport__play">
        <button
          type="button"
          className="control control--action"
          data-testid="play-start"
          disabled={!canPlay}
          title={
            canPlay
              ? 'Run this level from the file, drawn by the game runtime'
              : moving !== null
                ? 'Put it down first — a level runs from the file, and this one is still being moved'
                : 'Waiting for the level to finish opening'
          }
          onClick={onPlay}
        >
          ▶ Play
        </button>
      </span>

      <SnapControls placing={placing} />
      <CameraControls view={view} selected={selected} />
    </Bar>
  )
}

/**
 * What to say to somebody in the middle of moving something.
 *
 * Three sentences for three situations, because they offer different keys: a
 * drag has only the modifier, a free grab has the axis keys and the way out, and
 * a locked one has to say which axis it is on and how to get off it. One
 * sentence covering all three would be a list of everything the viewport can do,
 * read by somebody who is holding a sprite in mid-air.
 *
 * Short, because the bar is one line beside the Play button and the snap, and a
 * caption that is clipped in the middle of naming a key has not named it. The
 * whole of it is next door, in the tooltip, on the same terms as every other
 * note here.
 */
function advice(grab: Grab | null, snapping: boolean): string {
  // The modifier's sentence says what it will *do*, not what it is called after
  // — "hold Ctrl to invert the snap" is a sentence about a checkbox, and the
  // human moving a sprite wants to know where it will land.
  const modifier = snapping ? 'Hold Ctrl to place it anywhere.' : 'Hold Ctrl to land on the grid.'
  if (grab === null) return modifier
  if (grab.axis === null) return `X or Y locks an axis, Esc puts it back. ${modifier}`
  return `Locked to ${grab.axis.toUpperCase()} — Esc puts it back. ${modifier}`
}

/**
 * What is being moved, named.
 *
 * The count replaces the name once there is more than one, rather than joining
 * it: six names would fill the bar and push the position — the pair the human is
 * watching — off the end of it. The position stays the *anchor's*, which is the
 * one under the cursor and the only one of the six with a number worth showing.
 */
function movingSubject(moving: Entity, count: number): string {
  return count > 1 ? `${count} entities` : moving.name
}

/**
 * What is being turned, named.
 *
 * A count rather than a list once there is more than one: six names would fill
 * the bar and push the angle — the number the human is actually watching — off
 * the end of it.
 */
function turnSubject(turn: Turn): string {
  return turn.entities.length === 1 ? 'turning' : `turning ${turn.entities.length} entities`
}

/**
 * What to say to somebody in the middle of a turn.
 *
 * The same two-lengths shape the move's advice has, and the same rule about what
 * the modifier's sentence says: what it will *do*, never what it is called
 * after. Somebody holding a sprite in mid-air wants to know where it will land.
 */
function turnAdvice(snapping: boolean, whole: boolean): string {
  const modifier = snapping
    ? `Hold Ctrl to turn freely${whole ? ` rather than in ${ANGLE_STEP}° steps` : ''}.`
    : `Hold Ctrl for ${ANGLE_STEP}° steps.`
  return whole
    ? `${modifier} A click puts it down, Esc puts it back where it was.`
    : `${modifier} Click to place, Esc puts it back.`
}

/** The same advice for a panel with room for it, which is the tooltip's. */
function wholeAdvice(grab: Grab | null, snapping: boolean): string {
  const modifier = snapping
    ? 'Hold Ctrl to ignore the snap and place it anywhere.'
    : 'Snapping is off — hold Ctrl to put it on the grid.'
  if (grab === null) return modifier
  if (grab.axis === null) {
    return `X or Y holds it to one axis, a click puts it down, Esc puts it back where it was. ${modifier}`
  }
  const axis = grab.axis.toUpperCase()
  return `Held to the ${axis} axis from where it started. ${axis} again frees it, a click puts it down, Esc puts it back where it was. ${modifier}`
}

/**
 * What the bar says while a level is running.
 *
 * It replaces the editing caption outright rather than adding to it. Everything
 * the editing caption says — how many entities are drawn, what is off screen,
 * which texture is missing — is about the level *as the editor resolves it*, and
 * repeating it under a picture that came from somewhere else would be the one
 * genuinely misleading thing this panel could do.
 *
 * Three sentences, in the order somebody would want them: what is running and
 * where it was read from, whether it matches what they were just looking at, and
 * anything the runtime could not resolve.
 */
function PlayCaption({
  play,
  onStop,
  comparison,
  undrawable,
}: {
  play: Exclude<PlayState, { state: 'stopped' }>
  onStop: () => void
  comparison: PlayComparison | null
  /**
   * Textures the loader resolved and the renderer could not fetch — a file
   * deleted since its `.meta` was written, most often. The loader cannot know
   * about these: it reads settings, not pixels.
   */
  undrawable: readonly string[]
}): ReactElement {
  const stop = (
    <span className="viewport__play">
      <button
        type="button"
        className="control control--action"
        data-testid="play-stop"
        title="Back to editing, exactly where you left off"
        onClick={onStop}
      >
        ■ Stop
      </button>
    </span>
  )

  if (play.state === 'starting') {
    return (
      <Bar>
        <Note testId="play-starting">Saving and opening {basename(play.path)}…</Note>
        {stop}
      </Bar>
    )
  }

  if (play.state === 'failed') {
    return (
      <Bar>
        <Note bad testId="play-problem" title={play.problem}>
          {play.problem}
        </Note>
        {stop}
      </Bar>
    )
  }

  return (
    <Bar>
      <Note
        testId="play-running"
        title={`Running ${play.path}, opened from the project folder by the game runtime. Editing is off until you press Stop.`}
      >
        Running <strong>{basename(play.path)}</strong> from the file. Editing is off until Stop.
      </Note>

      {comparison !== null && (
        <Note
          bad={comparison.kind !== 'same'}
          testId="play-comparison"
          title={describeComparison(comparison)}
        >
          {describeComparison(comparison)}
        </Note>
      )}

      {play.problems.map((problem) => (
        <Note
          key={`${problem.kind}:${problem.path}`}
          bad
          testId="play-problem"
          title={describeLoadProblem(problem)}
        >
          {describeLoadProblem(problem)}
        </Note>
      ))}

      {undrawable.map((path) => (
        <Note key={path} bad testId="play-problem" title={`${path} could not be loaded`}>
          {basename(path)} is referenced and its picture could not be loaded, so nothing is drawn for it.
        </Note>
      ))}

      {stop}
    </Bar>
  )
}

/**
 * What a drag and a press land on, as two numbers.
 *
 * In the viewport's own bar rather than in the Inspector, because it is a
 * property of how this window behaves and not of any document — the same
 * argument that keeps it out of the level file, one layer up. It is beside the
 * zoom for the same reason: both are settings of the surface rather than of the
 * thing being looked at.
 *
 * **A switch, an interval and an offset**, in that order — the order they are
 * decided in.
 *
 * The switch is a switch rather than a zero typed into the interval, which is
 * what it used to be. A number that secretly means "no" makes one field answer
 * two questions, and worse, it throws the spacing away on the way out: turning
 * the grid off and on again used to lose the grid. Both fields stay live while
 * it is off, so a grid can be set up before it is switched on.
 *
 * The interval offers a list and still takes a typed number
 * (`editor/shell/snap.ts`). A fixed list would put an odd spacing out of reach;
 * a bare field makes the human type `16` every time for the sake of a case that
 * almost never comes up.
 *
 * **The offset is not an ornament.** An interval alone describes a grid through
 * the origin, which is the wrong grid for any level whose sprites hang off their
 * middles — see `editor/shell/snap.ts`, where the arithmetic and the reasoning
 * both live.
 *
 * Deliberately absent while a level is running, along with the whole editing
 * caption: nothing can be placed then, so a control offering to change where it
 * would land is a control lying about what it does.
 */
function SnapControls({ placing }: { placing: Placing }): ReactElement {
  const { snap, setSnap } = placing

  return (
    <span
      className="viewport__snap"
      data-testid="scene-snap"
      data-snap-on={String(snap.on)}
      data-snap-step={snap.step}
      data-snap-offset={snap.offset}
    >
      <button
        type="button"
        className="control control--toggle"
        data-testid="scene-snap-toggle"
        aria-pressed={snap.on}
        title={
          snap.on
            ? 'Positions land on the grid. Hold Ctrl while moving to place anywhere. Click to turn snapping off.'
            : 'Positions land anywhere. Hold Ctrl while moving to land on the grid. Click to turn snapping on.'
        }
        onClick={() => setSnap({ ...snap, on: !snap.on })}
      >
        Snap
      </button>
      <NumberField
        testId="scene-snap-step"
        title="How far apart the positions a drag or a click can land on are, in scene units. Pick one or type your own."
        value={snap.step}
        min={0}
        step={1}
        presets={SNAP_INTERVALS}
        onCommit={(step) => setSnap({ ...snap, step })}
      />
      <span className="viewport__snap-label">from</span>
      <NumberField
        testId="scene-snap-offset"
        title="Where that grid starts, in scene units. A step of 16 from 8 lands on 8, 24, 40 — the middles of 16-unit tiles."
        value={snap.offset}
        step={1}
        onCommit={(offset) => setSnap({ ...snap, offset })}
      />
    </span>
  )
}

/**
 * The camera, as buttons.
 *
 * Deliberately not the texture tab's `Fit`, which is a mode the preview stays
 * in until told otherwise. Framing a scene is a one-shot press: a panel dragged
 * wider has to keep the human's place rather than reframe, so there is nothing
 * for a mode to mean.
 */
function CameraControls({
  view,
  selected,
}: {
  view: Extract<SceneViewState, { state: 'ready' }>
  selected: string | null
}): ReactElement | null {
  const shown = view.shown
  if (shown === null) return null

  // The buttons have no cursor to zoom toward, so they zoom toward the middle.
  const centre = { x: shown.canvasSize.width / 2, y: shown.canvasSize.height / 2 }

  return (
    <span className="viewport__zoom">
      <button
        type="button"
        className="control control--step"
        data-testid="scene-zoom-out"
        onClick={() => view.zoom(centre, -1)}
      >
        −
      </button>
      <span className="viewport__scale" data-testid="scene-scale" data-scale={shown.camera.scale}>
        {describeZoom(shown.camera.scale)}
      </span>
      <button
        type="button"
        className="control control--step"
        data-testid="scene-zoom-in"
        onClick={() => view.zoom(centre, 1)}
      >
        +
      </button>
      <button
        type="button"
        className="control control--action"
        data-testid="scene-frame-all"
        onClick={view.frameAll}
      >
        Frame all
      </button>
      <button
        type="button"
        className="control control--action"
        data-testid="scene-frame-selected"
        disabled={selected === null}
        onClick={() => {
          if (selected !== null) view.frameEntity(selected)
        }}
      >
        Frame selected
      </button>
    </span>
  )
}

function Bar({ children }: { children: ReactNode }): ReactElement {
  return (
    <footer className="viewport__bar" data-testid="viewport-bar">
      {children}
    </footer>
  )
}

function Note({
  children,
  bad,
  testId,
  title,
}: {
  children: ReactNode
  bad?: boolean
  testId?: string
  /** The full sentence, for the tooltip, when the panel is too narrow for it. */
  title?: string
}): ReactElement {
  return (
    <p
      className={bad === true ? 'viewport__note viewport__note--bad' : 'viewport__note'}
      data-testid={testId}
      title={title}
    >
      {children}
    </p>
  )
}
