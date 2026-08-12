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

import { createTextureView, type ShownTexture, type TextureView } from '../../runtime'
import type { TextureImportSettings } from '../../runtime/formats/meta-schema'
import { fitStep, stepDown, stepUp } from './zoom'

/**
 * The renderer, and everything about how the viewport is looking at it.
 *
 * It lives here, above the docking layout, for the same reason the project
 * folder does (`editor-ui` U9) and one more that is specific to it: dockview
 * unmounts a panel body whenever its tab is dragged, so a Phaser game owned by
 * the Viewport panel would be destroyed and rebuilt the first time somebody
 * moved the tab. That is exactly the per-selection teardown this design set out
 * to avoid, arriving through a different door — and rebuilding a game means a
 * fresh WebGL context, which browsers hand out in limited numbers.
 *
 * The canvas is created detached and handed to whichever panel is hosting it,
 * which adopts it on mount and gives it back on unmount. The game never
 * notices.
 */

export type ViewportState =
  | { state: 'booting' }
  /** The renderer would not start at all. */
  | { state: 'unavailable'; problem: string }
  | {
      state: 'ready'
      canvas: HTMLCanvasElement
      /** What is on screen, or null when nothing is. */
      shown: ShownTexture | null
      /** True while the bytes of a texture not yet on screen are in the air. */
      loading: boolean
      /** Why the selected texture could not be drawn, if it could not. */
      problem: string | null
      /** True while the zoom follows the panel rather than the buttons. */
      fitting: boolean
      zoomIn: () => void
      zoomOut: () => void
      fitToPanel: () => void
      /** Told by the panel that hosts the canvas, in CSS pixels. */
      measure: (width: number, height: number) => void
    }

/** What the viewport has been asked to draw. Null means draw nothing. */
export interface ViewportSubject {
  path: string
  /** Changes when the file on disk does, so a re-save is fetched again. */
  version: number
  settings: TextureImportSettings
}

interface Zoom {
  /** True while the scale follows the panel rather than the buttons. */
  fitting: boolean
  scale: number
}

const ViewportContext = createContext<ViewportState | null>(null)
const ViewportSubjectContext = createContext<((subject: ViewportSubject | null) => void) | null>(null)

