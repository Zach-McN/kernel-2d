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

import { createSceneView, type SceneRequest, type SceneView, type ShownScene } from '../../runtime'

/**
 * The scene renderer, and everything about how the Viewport is looking at it.
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
      /** Why the scene could not be drawn, if it could not. */
      problem: string | null
      /** Told by the panel that hosts the canvas, in CSS pixels. */
      measure: (width: number, height: number) => void
    }

const SceneViewContext = createContext<SceneViewState | null>(null)
const SceneSubjectContext = createContext<((subject: SceneRequest | null) => void) | null>(null)

export function SceneViewProvider({ children }: { children: ReactNode }): ReactElement {
  const [view, setView] = useState<SceneView | null>(null)
  const [bootProblem, setBootProblem] = useState<string | null>(null)
  const [shown, setShown] = useState<ShownScene | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [subject, setSubject] = useState<SceneRequest | null>(null)
  const [panel, setPanel] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

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

    let live = true
    setProblem(null)

    void view
      .show(subject)
      .then((result) => {
        // A null result means a later request overtook this one, and the newer
        // request's own handler is the one that should be setting state.
        if (!live || result === null) return
        setShown(result)
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
  // because a panel dragged wider is not a reason to fetch anything again —
  // though for a scene it *does* move every sprite, since the floor is the
  // bottom edge.
  useEffect(() => {
    if (view === null || panel.width === 0 || panel.height === 0) return
    const restaged = view.resize(panel.width, panel.height)
    if (restaged !== null) setShown(restaged)
  }, [view, panel])

  const measure = useCallback((width: number, height: number) => {
    setPanel((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    )
  }, [])

  const value = useMemo<SceneViewState>(() => {
    if (bootProblem !== null) return { state: 'unavailable', problem: bootProblem }
    if (view === null) return { state: 'booting' }

    return { state: 'ready', canvas: view.canvas, shown, problem, measure }
  }, [bootProblem, view, shown, problem, measure])

  return (
    <SceneViewContext.Provider value={value}>
      <SceneSubjectContext.Provider value={setSubject}>{children}</SceneSubjectContext.Provider>
    </SceneViewContext.Provider>
  )
}

export function useSceneView(): SceneViewState {
  const view = useContext(SceneViewContext)
  if (view === null) throw new Error('useSceneView was called outside the editor shell')
  return view
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
 */
export function useDrawScene(subject: SceneRequest | null): void {
  const setSubject = useContext(SceneSubjectContext)
  if (setSubject === null) throw new Error('useDrawScene was called outside the editor shell')

  const latest = useRef(subject)
  latest.current = subject

  const key = subject === null ? '' : JSON.stringify(subject)

  useEffect(() => {
    setSubject(latest.current)
  }, [key, setSubject])
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
