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

import { loadScene, type LoadProblem, type SceneRequest, type ShownScene } from '../../runtime'
import { metaPathFor } from '../../runtime/formats/meta-schema'
import {
  currentSaveFailures,
  flushSaves,
  resumeEditing,
  sealEdits,
  suspendEditing,
} from '../store/open-documents'
import { basename } from './asset-kinds'
import { useOpenScene } from './open-scene'
import { useProject } from './project-context'
import { projectReaderFor } from './project-reader'
import { useSceneAssets } from './scene-assets'
import { useResolvedScene } from './scene-prefabs'
import { useSceneView } from './scene-view-context'

/**
 * Play mode: which level is running, and what it took to start it.
 *
 * **Nothing here reaches a file.** Which level is playing, the picture it was
 * started from, whether it matched — all of it lives for as long as the window
 * does and no longer, exactly like the selection and the camera (`editor-ui`
 * U8). Play mode is not in the document, so Ctrl-Z cannot see it; it is not in a
 * `.meta` and not in `project.json`, so stopping and closing the editor leaves no
 * trace that it ever happened.
 *
 * **Pressing Play finishes the save before it reads the file.** The editor has
 * no save button — a change is written after a short quiet period (D18) — so a
 * level played a fifth of a second after a drag would otherwise run the version
 * from before the drag, with nothing on screen to explain the difference. So Play
 * seals the open edit, drains everything waiting to be written, and only then
 * hands the path to the runtime. That is what lets play mode genuinely boot from
 * disk *and* show the change you just made.
 *
 * **A refused save stops it.** If the folder never accepted a change to this
 * level, or to a prefab or set of import settings it depends on, then what is on
 * disk is not what is on screen and running it would be quietly showing the wrong
 * thing. Play says which file instead. Rare, and the one case where refusing is
 * kinder than proceeding.
 */

export type PlayState =
  | { state: 'stopped' }
  /** Pressed, and the file has not come back yet. */
  | { state: 'starting'; path: string }
  | {
      state: 'running'
      path: string
      /** What the runtime's loader made of the file. Handed to the renderer as-is. */
      request: SceneRequest
      /** References the loader could not resolve. The level runs regardless. */
      problems: LoadProblem[]
      /**
       * The editing view's own report, from the instant before Play was pressed.
       * What the running picture is checked against.
       */
      baseline: ShownScene
    }
  /** It could not be started, and this is the sentence saying why. */
  | { state: 'failed'; path: string; problem: string }

export interface PlayMode {
  play: PlayState
  /** True whenever a level is running or about to be. Editing is off. */
  active: boolean
  /** Starts the open level. Does nothing when one is already running. */
  start: () => void
  stop: () => void
}

const PlayModeContext = createContext<PlayMode | null>(null)

export function PlayModeProvider({ children }: { children: ReactNode }): ReactElement {
  const [play, setPlay] = useState<PlayState>({ state: 'stopped' })

  const open = useOpenScene()
  const project = useProject()
  const view = useSceneView()
  const assets = useSceneAssets()
  const resolved = useResolvedScene()

  // Read inside the click handler rather than closed over, so what Play uses is
  // what was true when it was pressed rather than at the last render.
  const latest = useRef({ open, project, view, assets, resolved })
  latest.current = { open, project, view, assets, resolved }

  const active = play.state !== 'stopped'

  /*
   * Editing is suspended for as long as something is running, and the effect —
   * rather than the two handlers — is what turns it on and off. A handler that
   * suspended on the way in and resumed on the way out would leave the editor
   * permanently read-only the first time a start threw between the two.
   */
  useEffect(() => {
    if (!active) return
    suspendEditing()
    return resumeEditing
  }, [active])

  const start = useCallback(() => {
    const { open: scene, project: tree, view: shown, assets: textures, resolved: prefabs } = latest.current
    if (scene.state !== 'open') return

    const path = scene.path
    // The picture the running level will be checked against. Taken here, before
    // anything is asked for, because this is the last instant at which what is
    // on screen is the editing view.
    const baseline =
      shown.state === 'ready' && shown.shown !== null && shown.shown.path === path ? shown.shown : null

    setPlay({ state: 'starting', path })

    void (async () => {
      // Everything the editor is holding goes to the folder first. Sealing the
      // merge run as well, so a level played mid-drag is one undo step and not
      // half of one.
      sealEdits()
      await flushSaves()

      const unsaved = refusedSave(path, prefabs.prefabs, textures.textures)
      if (unsaved !== null) {
        setPlay({ state: 'failed', path, problem: unsaved })
        return
      }

      const result = await loadScene(
        projectReaderFor(tree.state === 'ready' ? tree.tree : null),
        path,
      )

      if (!result.ok) {
        setPlay({ state: 'failed', path, problem: result.problem })
        return
      }
      if (baseline === null) {
        setPlay({
          state: 'failed',
          path,
          problem: `${basename(path)} was not on screen when Play was pressed, so there is nothing to run it against.`,
        })
        return
      }

      setPlay({ state: 'running', path, request: result.request, problems: result.problems, baseline })
    })()
  }, [])

  const stop = useCallback(() => {
    setPlay({ state: 'stopped' })
  }, [])

  /*
   * A level that stops being the open one takes play with it.
   *
   * Nothing in the editor can change the open level while something is running —
   * the Assets panel is out of reach — but a text editor deleting the file can,
   * and a running picture of a level the rest of the window has moved on from is
   * the one state here that would be actively misleading.
   */
  const openPath = open.state === 'open' ? open.path : null
  useEffect(() => {
    if (play.state === 'stopped') return
    if (play.path !== openPath) setPlay({ state: 'stopped' })
  }, [play, openPath])

  const value = useMemo<PlayMode>(() => ({ play, active, start, stop }), [play, active, start, stop])

  return <PlayModeContext.Provider value={value}>{children}</PlayModeContext.Provider>
}

export function usePlayMode(): PlayMode {
  const mode = useContext(PlayModeContext)
  if (mode === null) throw new Error('usePlayMode was called outside the editor shell')
  return mode
}

/**
 * Whether the folder ever accepted the latest version of anything this level is
 * made of.
 *
 * Checked across the level, the prefabs it places from and the import settings of
 * every texture it draws, rather than "any failure anywhere": a `.meta` that
 * would not save in some other corner of the project has nothing to do with
 * whether this level runs as it looks.
 */
function refusedSave(
  scenePath: string,
  prefabs: Readonly<Record<string, unknown>>,
  textures: Readonly<Record<string, unknown>>,
): string | null {
  const failures = currentSaveFailures()

  const paths = [scenePath, ...Object.keys(prefabs), ...Object.keys(textures).map(metaPathFor)]
  for (const path of paths) {
    const failure = failures[path]
    if (failure === undefined) continue
    return `${basename(path)} has changes the project folder never accepted (${failure}), so the file is not what you are looking at. Play reads the file.`
  }

  return null
}
