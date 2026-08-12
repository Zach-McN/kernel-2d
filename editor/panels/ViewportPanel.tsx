import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'

import type { SceneRequest } from '../../runtime'
import { basename } from '../shell/asset-kinds'
import { useOpenScene, type OpenSceneState } from '../shell/open-scene'
import { describeProblem, problemsIn, useSceneAssets } from '../shell/scene-assets'
import { useDrawScene, useSceneView, type SceneViewState } from '../shell/scene-view-context'
import { useSelection } from '../shell/selection'
import { SceneOverlay, describeScene } from './SceneOverlay'

/**
 * The open scene, drawn by the real runtime.
 *
 * The panel's own job is small: host the canvas, measure itself, mark what is
 * selected, and say what is going on whenever there is no picture. The drawing
 * is the runtime's, the scene is the document store's, and which textures are
 * available is `scene-assets.ts` — this panel fetches nothing of its own, so the
 * picture and the Hierarchy and the Inspector are all describing one object
 * (`editor-ui` U12).
 *
 * There is no camera: the scene is drawn 1:1 with its origin at the bottom-left
 * corner of the panel and y counting upward. An entity placed outside that area
 * is off screen and stays findable in the Hierarchy until a camera lands.
 */
export function ViewportPanel(): ReactElement {
  const selection = useSelection()
  const open = useOpenScene()
  const view = useSceneView()
  const assets = useSceneAssets()

  const subject: SceneRequest | null =
    open.state === 'open' ? { path: open.path, scene: open.scene, textures: assets.textures } : null
  useDrawScene(subject)

  const shown = view.state === 'ready' ? view.shown : null
  // Only the scene that is open, in case a report from the previous one is
  // still the last thing the renderer answered with.
  const current = shown !== null && subject !== null && shown.path === subject.path ? shown : null

  const selected = selection.selected.kind === 'entity' ? selection.selected.entity : null

  return (
    <div
      className="viewport scene"
      data-testid="viewport-panel"
      data-scene-showing={current?.path ?? ''}
      data-scene-drawn={current === null ? '' : String(current.entities.filter((e) => e.bounds !== null).length)}
    >
      <Stage view={view}>
        {current !== null && <SceneOverlay shown={current} selected={selected} />}
      </Stage>

      <Caption open={open} view={view} problems={problemsIn(assets)} />
    </div>
  )
}

// --- the canvas ------------------------------------------------------------

/**
 * The canvas's host.
 *
 * The canvas belongs to the window rather than to this component, so it is
 * moved in on mount and taken back out on unmount — which is what lets the human
 * drag this tab across the layout without the renderer noticing.
 */
function Stage({ view, children }: { view: SceneViewState; children: ReactNode }): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const canvas = view.state === 'ready' ? view.canvas : null
  const measure = view.state === 'ready' ? view.measure : null

  useEffect(() => {
    const element = host.current
    if (element === null || canvas === null) return

    element.append(canvas)
    return () => {
      canvas.remove()
    }
  }, [canvas])

  useEffect(() => {
    const element = host.current
    if (element === null || measure === null) return

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const box = entry.contentRect
      // A panel behind another tab measures zero, and a scene drawn into
      // nothing would put every sprite on a floor line one pixel from the top.
      if (box.width === 0 || box.height === 0) return
      measure(box.width, box.height)
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [measure])

  return (
    <div className="viewport__stage" ref={host} data-testid="viewport-stage">
      {children}
    </div>
  )
}

// --- what it says ----------------------------------------------------------

interface CaptionProps {
  open: OpenSceneState
  view: SceneViewState
  problems: ReturnType<typeof problemsIn>
}

/**
 * Every state gets its own sentence (`editor-ui` U10). "No scene is open",
 * "this scene is empty" and "this scene refers to a texture that is not there"
 * are three different situations, and telling them apart is the whole value.
 */
function Caption({ open, view, problems }: CaptionProps): ReactElement {
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
      <Note>{view.shown === null ? 'Opening…' : describeScene(view.shown, open.scene.entities.length)}</Note>
      {/*
       * A missing texture is named rather than drawn as nothing. A scene that
       * quietly shows fewer sprites than it has entities is a scene the human
       * has to debug by counting, and the answer — which file, under which name
       * — is right here.
       */}
      {problems.map((problem) => (
        <Note key={problem.path} bad testId="viewport-problem">
          {describeProblem(problem)}
        </Note>
      ))}
    </Bar>
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
}: {
  children: ReactNode
  bad?: boolean
  testId?: string
}): ReactElement {
  return (
    <p className={bad === true ? 'viewport__note viewport__note--bad' : 'viewport__note'} data-testid={testId}>
      {children}
    </p>
  )
}