export function ViewportProvider({ children }: { children: ReactNode }): ReactElement {
  const [view, setView] = useState<TextureView | null>(null)
  const [bootProblem, setBootProblem] = useState<string | null>(null)
  const [shown, setShown] = useState<ShownTexture | null>(null)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [subject, setSubject] = useState<ViewportSubject | null>(null)
  const [zoom, setZoom] = useState<Zoom>({ fitting: true, scale: 1 })
  const [panel, setPanel] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  // Mirrors of state, read inside effects that must not re-run when they
  // change. The scale is an input to drawing, not a reason to fetch a texture
  // again; what is currently on screen decides only whether to say "loading".
  //
  // Read during render rather than in an effect, so an effect never sees a
  // value from the render before last.
  const scaleRef = useRef(zoom.scale)
  scaleRef.current = zoom.scale
  const shownRef = useRef<ShownTexture | null>(shown)
  shownRef.current = shown

  useEffect(() => {
    let live = true
    let created: TextureView | null = null

    void createTextureView({
      resolveAssetUrl: (path, version) =>
        `/api/asset?path=${encodeURIComponent(path)}&v=${encodeURIComponent(String(version))}`,
    })
      .then((textureView) => {
        created = textureView
        // React's development double-mount tears this down before the game has
        // finished booting, so the teardown below has nothing to destroy yet.
        if (live) setView(textureView)
        else textureView.destroy()
      })
      .catch((error: unknown) => {
        if (live) setBootProblem(messageOf(error))
      })

    return () => {
      live = false
      created?.destroy()
    }
  }, [])

  // Draw whatever has been asked for. Keyed on the file, its version and its
  // settings — not on the scale, because changing the zoom is a redraw and must
  // never send the editor back to the service for bytes it already has.
  useEffect(() => {
    if (view === null) return

    if (subject === null) {
      view.clear()
      setShown(null)
      setLoading(false)
      setProblem(null)
      return
    }

    let live = true
    setProblem(null)
    // Only announced as loading when there is nothing of this file to look at.
    // Re-showing a texture already on screen with different settings must not
    // blink, or every keystroke in a frame-size field would flash the panel.
    setLoading(shownRef.current === null || shownRef.current.path !== subject.path)

    void view
      .show({ ...subject, scale: scaleRef.current })
      .then((result) => {
        // A null result means a later request overtook this one, and the newer
        // request's own handler is the one that should be setting state.
        if (!live || result === null) return
        setShown(result)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (!live) return
        setShown(null)
        setLoading(false)
        setProblem(messageOf(error))
      })

    return () => {
      live = false
    }
  }, [view, subject])

  // Hand the panel's measurements to the renderer. Separate from drawing
  // because a panel dragged wider is not a reason to fetch anything again.
  useEffect(() => {
    if (view === null || panel.width === 0 || panel.height === 0) return
    const restaged = view.resize(panel.width, panel.height)
    if (restaged !== null) setShown(restaged)
  }, [view, panel])

  /*
   * Keeping the zoom in step with what is on screen.
   *
   * Fitting cannot be decided until the image's size is known, and its size is
   * only known once it has been drawn — so the first draw lands at whatever
   * scale was current and this puts it right. It settles rather than
   * oscillating for the same reason the write/re-read cycle in the document
   * store does: after one pass the drawn scale *is* the wanted scale and the
   * wanted scale *is* the recorded one, so both conditions are false and
   * nothing runs again. The first iteration is already the fixed point.
   */
  useEffect(() => {
    if (view === null || shown === null) return

    const wanted = zoom.fitting ? fitStep(shown.width, shown.height, panel.width, panel.height) : zoom.scale

    if (wanted !== shown.placement.scale) {
      const restaged = view.restage(wanted)
      if (restaged !== null) setShown(restaged)
    }
    if (wanted !== zoom.scale) setZoom((previous) => ({ ...previous, scale: wanted }))
  }, [view, shown, zoom, panel])

  // A different file is looked at afresh: the zoom somebody chose for a 16px
  // sprite is not a choice they made about a 4096px tileset.
  useEffect(() => {
    setZoom((previous) => (previous.fitting ? previous : { ...previous, fitting: true }))
  }, [subject?.path])

  const measure = useCallback((width: number, height: number) => {
    setPanel((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    )
  }, [])

  const value = useMemo<ViewportState>(() => {
    if (bootProblem !== null) return { state: 'unavailable', problem: bootProblem }
    if (view === null) return { state: 'booting' }

    return {
      state: 'ready',
      canvas: view.canvas,
      shown,
      loading,
      problem,
      fitting: zoom.fitting,
      zoomIn: () => setZoom((previous) => ({ fitting: false, scale: stepUp(previous.scale) })),
      zoomOut: () => setZoom((previous) => ({ fitting: false, scale: stepDown(previous.scale) })),
      fitToPanel: () => setZoom((previous) => ({ ...previous, fitting: true })),
      measure,
    }
  }, [bootProblem, view, shown, loading, problem, zoom.fitting, measure])

  return (
    <ViewportContext.Provider value={value}>
      <ViewportSubjectContext.Provider value={setSubject}>{children}</ViewportSubjectContext.Provider>
    </ViewportContext.Provider>
  )
}

export function useViewport(): ViewportState {
  const viewport = useContext(ViewportContext)
  if (viewport === null) throw new Error('useViewport was called outside the editor shell')
  return viewport
}

/**
 * Tells the viewport what to draw.
 *
 * Called from the panel rather than decided in the provider, because whether
 * the selection is a texture at all is a question about what the human is
 * looking at, and every answer to it is a sentence the panel has to show.
 *
 * The subject is compared by value. The settings object is rebuilt by the
 * document store on every edit anywhere in the project, so comparing by
 * identity would redraw this texture because a neighbouring file changed.
 */
export function useShowInViewport(subject: ViewportSubject | null): void {
  const setSubject = useContext(ViewportSubjectContext)
  if (setSubject === null) throw new Error('useShowInViewport was called outside the editor shell')

  const latest = useRef(subject)
  latest.current = subject

  const key = subject === null ? '' : `${subject.path}@${subject.version}#${JSON.stringify(subject.settings)}`

  useEffect(() => {
    setSubject(latest.current)
  }, [key, setSubject])
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
