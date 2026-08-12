import type { ReactElement, ReactNode } from 'react'

import {
  assetTypeForName,
  isMetaFileName,
  type AssetMeta,
  type ImportSettings,
} from '../../runtime/formats/meta-schema'
import { formatBytes } from '../../sidecar/bytes'
import type { MetaView } from '../../sidecar/meta-view-schema'
import type { DirectoryNode, TreeNode } from '../../sidecar/tree-schema'
import { TYPE_NAMES, basename, describeKind, findNode } from '../shell/asset-kinds'
import { useSelectedAssetMeta } from '../shell/asset-meta-context'
import { assetRowsFor } from '../shell/asset-rows'
import { useProject } from '../shell/project-context'
import { useSelection } from '../shell/selection'
import type { AssetMetaState } from '../shell/useAssetMeta'
import { useDocument, useSaveFailure } from '../store/open-documents'
import { SaveFailure, TextureSettings } from './TextureSettings'

/**
 * What the selected thing holds.
 *
 * The rule this panel keeps is that it always says something. A blank
 * inspector is indistinguishable from a broken one, and the cases where there
 * is no `.meta` to show — a scene file, a folder, a README, a texture whose
 * sidecar has not landed yet — are ordinary rather than exceptional. Each gets
 * a sentence naming what it is and why there is nothing to tune.
 *
 * A texture's settings are read from the document store rather than from the
 * answer the service gave, because the store is what the controls change and
 * what undo reverses. Everything else is still read straight from that answer:
 * there is nothing to edit about a folder, a scene, or a `.meta` this editor
 * cannot parse.
 */
export function InspectorPanel(): ReactElement {
  const project = useProject()
  const selection = useSelection()
  const tree = project.state === 'ready' ? project.tree : null
  // Read from the window rather than fetched here: the Viewport needs the same
  // answer, and two panels each asking would be two answers on two timers
  // (`editor-ui` U9).
  const meta = useSelectedAssetMeta()

  if (selection.path === null) {
    return <Empty>Select a file or folder in the Assets panel to see what it holds.</Empty>
  }

  const node = tree === null ? null : findNode(tree, selection.path)

  if (node === null) {
    return (
      <Empty>
        <strong>{basename(selection.path)}</strong> is no longer in the project folder.
      </Empty>
    )
  }

  return (
    <div className="inspector" data-testid="inspector-panel" data-inspecting={node.path}>
      <header className="inspector__header">
        <h2 className="inspector__name" data-testid="inspector-name">
          {node.name}
        </h2>
        <p className="inspector__path" data-testid="inspector-path">
          {node.path}
        </p>
      </header>

      {node.kind === 'directory' ? <FolderBody node={node} /> : <FileBody node={node} meta={meta} />}
    </div>
  )
}

// --- folders ---------------------------------------------------------------

function FolderBody({ node }: { node: DirectoryNode }): ReactElement {
  // Counted the way the Assets panel lists them, sidecars folded in, so the
  // number here and the rows on screen are never two different answers.
  const rows = assetRowsFor(node.children)
  const folders = rows.filter((row) => row.node.kind === 'directory').length
  const files = rows.length - folders

  return (
    <Section title="Folder">
      <Field label="Holds" value={`${count(folders, 'folder')}, ${count(files, 'file')}`} />
      <Note data-testid="inspector-note">A folder has no import settings of its own.</Note>
    </Section>
  )
}

// --- files -----------------------------------------------------------------

interface FileBodyProps {
  node: Extract<TreeNode, { kind: 'file' }>
  meta: AssetMetaState
}

function FileBody({ node, meta }: FileBodyProps): ReactElement {
  const view = meta.state === 'ready' ? meta.view : null
  // The document if this window has taken it into the store, falling back to
  // the served answer for the moment in between.
  const document = useDocument(node.path)
  const settings: AssetMeta | null = document ?? (view !== null && view.status === 'ok' ? view.meta : null)

  return (
    <>
      <Section title="File">
        <Field label="Size" value={formatBytes(node.size)} />
        <Field
          label="Type"
          // What the file says it is beats what its name suggests, on the same
          // grounds as anywhere else: the `.meta` is authored, the extension is
          // a guess.
          value={settings === null ? describeKind(node.name) : TYPE_NAMES[settings.type]}
          testId="inspector-type"
        />
        {settings !== null && <Field label="ID" value={settings.id} testId="inspector-id" />}
      </Section>

      {meta.state === 'loading' && <Note>Reading its import settings…</Note>}
      {meta.state === 'unavailable' && (
        <Note data-testid="inspector-note">
          Could not ask the editor service about this file. Is the editor command still running?
        </Note>
      )}
      {view !== null && <MetaBody node={node} view={view} document={document} />}
    </>
  )
}

