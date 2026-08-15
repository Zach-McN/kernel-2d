import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import {
  createSceneView,
  framing,
  panBy,
  toSceneRect,
  zoomAbout,
  type Camera,
  type Entity,
  type MusicState,
  type Point,
  type Rect,
  type SceneMusic,
  type SceneRequest,
  type SceneView,
  type ShownScene,
  type Size,
  type SoundCue,
  type SoundState,
} from '../../runtime'
import { fitStep, stepDown, stepUp } from './zoom'

/**
 * The scene renderer, and everything about where the Viewport is looking.
 *
 * The second live renderer in this window, and that is a deliberate deviation
 * from "one game, for the life of the window" rather than an accident of
 * growth. What P2 is protecting against is a renderer count that grows with
 * *use* — one per selection, one per preview, contexts churning until the
 * browser starts silently killing the oldest. The shape that keeps it honest is
 * this: **one game per declared viewport-shaped panel**, booted once, kept for
 * the life of the window, never created per selection and never destroyed when
 * a tab is closed or dragged. The count is a number in `panels.tsx` — today it
 * is two — rather than a number nobody can predict.
 *
 * The canvas is created detached and handed to whichever panel is hosting it,
 * which adopts it on mount and gives it back on unmount (`editor-ui` U15). The
 * game never notices.
 *
 * **Where the human is looking lives here, and only here.** One camera per
 * scene, held for as long as the window is open: outside the document store,
 * never in a transaction, never written to a file (`editor-ui` U8). Pressing
 * Ctrl-Z after a pan reverses the last thing that was *changed*, which is true
 * by construction rather than by care, because a camera is not something the
 * undo stack can see. It sits above the docking layout for the same reason the
 * renderer does — dockview unmounts a panel body whenever its tab is dragged,
 * and a view that lived in the panel would snap back to the origin the first
 * time somebody moved the tab.
 */

export type SceneViewState =
  | { state: 'booting' }
  /** The renderer would not start at all. */
  | { state: 'unavailable'; problem: string }
  | {
      state: 'ready'
      canvas: HTMLCanvasElement
      /** What is on screen, or null when nothing is. */
      shown: ShownScene | null
      /**
       * Which request produced `shown`, compared by identity.
       *
       * Two requests can describe the same level and be different pictures of
       * it — the editor's resolution of a level and the runtime's own, most
       * obviously, which is the pair play mode exists to compare. The path
       * cannot tell them apart and neither can the report, so the question is
       * answered here, where the association is actually known.
       */
      shownFor: SceneRequest | null
      /**
       * The key of the request `shown` is a picture of — what `useDrawScene`
       * hands in, so a caller can tell whether the picture on screen is of the
       * thing it is currently asking for, without holding an object identity
       * across a render that rebuilds it.
       */
      shownKey: string
      /** Why the scene could not be drawn, if it could not. */
      problem: string | null
      /** Told by the panel that hosts the canvas, in CSS pixels. */
      measure: (width: number, height: number) => void
      /** Drag the scene by this many screen pixels. */
      pan: (screenDx: number, screenDy: number) => void
      /**
       * One step up or down the zoom ladder, keeping whatever is under this
       * screen point exactly where it is.
       */
      zoom: (at: Point, direction: 1 | -1) => void
      /** Put the whole scene back in frame. */
      frameAll: () => void
      /** Frame one entity, named by id. Does nothing if it is not on screen. */
      frameEntity: (entityId: string) => void
      /**
       * The renderer's own two hands for a level that is *running*, passed
       * through untouched: draw the entities as they are now, and hear about
       * frames.
       *
       * They are handed out raw rather than wrapped in something that runs a
       * level, because running one is not this provider's job — the loop and
       * the systems ship inside the game (`editor-kernel` D1), and the editor's
       * whole part in it is to start one and stop it
       * (`editor/shell/running-level.ts`).
       *
       * **Neither of them touches the state above.** `shown` stays the picture
       * the renderer last reported *to React*, which while a level is running is
       * the frame it started on — that is deliberate, and it is what the play
       * comparison is a statement about. A running level redrawing through React
       * would be sixty renders a second of a panel whose job is to describe the
       * picture rather than to produce it.
       */
      redraw: (entities: readonly Entity[], lookFrom?: Camera) => ShownScene | null
      onFrame: (tick: (elapsedMs: number) => void) => () => void
      /**
       * The renderer's camera, moved without touching the state above — the
       * running level's camera seam steers through `redraw`'s second argument,
       * and this is how Stop puts the human's editing camera back afterwards.
       */
      restage: (camera: Camera) => ShownScene | null
      /** The level's music, started by a run and stopped with it — never by editing. */
      playMusic: (music: SceneMusic) => void
      stopMusic: () => void
      /** What the sound is actually doing, read back off it (`phaser4-runtime` P4). */
      musicState: () => MusicState
      /** One of the game's synthesized sound cues, played now (`runtime/game/sound.ts`). */
      playCue: (cue: SoundCue) => void
      /** What the effects are doing, read back off the audio clock (P4 again). */
      soundState: () => SoundState
    }

