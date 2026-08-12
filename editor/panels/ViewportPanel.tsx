import { useEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react'

import type { SceneRequest, ShownScene } from '../../runtime'
import { basename } from '../shell/asset-kinds'
import { useOpenScene, type OpenSceneState } from '../shell/open-scene'
import { describeProblem, problemsIn, useSceneAssets } from '../shell/scene-assets'
import { useDrawScene, useSceneView, type SceneViewState } from '../shell/scene-view-context'
import { useSceneGestures } from '../shell/useSceneGestures'
import { useSelection } from '../shell/selection'
import { describeZoom } from '../shell/zoom'
import { SceneOverlay, describeScene, onScreen } from './SceneOverlay'

/**
 * The open scene, drawn by the real runtime.
 *
 * The panel's own job is small: host the canvas, measure itself, mark what is
 * selected, carry the gestures that drive the camera, and say what is going on
 * whenever there is no picture. The drawing is the runtime's, the scene is the
 * document store's, which textures are available is `scene-assets.ts`, and where
 * the camera is looking is `scene-view-context.tsx` — this panel fetches nothing
 * of its own, so the picture and the Hierarchy and the Inspector are all
 * describing one object (`editor-ui` U12).
 *
 * Where the human is looking is not in the level. It lives for as long as the
 * window does, never reaches the document, and never reaches the scene file —
 * so Ctrl-Z after a pan reverses the last thing that was *changed*.
 */
export function ViewportPanel(): ReactElement {
  const selection = useSelection()
  const open = useOpenScene()
  const view = useSceneView()
  const assets = useSceneAssets()
  const host = useRef<HTMLDivElement>(null)

  const subject: SceneRequest | null =
    open.state === 'open' ? { path: open.path, scene: open.scene, textures: assets.textures } : null
  // The second argument is what stops a level being framed against half of
  // itself: until every texture has resolved, entities whose sprite has not
  // arrived count as points rather than as the area they cover.
  useDrawScene(subject, subject !== null && !assets.loading)

  const shown = view.state === 'ready' ? view.shown : null
  // Only the scene that is open, in case a report from the previous one is
  // still the last thing the renderer answered with.
  const current = shown !== null && subject !== null && shown.path === subject.path ? shown : null

  const selected = selection.selected.kind === 'entity' ? selection.selected.entity : null
  const ready = view.state === 'ready' ? view : null

  const gestures = useSceneGestures({
    host,
    enabled: current !== null,
    pan: ready?.pan ?? noPan,
    zoom: ready?.zoom ?? noZoom,
    frameAll: ready?.frameAll ?? noop,
    frameEntity: ready?.frameEntity ?? noop,
    selected,
  })

  const camera = current?.camera ?? null
  const visible = current === null ? null : onScreen(current)

  return (
    <div
      className="viewport scene"
      data-testid="viewport-panel"
      data-scene-showing={current?.path ?? ''}
      data-scene-drawn={current === null ? '' : String(current.entities.filter((e) => e.bounds !== null).length)}
      // What the camera actually drew with, rather than what it was asked for.
      // A caption or a test built from the request would keep claiming the view
      // was right long after the line that applies it stopped working.
      data-scene-scale={camera === null ? '' : String(camera.scale)}
      data-scene-focus-x={camera === null ? '' : String(camera.focus.x)}
      data-scene-focus-y={camera === null ? '' : String(camera.focus.y)}
      data-scene-onscreen={visible === null ? '' : String(visible.count)}
    >
      <Stage host={host} view={view} dragging={gestures.dragging} ready={gestures.ready}>
        {current !== null && <SceneOverlay shown={current} selected={selected} />}
      </Stage>

      <Caption
        open={open}
        view={view}
        problems={problemsIn(assets)}
        selected={selected}
        offScreen={offScreenIn(open, current, selected)}
      />
    </div>
  )
}

const noop = (): void => {}
const noPan = (_dx: number, _dy: number): void => {}
const noZoom = (_at: { x: number; y: number }, _direction: 1 | -1): void => {}

// --- the canvas ------------------------------------------------------------

interface StageProps {
  host: RefObject<HTMLDivElement | null>
  view: SceneViewState
  dragging: boolean
  ready: boolean
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
function Stage({ host, view, dragging, ready, children }: StageProps): ReactElement {
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
      data-grab={dragging ? 'holding' : ready ? 'ready' : ''}
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
  selected: string | null
  offScreen: OffScreen
}

/**
 * Every state gets its own sentence (`editor-ui` U10). "No scene is open",
 * "this scene is empty" and "everything in this scene is off screen" are three
 * different situations — the last one only became reachable when the camera
 * arrived, and collapsing it into either of the others would leave the human
 * looking at an empty panel with no idea which of the three they were in.
 */
function Caption({ open, view, problems, selected, offScreen }: CaptionProps): ReactElement {
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
      {offScreen.kind === 'all' ? (
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
      {problems.map((problem) => (
        <Note key={problem.path} bad testId="viewport-problem" title={describeProblem(problem)}>
          {describeProblem(problem)}
        </Note>
      ))}

      <CameraControls view={view} selected={selected} />
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
