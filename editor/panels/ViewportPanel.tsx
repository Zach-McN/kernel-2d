import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'

import type { AssetMeta, TextureImportSettings } from '../../runtime/formats/meta-schema'
import type { TreeNode } from '../../sidecar/tree-schema'
import { TYPE_NAMES, assetTypeOf, basename, findNode } from '../shell/asset-kinds'
import { useSelectedAssetMeta } from '../shell/asset-meta-context'
import { useProject } from '../shell/project-context'
import { useSelection } from '../shell/selection'
import { useShowInViewport, useViewport, type ViewportSubject } from '../shell/viewport-context'
import { describeZoom } from '../shell/zoom'
import { useDocument } from '../store/open-documents'
import { ViewportOverlay, describeShown } from './ViewportOverlay'

/**
 * The selected texture, drawn by the real runtime.
 *
 * The panel's own job is small: host the canvas, measure itself, and say what
 * is going on whenever there is no picture. The drawing is the runtime's and
 * the settings are the document store's — this panel fetches nothing of its
 * own, because a control or a preview built over the served answer rather than
 * over the document looks entirely correct and quietly disagrees with the
 * Inspector (`editor-ui` U12).
 *
 * Every state gets a sentence rather than a blank, and they are deliberately
 * different sentences: "nothing is selected" and "what is selected is a sound"
 * are different situations, and being able to tell them apart is the point
 * (`editor-ui` U10).
 */
export function ViewportPanel(): ReactElement {
  const project = useProject()
  const selection = useSelection()
  const viewport = useViewport()
  const tree = project.state === 'ready' ? project.tree : null
  const node = tree === null || selection.path === null ? null : findNode(tree, selection.path)

  const meta = useSelectedAssetMeta()
  const view = meta.state === 'ready' ? meta.view : null
  const document = useDocument(selection.path)
  // The document if the store has it, falling back to the served answer for the
  // moment in between. Only ever used to say what kind of file this is —
  // anything actually drawn comes from the document alone.
  const settings: AssetMeta | null = document ?? (view?.status === 'ok' ? view.meta : null)

  const subject = subjectFor(node, document)
  useShowInViewport(subject)

  // What is on screen, said out loud on the element itself.
  //
  // Every one of these comes from the renderer's report of what it drew rather
  // than from what it was asked to draw — the filter in particular is read back
  // off the live texture. That is what makes them worth asserting: a panel
  // echoing its own request would keep claiming the picture was right long
  // after the line that applies the setting stopped working.
  const shown = viewport.state === 'ready' ? viewport.shown : null

  return (
    <div
      className="viewport"
      data-testid="viewport-panel"
      data-viewport-showing={shown?.path ?? ''}
      data-drawn-filter={shown?.filter ?? ''}
      data-drawn-version={shown === null ? '' : String(shown.version)}
    >
      <Stage viewport={viewport}>
        {viewport.state === 'ready' && viewport.shown !== null && subject !== null && (
          <ViewportOverlay shown={viewport.shown} pivot={subject.settings.pivot} />
        )}
      </Stage>

      <Caption node={node} settings={settings} subject={subject} />
    </div>
  )
}

/**
 * What the viewport has been asked to draw, or null when the answer is a
 * sentence rather than a picture.
 *
 * Settings come from the document and only from the document, so the picture on
 * screen and the controls in the Inspector are always describing the same
 * object. A texture whose settings have not reached the store yet is not drawn,
 * which is the same instinct as U12 one panel over: a preview built from
 * whatever happened to be available would be right most of the time, and
 * silently stale the rest.
 */
function subjectFor(node: TreeNode | null, document: AssetMeta | null): ViewportSubject | null {
  if (node === null || node.kind !== 'file') return null
  if (document === null || document.importSettings.type !== 'texture') return null

  const settings: TextureImportSettings = document.importSettings
  return { path: node.path, version: node.mtimeMs, settings }
}

// --- the canvas ------------------------------------------------------------

