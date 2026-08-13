import { useEffect, useMemo, useRef, type ReactElement, type ReactNode, type RefObject } from 'react'

import { describeLoadProblem, inSceneUnits, type SceneRequest, type ShownScene } from '../../runtime'
import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import { basename } from '../shell/asset-kinds'
import { entityAt, onScreen } from '../shell/drawn-entities'
import { useOpenScene, type OpenSceneState } from '../shell/open-scene'
import { comparePictures, describeComparison, type PlayComparison } from '../shell/play-comparison'
import { usePlayMode, type PlayState } from '../shell/play-mode'
import { useRunningLevel } from '../shell/running-level'
import { describeProblem, problemsIn, useSceneAssets } from '../shell/scene-assets'
import { describePrefabProblem, prefabProblemsIn, useResolvedScene } from '../shell/scene-prefabs'
import { useDrawScene, useSceneView, type SceneViewState } from '../shell/scene-view-context'
import { useSceneGestures, type ScenePlacement } from '../shell/useSceneGestures'
import { useSelection } from '../shell/selection'
import { describeZoom } from '../shell/zoom'
import { editDocument, sealEdits } from '../store/open-documents'
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
 * so the picture and the Hierarchy and the Inspector are all describing one
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

  // Time starts here, and only once the picture above exists — so the level is
  // compared with the editing view on the frame it started, before any system
  // has moved anything. Everything after that frame is the runtime's, drawn
  // straight to the canvas without passing through React.
  const runningLevel = useRunningLevel(running?.request.scene.entities ?? null, playing !== null)

  const selected = selection.selected.kind === 'entity' ? selection.selected.entity : null
  const ready = view.state === 'ready' ? view : null

  const placement = usePlacement(open, current)
  const gestures = useSceneGestures({
    host,
    enabled: current !== null && !mode.active,
    pan: ready?.pan ?? noPan,
    zoom: ready?.zoom ?? noZoom,
    frameAll: ready?.frameAll ?? noop,
    frameEntity: ready?.frameEntity ?? noop,
    selected,
    placement,
  })

  const camera = current?.camera ?? null
  const visible = current === null ? null : onScreen(current)
  const beingMoved =
    gestures.dragging === null || open.state !== 'open'
      ? null
      : (open.scene.entities.find((one) => one.id === gestures.dragging) ?? null)

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
      data-scene-dragging={gestures.dragging ?? ''}
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
    >
      <Stage host={host} view={view} grab={grabOf(gestures)}>
        {/* No editor marks over a running game. */}
        {current !== null && !mode.active && <SceneOverlay shown={current} selected={selected} />}
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
          onPlay={mode.start}
          // Not merely "there is a picture": a level's textures arrive one at a
          // time, so a report can be a real report of this level with half of it
          // missing. Play would then run against a baseline the human never
          // actually saw, and the comparison would be checking the running level
          // against a half-drawn one.
          canPlay={current !== null && settled && !assets.loading && !resolved.loading}
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
    // Names come from the level being edited, so a difference reads "Knight is
    // drawn 4px left" rather than naming an id at somebody.
    const names = new Map((entities ?? []).map((entity) => [entity.id, entity.name]))
    return comparePictures(running.baseline, playing, names)
  }, [running, playing, entities])
}

const noop = (): void => {}
const noPan = (_dx: number, _dy: number): void => {}
const noZoom = (_at: { x: number; y: number }, _direction: 1 | -1): void => {}

/** Which cursor the stage offers, in the order the gestures take priority. */
function grabOf(gestures: ReturnType<typeof useSceneGestures>): string {
  if (gestures.panning) return 'holding'
  if (gestures.ready) return 'ready'
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
function usePlacement(open: OpenSceneState, current: ShownScene | null): ScenePlacement {
  const selection = useSelection()
  const scenePath = open.state === 'open' ? open.path : null
  const scale = current?.camera.scale ?? null

  /**
   * Where the entity was when it was pressed.
   *
   * A drag is applied as travel from the press rather than as a running sum of
   * pointer wobbles: with snapping on, adding up rounded steps would let a
   * sprite creep away from the pointer over a long drag and never come back.
   */
  const from = useRef<{ entity: string; x: number; y: number } | null>(null)

  const entities = open.state === 'open' ? open.scene.entities : null

  return useMemo<ScenePlacement>(
    () => ({
      pick: (at) => (current === null ? null : entityAt(current, at)),

      select: (entityId) => {
        from.current = null

        if (entityId === null || scenePath === null) {
          selection.selectNothing()
          return
        }

        const entity = entities?.find((one) => one.id === entityId)
        if (entity !== undefined) {
          from.current = { entity: entityId, x: entity.transform.x, y: entity.transform.y }
        }
        selection.selectEntity(scenePath, entityId)
      },

      moveBy: (entityId, screenDx, screenDy, free) => {
        const start = from.current
        if (start === null || start.entity !== entityId) return
        if (scenePath === null || scale === null) return

        // Screen y counts down and the level's counts up, so the vertical
        // travel is subtracted. The scale is the only part of the camera that
        // matters here: a drag is a distance, not a place.
        const at = placeAt(start.x + screenDx / scale, start.y - screenDy / scale, free)

        editDocument(
          scenePath,
          { label: 'Move entity', merge: `${scenePath}#${entityId}#drag` },
          (document) => {
            if (document.format !== SCENE_FORMAT) return
            // Re-found by id rather than remembered as an index: between the
            // press and this move, a text editor may have changed the file.
            const target = document.entities.find((one) => one.id === entityId)
            if (target === undefined) return
            target.transform.x = at.x
            target.transform.y = at.y
          },
        )
      },

      drop: () => {
        from.current = null
        // Always, even for a press that never moved: it seals the undo step, and
        // sealing one that was never opened costs nothing.
        sealEdits()
      },
    }),
    [current, scenePath, scale, entities, selection],
  )
}

/**
 * Where a drag puts an entity.
 *
 * Whole level units unless Alt is held, because a level laid out on whole
 * numbers is one whose pixel art lands on the pixel grid and whose file is
 * readable. Free placement is still rounded — to three decimals, which is finer
 * than the closest zoom can resolve — because the alternative is seventeen
 * digits of floating-point noise in somebody's level.
 */
function placeAt(x: number, y: number, free: boolean): { x: number; y: number } {
  if (!free) return { x: Math.round(x), y: Math.round(y) }
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }
}

// --- the canvas ------------------------------------------------------------

interface StageProps {
  host: RefObject<HTMLDivElement | null>
  view: SceneViewState
  /** Which cursor to offer, decided by whichever gesture has priority. */
  grab: string
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
function Stage({ host, view, grab, children }: StageProps): ReactElement {
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
      // Focusable, but never in the tab order. Pressing in the picture moves
      // focus here, which is what takes it off a field the human was typing in
      // — otherwise clicking a sprite and pressing F types an f into a name.
      tabIndex={-1}
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
  /** The entity being dragged right now, or null. */
  moving: Entity | null
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
       * A drag says where it is putting the thing, in the level's own units, in
       * the place the human is already looking. It is also the only home a
       * modifier has: nothing else on screen could tell you Alt exists.
       */}
      {moving !== null ? (
        <Note testId="viewport-dragging">
          <strong>{moving.name}</strong> — {moving.transform.x}, {moving.transform.y}. Hold Alt to place it
          between whole units.
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
              : 'Waiting for the level to finish opening'
          }
          onClick={onPlay}
        >
          ▶ Play
        </button>
      </span>

      <CameraControls view={view} selected={selected} />
    </Bar>
  )
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