function MetaBody({
  node,
  view,
  document,
}: {
  node: TreeNode
  view: MetaView
  document: AssetMeta | null
}): ReactElement {
  // The document, never the served answer. A control built over the answer
  // would look right and change nothing, because the transaction API can only
  // change a document the store is holding — and "the control does nothing"
  // is the hardest kind of bug to see, since every part of it looks fine.
  if (view.status === 'ok' && document !== null) {
    return <Settings path={node.path} meta={document} metaPath={view.metaPath} />
  }

  if (view.status === 'ok') {
    return (
      <Section title="Import settings">
        <Note>Reading its import settings…</Note>
      </Section>
    )
  }

  if (view.status === 'unreadable') {
    return (
      <Section title="Import settings">
        <Note data-testid="inspector-note">
          {view.problem} It has been left exactly as it is on disk — nothing here rewrites a file it
          cannot read.
        </Note>
        {view.text !== null && <pre className="inspector__raw">{view.text}</pre>}
      </Section>
    )
  }

  return (
    <Section title="Import settings">
      <Note data-testid="inspector-note">{describeMissingMeta(node.path)}</Note>
    </Section>
  )
}

function Settings({
  path,
  meta,
  metaPath,
}: {
  path: string
  meta: AssetMeta
  metaPath: string | null
}): ReactElement {
  const saveFailure = useSaveFailure(path)

  return (
    <>
      <Section title="Import settings">
        <SettingFields path={path} settings={meta.importSettings} />
        {saveFailure !== null && <SaveFailure reason={saveFailure} />}
      </Section>

      <Section title="Where these live">
        {metaPath !== null && <Field label="File" value={metaPath} />}
        {meta.generatedBy !== undefined && (
          <Field
            label="Made by"
            value={meta.generatedAt === undefined ? meta.generatedBy : `${meta.generatedBy}, ${meta.generatedAt}`}
            testId="inspector-generated"
          />
        )}
        <Note>Changes are saved as you make them. Ctrl-Z takes one back, Ctrl-Y puts it forward.</Note>
      </Section>
    </>
  )
}

function SettingFields({ path, settings }: { path: string; settings: ImportSettings }): ReactElement {
  if (settings.type !== 'texture') {
    return <Note data-testid="inspector-note">Nothing to tune on import for this kind of file yet.</Note>
  }

  return <TextureSettings path={path} settings={settings} />
}

// --- saying what a file is -------------------------------------------------

/**
 * The folder a document sits in is what names it. These are the folders in the
 * project layout, and each one's inspector arrives with the format it holds —
 * saying so is more use than "unknown file".
 */
const DOCUMENT_FOLDERS: Record<string, string> = {
  scenes: 'A scene. Scenes get their own inspector when the scene format lands.',
  prefabs: 'A prefab. Prefabs get their own inspector when the prefab format lands.',
  data: 'A data table. These get the tool that writes them, when the genre needs one.',
}

function describeMissingMeta(path: string): string {
  const name = basename(path)

  if (isMetaFileName(name)) {
    return 'This is an import-settings file, and the file it describes is not beside it. It will be cleared out the next time the editor starts.'
  }

  const document = describeDocument(path)
  if (document !== null) return document

  if (assetTypeForName(name) !== null) {
    return 'No import settings yet. One is written within a second of the file appearing — if this stays, check the editor command is still running.'
  }

  return 'The editor does not import this kind of file, so it has no settings.'
}

function describeDocument(path: string): string | null {
  if (!path.toLowerCase().endsWith('.json')) return null
  const top = path.includes('/') ? (path.split('/')[0] ?? '') : ''
  return DOCUMENT_FOLDERS[top] ?? null
}

// --- small pieces ----------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="inspector__section">
      <h3 className="inspector__section-title">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, value, testId }: { label: string; value: string; testId?: string }): ReactElement {
  return (
    <p className="inspector__field">
      <span className="inspector__label">{label}</span>
      <span className="inspector__value" data-testid={testId}>
        {value}
      </span>
    </p>
  )
}

function Note({ children, ...rest }: { children: ReactNode; 'data-testid'?: string }): ReactElement {
  return (
    <p className="inspector__note" {...rest}>
      {children}
    </p>
  )
}

function Empty({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="inspector" data-testid="inspector-panel">
      <p className="inspector__note" data-testid="inspector-note">
        {children}
      </p>
    </div>
  )
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}