/**
 * The canvas's host.
 *
 * The canvas belongs to the window rather than to this component, so it is
 * moved in on mount and taken back out on unmount — which is what lets the
 * human drag this tab across the layout without the renderer noticing.
 */
function Stage({ viewport, children }: { viewport: ViewportState; children: ReactNode }): ReactElement {
  const host = useRef<HTMLDivElement>(null)
  const canvas = viewport.state === 'ready' ? viewport.canvas : null
  const measure = viewport.state === 'ready' ? viewport.measure : null

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

type ViewportState = ReturnType<typeof useViewport>

interface CaptionProps {
  node: TreeNode | null
  settings: AssetMeta | null
  subject: ViewportSubject | null
}

function Caption({ node, settings, subject }: CaptionProps): ReactElement {
  const viewport = useViewport()

  if (viewport.state === 'unavailable') {
    return (
      <Bar>
        <Note>
          The renderer would not start in this browser: {viewport.problem} The viewport needs WebGL.
        </Note>
      </Bar>
    )
  }

  if (viewport.state === 'ready' && viewport.problem !== null && subject !== null) {
    return (
      <Bar>
        <Note>
          <strong>{basename(subject.path)}</strong> could not be loaded: {viewport.problem}
        </Note>
      </Bar>
    )
  }

  if (viewport.state === 'ready' && viewport.shown !== null) {
    return (
      <Bar>
        <Note>{describeShown(viewport.shown)}</Note>
        {viewport.shown.frames.length > 1 && (
          <Note faint>The pivot marker is on the first frame; it means the same on every frame.</Note>
        )}
        <Zoom viewport={viewport} />
      </Bar>
    )
  }

  return (
    <Bar>
      <Note>{sentenceFor(node, settings, viewport)}</Note>
    </Bar>
  )
}

/**
 * Why there is no picture. Each case names what the selected thing actually is,
 * rather than what it is not, and says what would put something here.
 */
function sentenceFor(node: TreeNode | null, settings: AssetMeta | null, viewport: ViewportState): string {
  if (viewport.state === 'booting') return 'Starting the renderer…'
  if (viewport.state === 'ready' && viewport.loading) return 'Loading…'

  if (node === null) return 'Select a texture in the Assets panel to see it here.'

  if (node.kind === 'directory') {
    return `${node.name} is a folder. Select a texture inside it to see it drawn here.`
  }

  const type = assetTypeOf(node.name, settings)

  if (type === 'texture') {
    return `Reading the import settings for ${node.name}…`
  }

  if (type === null) {
    return `The editor does not import ${node.name}, so there is nothing to draw.`
  }

  if (type === 'audio') {
    return `${node.name} is a sound. The viewport draws textures; hearing a sound arrives with audio preview.`
  }

  if (type === 'font') {
    return `${node.name} is a font. Its page is an ordinary texture — select that to see the glyphs.`
  }

  return `${node.name} is ${TYPE_NAMES[type].toLowerCase()}, so there is nothing to draw.`
}

function Zoom({ viewport }: { viewport: Extract<ViewportState, { state: 'ready' }> }): ReactElement {
  const scale = viewport.shown?.placement.scale ?? 1

  return (
    <span className="viewport__zoom">
      <button type="button" className="control control--step" data-testid="zoom-out" onClick={viewport.zoomOut}>
        −
      </button>
      <span className="viewport__scale" data-testid="viewport-scale" data-scale={scale}>
        {describeZoom(scale)}
      </span>
      <button type="button" className="control control--step" data-testid="zoom-in" onClick={viewport.zoomIn}>
        +
      </button>
      <button
        type="button"
        className="control control--step"
        data-testid="zoom-fit"
        data-fitting={viewport.fitting}
        onClick={viewport.fitToPanel}
      >
        Fit
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

function Note({ children, faint }: { children: ReactNode; faint?: boolean }): ReactElement {
  return (
    <p className={faint === true ? 'viewport__note viewport__note--faint' : 'viewport__note'}>{children}</p>
  )
}