/**
 * A request, paired with the key that decides when it counts as a different
 * one.
 *
 * The two travel together rather than in two pieces of state, so a report can
 * never be recorded against a key from a different render.
 */
interface Subject {
  request: SceneRequest
  key: string
}

interface SceneSubjectApi {
  setSubject: (subject: SceneRequest | null, key: string) => void
  /** False while any of this scene's textures is still in the air. */
  setComplete: (complete: boolean) => void
  /**
   * A level's file moved, so the view the human left it at moves with it.
   *
   * Cameras are keyed by scene path, so without this a renamed level arrives at
   * a path nothing has ever framed and gets framed again — the level jumps, for
   * a reason that has nothing to do with looking at it.
   */
  renameScene: (from: string, to: string) => void
}

const SceneViewContext = createContext<SceneViewState | null>(null)
const SceneSubjectContext = createContext<SceneSubjectApi | null>(null)

export function SceneViewProvider({ children }: { children: ReactNode }): ReactElement {
  const [view, setView] = useState<SceneView | null>(null)
  const [bootProblem, setBootProblem] = useState<string | null>(null)
  const [shown, setShown] = useState<ShownScene | null>(null)
  /**
   * Which request the report on screen came from.
   *
   * Held because "is this picture the current one?" cannot be answered by the
   * scene's path: a scene's textures resolve one at a time, so the same scene is
   * asked for several times as it opens, and the report from the second-to-last
   * ask is a real report of that same scene with a sprite missing from it.
   * Compared by identity, which is exactly the question being asked.
   */
  const [shownFor, setShownFor] = useState<Subject | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [complete, setComplete] = useState(false)
  const [panel, setPanel] = useState<Size>({ width: 0, height: 0 })
  /**
   * One camera per scene, remembered for the life of the window.
   *
   * A scene that is not in here has never been framed, which is what the
   * framing effect below looks for. Going away to a texture and coming back
   * finds the view untouched; opening a level for the first time frames it,
   * because a view chosen for one level is not a choice anybody made about
   * another.
   */
  const [cameras, setCameras] = useState<Readonly<Record<string, Camera>>>({})

  const scenePath = subject?.request.path ?? null

  // Mirrors of state, read inside callbacks that must stay stable. Read during
  // render rather than in an effect, so nothing ever sees a value from the
  // render before last.
  const shownRef = useRef<ShownScene | null>(shown)
  shownRef.current = shown
  const pathRef = useRef<string | null>(scenePath)
  pathRef.current = scenePath
  const camerasRef = useRef(cameras)
  camerasRef.current = cameras

  useEffect(() => {
    let live = true
    let created: SceneView | null = null

    void createSceneView({
      resolveAssetUrl: (path, version) =>
        `/api/asset?path=${encodeURIComponent(path)}&v=${encodeURIComponent(String(version))}`,
    })
      .then((sceneView) => {
        created = sceneView
        // React's development double-mount tears this down before the game has
        // finished booting, so the teardown below has nothing to destroy yet.
        if (live) setView(sceneView)
        else sceneView.destroy()
      })
      .catch((error: unknown) => {
        if (live) setBootProblem(messageOf(error))
      })

    return () => {
      live = false
      created?.destroy()
    }
  }, [])

  // Draw whatever has been asked for.
  useEffect(() => {
    if (view === null) return

    if (subject === null) {
      view.clear()
      setShown(null)
      setProblem(null)
      return
    }

    // A scene this window has looked at before is put back where it was
    // *before* it is drawn, rather than drawn at the last scene's camera and
    // corrected a frame later. Read from a ref on purpose: this effect must not
    // re-run when a camera changes, or every frame of a drag would be a reload.
    const remembered = camerasRef.current[subject.request.path]
    if (remembered !== undefined) view.restage(remembered)

    let live = true
    setProblem(null)

    void view
      .show(subject.request)
      .then((result) => {
        // A null result means a later request overtook this one, and the newer
        // request's own handler is the one that should be setting state.
        if (!live || result === null) return
        setShown(result)
        setShownFor(subject)
      })
      .catch((error: unknown) => {
        if (!live) return
        setShown(null)
        setProblem(messageOf(error))
      })

    return () => {
      live = false
    }
  }, [view, subject])

  // Hand the panel's measurements to the renderer. Separate from drawing
  // because a panel dragged wider is not a reason to fetch anything again — and
  // the camera is left alone, so the middle of the panel keeps meaning the same
  // place and the human keeps their place.
  useEffect(() => {
    if (view === null || panel.width === 0 || panel.height === 0) return
    const restaged = view.resize(panel.width, panel.height)
    if (restaged !== null) setShown(restaged)
  }, [view, panel])

  /*
   * Framing a scene nobody has looked at yet.
   *
   * The extent of a level is only known once it has been drawn, so a scene
   * opening for the first time lands at whatever camera was current and this
   * puts it right on the next pass. It settles rather than oscillating for the
   * same reason the texture tab's fit does: after one pass the scene has a
   * remembered camera, so the condition is false and nothing runs again.
   *
   * Held back until three things are true, and each of them was a wrong
   * framing before it was a condition. Framing happens once per scene, so every
   * one of them is permanent until the human touches the view.
   *
   * 1. **Every texture has arrived, and the picture on screen is of all of
   *    them.** Both halves: the settings resolving is not the bytes arriving,
   *    so the report being held when the last `.meta` lands is still a picture
   *    of the scene with a sprite missing from it. An entity with no picture
   *    counts as a point rather than as the area it covers, so a level whose
   *    widest object had not loaded gets framed on the wrong middle.
   * 2. **The canvas is the size of the panel**, not merely measured. The
   *    renderer boots at a size of its own and is told the real one once the
   *    observer fires, so a scene can be reported drawn on a canvas that has
   *    nothing to do with the panel.
   * 3. **The panel has been measured at all** — a tab behind another one is
   *    0×0, and framing against nothing puts the level in a corner.
   */
  useEffect(() => {
    if (scenePath === null || shown === null || shown.path !== scenePath) return
    if (!complete || shownFor !== subject) return
    if (panel.width === 0 || panel.height === 0) return
    if (cameras[scenePath] !== undefined) return

    const measured = { width: Math.round(panel.width), height: Math.round(panel.height) }
    if (shown.canvasSize.width !== measured.width || shown.canvasSize.height !== measured.height) return

    const framed = frameOn(shown.contentBounds, shown.canvasSize, shown.camera.scale)
    setCameras((previous) =>
      previous[scenePath] === undefined ? { ...previous, [scenePath]: framed } : previous,
    )
  }, [scenePath, shown, panel, cameras, complete, shownFor, subject])

  // Look through whichever camera this scene is meant to have. Redraws only,
  // never fetches — panning and zooming must not send the editor back to the
  // service for bytes it already has.
  useEffect(() => {
    if (view === null || scenePath === null) return

    const wanted = cameras[scenePath]
    if (wanted === undefined) return
    if (shown !== null && shown.path === scenePath && shown.camera === wanted) return

    const restaged = view.restage(wanted)
    if (restaged !== null) setShown(restaged)
  }, [view, scenePath, cameras, shown])

  /**
   * Every change of view goes through here, which is what keeps a camera
   * attached to the scene it belongs to rather than to the viewport.
   */
  const adjust = useCallback((change: (camera: Camera, shown: ShownScene) => Camera) => {
    const path = pathRef.current
    const current = shownRef.current
    if (path === null || current === null || current.path !== path) return

    setCameras((previous) => {
      const camera = previous[path] ?? current.camera
      const next = change(camera, current)
      return next === camera ? previous : { ...previous, [path]: next }
    })
  }, [])

  const pan = useCallback(
    (screenDx: number, screenDy: number) => {
      adjust((camera) => panBy(camera, screenDx, screenDy))
    },
    [adjust],
  )

  const zoom = useCallback(
    (at: Point, direction: 1 | -1) => {
      adjust((camera, current) => {
        const scale = direction > 0 ? stepUp(camera.scale) : stepDown(camera.scale)
        // Already at the end of the ladder. Returning the same camera is what
        // stops a held-down wheel churning renders for no change.
        if (scale === camera.scale) return camera
        return zoomAbout(camera, at, scale, current.canvasSize)
      })
    },
    [adjust],
  )

  const frameAll = useCallback(() => {
    adjust((camera, current) => frameOn(current.contentBounds, current.canvasSize, camera.scale))
  }, [adjust])

  const frameEntity = useCallback(
    (entityId: string) => {
      adjust((camera, current) => {
        const entity = current.entities.find((one) => one.id === entityId)
        if (entity === undefined) return camera

        // Inverted from what was drawn, so this frames the rectangle the human
        // can see an outline around rather than one worked out a second way.
        const screen = entity.bounds ?? { x: entity.origin.x, y: entity.origin.y, width: 0, height: 0 }
        const content = toSceneRect(screen, current.camera, current.canvasSize)
        return frameOn(content, current.canvasSize, camera.scale)
      })
    },
    [adjust],
  )

  const measure = useCallback((width: number, height: number) => {
    setPanel((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    )
  }, [])

  const value = useMemo<SceneViewState>(() => {
    if (bootProblem !== null) return { state: 'unavailable', problem: bootProblem }
    if (view === null) return { state: 'booting' }

    return {
      state: 'ready',
      canvas: view.canvas,
      shown,
      shownFor: shownFor?.request ?? null,
      shownKey: shown === null ? '' : (shownFor?.key ?? ''),
      problem,
      measure,
      pan,
      zoom,
      frameAll,
      frameEntity,
      // The renderer's own methods, which live as long as the renderer does —
      // so a level that is running is not restarted by this object being
      // rebuilt around it every time the picture changes.
      redraw: view.redraw,
      onFrame: view.onFrame,
      restage: view.restage,
      playMusic: view.playMusic,
      stopMusic: view.stopMusic,
      musicState: view.musicState,
      playCue: view.playCue,
      soundState: view.soundState,
    }
  }, [bootProblem, view, shown, shownFor, problem, measure, pan, zoom, frameAll, frameEntity])

  const subjectApi = useMemo<SceneSubjectApi>(
    () => ({
      setSubject: (request, key) => setSubject(request === null ? null : { request, key }),
      setComplete,
      renameScene: (from, to) =>
        setCameras((previous) => {
          const camera = previous[from]
          if (camera === undefined || from === to) return previous
          const { [from]: _moved, ...rest } = previous
          return { ...rest, [to]: camera }
        }),
    }),
    [],
  )

  return (
    <SceneViewContext.Provider value={value}>
      <SceneSubjectContext.Provider value={subjectApi}>{children}</SceneSubjectContext.Provider>
    </SceneViewContext.Provider>
  )
}

/**
 * The camera that frames this content.
 *
 * Choosing the scale is where the editor's policy meets the runtime's
 * arithmetic: the ladder is `editor-ui` U17's, unforked from the texture tab,
 * so `8×` means the same thing in both — a whole number of screen pixels per
 * scene unit, because pixel art at 3.4× has some rows of a sprite a pixel
 * taller than others and the human goes looking for the fault in their own art.
 *
 * Content with no size — one entity whose texture is missing, say — keeps the
 * current zoom and is simply centred. There is nothing to fit, and snapping to
 * 1× would be an answer to a question nobody asked.
 */
function frameOn(content: Rect | null, canvas: Size, currentScale: number): Camera {
  if (content === null) return framing(null, 1)
  if (content.width <= 0 || content.height <= 0) return framing(content, currentScale)

  return framing(content, fitStep(content.width, content.height, canvas.width, canvas.height))
}

export function useSceneView(): SceneViewState {
  const view = useContext(SceneViewContext)
  if (view === null) throw new Error('useSceneView was called outside the editor shell')
  return view
}

/**
 * Told when a level's file moves, so the camera follows it.
 *
 * A second hook over the same context rather than a context of its own: there is
 * one provider holding the cameras, and two things that talk to it imperatively.
 */
export function useSceneCameraMoved(): (from: string, to: string) => void {
  const api = useContext(SceneSubjectContext)
  if (api === null) throw new Error('useSceneCameraMoved was called outside the editor shell')
  return api.renameScene
}

/**
 * Tells the scene viewport what to draw.
 *
 * Called from the panel rather than decided in the provider, because whether
 * there is a scene to draw at all is a question about what the human is looking
 * at, and every answer to it is a sentence the panel has to show.
 *
 * The subject is compared by value. The scene and its texture settings are
 * rebuilt by the document store on every edit anywhere in the project, so
 * comparing by identity would redraw this scene because a neighbouring file
 * changed.
 *
 * **`source` is part of that value, and it is load-bearing.** Two halves of the
 * editor now produce requests for the same level — the editor's own resolution
 * of it, and the runtime's, when Play is pressed — and if they agree, which is
 * the whole intention, the two requests stringify the same. Without something to
 * tell them apart, pressing Play would compare by value, find no change, and
 * quietly never draw the runtime's picture at all: the editing view would stay
 * on screen wearing play mode's caption. That is the most misleading failure
 * this feature could have, and it is invisible precisely when everything else is
 * working.
 *
 * `complete` says whether every texture this scene refers to has been resolved
 * one way or the other — arrived, or known to be unusable. It travels
 * separately from the subject, and on its own effect, so that the last texture
 * turning out to be *missing* tells the viewport the scene has settled without
 * also asking it to draw again.
 *
 * **It answers whether the picture on screen is of exactly this request**, which
 * is not the same question as "is there a picture". A level's textures arrive one
 * at a time, so the report in hand is regularly a real report of this same level
 * with half of it still missing — and there is a render between the last texture
 * arriving and the redraw being asked for, during which everything looks ready
 * and the picture is of the request before last. Anything acting on a *finished*
 * picture has to wait for this: framing does, and so does Play, which would
 * otherwise start against a baseline the human never saw.
 */
export function useDrawScene(
  subject: SceneRequest | null,
  complete: boolean,
  source: 'editing' | 'playing',
): boolean {
  const api = useContext(SceneSubjectContext)
  const view = useContext(SceneViewContext)
  if (api === null || view === null) throw new Error('useDrawScene was called outside the editor shell')

  const latest = useRef(subject)
  latest.current = subject

  const key = subject === null ? '' : `${source}\n${JSON.stringify(subject)}`

  useEffect(() => {
    api.setSubject(latest.current, key)
  }, [key, api])

  useEffect(() => {
    api.setComplete(complete)
  }, [complete, api])

  return key !== '' && view.state === 'ready' && view.shownKey === key
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
