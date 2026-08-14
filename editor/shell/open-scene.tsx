import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { SCENE_FORMAT, type Scene } from '../../runtime/formats/scene-schema'
import { DocumentViewSchema, type DocumentView } from '../../sidecar/document-view-schema'
import { adoptFromDisk, beginRead, useSceneDocument } from '../store/open-documents'
import { couldBeDocument } from './asset-kinds'
import { useProject } from './project-context'
import { useSelection } from './selection'

/**
 * The scene that is open, and the document behind it.
 *
 * Two jobs, and they are one fetch. Reading a `.json` the human clicked is how
 * the editor finds out whether it is a scene at all — the file's own `format`
 * decides, not its folder or its name (`editor-ui` U11) — and it is also how the
 * document gets into the store. Splitting them would mean asking twice.
 *
 * It sits above the docking layout for the usual reason (`editor-ui` U9) and for
 * the sharper one: this fetch has a side effect, because it is what puts the
 * scene into the document store. Owned by the Outliner panel, closing that tab
 * would leave the Viewport drawing a scene whose document never arrived — a
 * panel silently depending on another panel being open.
 *
 * The scene is re-asked for whenever the folder changes as well as whenever the
 * selection does, so editing a scene in a text editor shows up here without a
 * reload. Whether the incoming value is taken is the store's decision, not this
 * hook's: disk wins, except while the editor holds a change the folder has not
 * seen (`editor/store/documents.ts`).
 */

export type OpenSceneState =
  /** Nothing has been opened yet. */
  | { state: 'none' }
  | { state: 'loading'; path: string }
  | { state: 'open'; path: string; scene: Scene }
  /** There is a file and it is not a scene this editor can read. */
  | { state: 'unreadable'; path: string; problem: string; text: string | null }
  /** The file the editor was holding open is not in the project folder. */
  | { state: 'gone'; path: string }
  /** The question could not be asked at all. */
  | { state: 'unavailable'; path: string }

/** The service's last word about one path, for anything that asked about it. */
export type DocumentAnswer =
  | { state: 'loading' }
  | { state: 'ready'; view: DocumentView }
  | { state: 'unavailable' }

interface OpenSceneValue {
  open: OpenSceneState
  answer: { forPath: string | null; view: DocumentView | null; failed: boolean }
}

const OpenSceneContext = createContext<OpenSceneValue | null>(null)

export function OpenSceneProvider({ children }: { children: ReactNode }): ReactElement {
  const project = useProject()
  const selection = useSelection()
  const tree = project.state === 'ready' ? project.tree : null

  const { openScene, selectedFilePath, setOpenScene } = selection

  // What the service last said about a path, and which path it was about. The
  // pair is compared at render time rather than cleared in an effect, because
  // an effect runs *after* the render that changed the selection — so for one
  // render this would otherwise answer about the file selected a moment ago
  // (`editor-ui` UG5).
  const [answer, setAnswer] = useState<{ forPath: string | null; view: DocumentView | null; failed: boolean }>(
    { forPath: null, view: null, failed: false },
  )

  // Whichever path we should be reading: a selected `.json` (which might turn
  // out to be a scene) or, failing that, the scene already open.
  const candidate =
    selectedFilePath !== null && couldBeDocument(selectedFilePath) ? selectedFilePath : openScene

  const setOpenSceneRef = useRef(setOpenScene)
  setOpenSceneRef.current = setOpenScene

  useEffect(() => {
    if (candidate === null) return

    let stopped = false

    const ask = async (): Promise<void> => {
      // Taken before the question is asked, not after the answer arrives: a late
      // answer is indistinguishable from a fresh one, and the store is the thing
      // that needs to be able to tell them apart.
      const readStartedAt = beginRead()
      try {
        const response = await fetch(`/api/document?path=${encodeURIComponent(candidate)}`, {
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(String(response.status))
        const view = DocumentViewSchema.parse(await response.json())

        // Offered to the store even if this hook has since been torn down: the
        // folder said something true about a file, and which panel happened to
        // ask has nothing to do with whether it is worth knowing.
        if (view.status === 'ok' && view.document !== null) {
          adoptFromDisk(view.path, view.document, readStartedAt)
          // This is the moment a file becomes "the open scene" — because of what
          // it says it is, not because of where it lives.
          if (view.document.format === SCENE_FORMAT) setOpenSceneRef.current(view.path)
        }

        if (!stopped) setAnswer({ forPath: candidate, view, failed: false })
      } catch {
        if (!stopped) setAnswer({ forPath: candidate, view: null, failed: true })
      }
    }

    void ask()

    return () => {
      stopped = true
    }
    // The tree is a dependency because a scene edited in a text editor arrives
    // as a folder change, and the answer has to be asked for again.
  }, [candidate, tree])

  // Read from the store, never from the served answer: the store is what the
  // Outliner's edits change and what undo reverses, and a panel drawing the
  // served copy would look right and quietly disagree (`editor-ui` U12).
  const scene = useSceneDocument(openScene)

  const open = useMemo<OpenSceneState>(() => {
    if (openScene === null) return { state: 'none' }
    if (scene !== null) return { state: 'open', path: openScene, scene }

    // Only an answer about *this* path can say anything about it.
    if (answer.forPath !== openScene) return { state: 'loading', path: openScene }
    if (answer.failed) return { state: 'unavailable', path: openScene }
    if (answer.view === null) return { state: 'loading', path: openScene }
    if (answer.view.status === 'none') return { state: 'gone', path: openScene }
    if (answer.view.status === 'unreadable') {
      return {
        state: 'unreadable',
        path: openScene,
        problem: answer.view.problem ?? 'This editor cannot read that file.',
        text: answer.view.text,
      }
    }

    // Parsed, but the store has not taken it yet — the gap of one render
    // between the answer arriving and the store settling.
    return { state: 'loading', path: openScene }
  }, [openScene, scene, answer])

  const value = useMemo<OpenSceneValue>(() => ({ open, answer }), [open, answer])

  return <OpenSceneContext.Provider value={value}>{children}</OpenSceneContext.Provider>
}

export function useOpenScene(): OpenSceneState {
  return useOpenSceneValue().open
}

/**
 * What the service said about one `.json`, for a panel that has to describe a
 * document rather than show it — a data table, or a scene from a newer editor.
 *
 * Deliberately separate from `useOpenScene`, which is about the scene being
 * *shown*. Answers `loading` for any path this provider has not asked about,
 * because "I have no answer about that file" and "the answer is nothing" are
 * different things and only one of them is worth a sentence.
 */
export function useDocumentAnswer(path: string | null): DocumentAnswer {
  const { answer } = useOpenSceneValue()
  if (path === null || answer.forPath !== path) return { state: 'loading' }
  if (answer.failed) return { state: 'unavailable' }
  if (answer.view === null) return { state: 'loading' }
  return { state: 'ready', view: answer.view }
}

function useOpenSceneValue(): OpenSceneValue {
  const value = useContext(OpenSceneContext)
  if (value === null) throw new Error('useOpenScene was called outside the editor shell')
  return value
}
