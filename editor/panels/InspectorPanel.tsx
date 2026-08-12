import type { ReactElement, ReactNode } from 'react'

import { formatBytes } from '../../sidecar/bytes'
import {
  annotatedPathFor,
  assetTypeForName,
  isMetaFileName,
  type AssetMeta,
  type AssetType,
  type ImportSettings,
} from '../../sidecar/meta-schema'
import type { MetaView } from '../../sidecar/meta-view-schema'
import type { DirectoryNode, ProjectTree, TreeNode } from '../../sidecar/tree-schema'
import { assetRowsFor } from '../shell/asset-rows'
import { useProject } from '../shell/project-context'
import { useSelection } from '../shell/selection'
import { useAssetMeta } from '../shell/useAssetMeta'

/**
 * What the selected thing holds.
 *
 * The rule this panel keeps is that it always says something. A blank
 * inspector is indistinguishable from a broken one, and the cases where there
 * is no `.meta` to show — a scene file, a folder, a README, a texture whose
 * sidecar has not landed yet — are ordinary rather than exceptional. Each gets
 * a sentence naming what it is and why there is nothing to tune.
 *
 * Read-only this session: everything here is shown, nothing is editable. The
 * write path arrives with the transaction API, which is where every mutation
 * has to go (editor-kernel D7).
 */
export function InspectorPanel(): ReactElement {
  const project = useProject()
  const selection = useSelection()
  const tree = project.state === 'ready' ? project.tree : null
  const meta = useAssetMeta(selection.path, tree)

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
  meta: ReturnType<typeof useAssetMeta>
}

function FileBody({ node, meta }: FileBodyProps): ReactElement {
  const view = meta.state === 'ready' ? meta.view : null
  // What the file says it is beats what its name suggests, on the same grounds
  // as anywhere else: the `.meta` is authored, the extension is a guess.
  const settings = view !== null && view.status === 'ok' ? view.meta : null

  return (
    <>
      <Section title="File">
        <Field label="Size" value={formatBytes(node.size)} />
        <Field
          label="Type"
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
      {view !== null && <MetaBody node={node} view={view} />}
    </>
  )
}

function MetaBody({ node, view }: { node: TreeNode; view: MetaView }): ReactElement {
  if (view.status === 'ok' && view.meta !== null) {
    return <Settings meta={view.meta} metaPath={view.metaPath} />
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

function Settings({ meta, metaPath }: { meta: AssetMeta; metaPath: string | null }): ReactElement {
  return (
    <>
      <Section title="Import settings">
        <SettingFields settings={meta.importSettings} />
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
        <Note>Read-only for now — editing arrives with undo, so that it can be undone.</Note>
      </Section>
    </>
  )
}

function SettingFields({ settings }: { settings: ImportSettings }): ReactElement {
  if (settings.type !== 'texture') {
    return <Note data-testid="inspector-note">Nothing to tune on import for this kind of file yet.</Note>
  }

  return (
    <>
      <Field
        label="Filtering"
        value={settings.filter === 'nearest' ? 'Nearest — crisp pixels' : 'Linear — smoothed'}
        testId="inspector-filter"
      />
      <Field
        label="Pivot"
        value={`${describeNumber(settings.pivot.x)}, ${describeNumber(settings.pivot.y)}`}
        testId="inspector-pivot"
      />
      <Field
        label="Frames"
        value={
          settings.slice.mode === 'single'
            ? 'One frame — the whole image'
            : `${settings.slice.frameWidth} × ${settings.slice.frameHeight} grid`
        }
        testId="inspector-slice"
      />
      {settings.slice.mode === 'grid' && (settings.slice.margin > 0 || settings.slice.spacing > 0) && (
        <Field
          label="Grid gaps"
          value={`${settings.slice.margin}px margin, ${settings.slice.spacing}px spacing`}
        />
      )}
    </>
  )
}

// --- saying what a file is -------------------------------------------------

const TYPE_NAMES: Record<AssetType, string> = {
  texture: 'Texture',
  audio: 'Audio',
  font: 'Font',
  other: 'Not something the editor imports',
}

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

function describeKind(name: string): string {
  if (isMetaFileName(name)) return `Import settings for ${basename(annotatedPathFor(name) ?? name)}`
  const type = assetTypeForName(name)
  return type === null ? 'File' : TYPE_NAMES[type]
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

/** `0.5` rather than `0.50000001`, and `1` rather than `1.0`. */
function describeNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path
}

function findNode(tree: ProjectTree, path: string): TreeNode | null {
  const walk = (node: TreeNode): TreeNode | null => {
    if (node.path === path) return node
    if (node.kind !== 'directory') return null
    for (const child of node.children) {
      const found = walk(child)
      if (found !== null) return found
    }
    return null
  }

  return walk(tree.tree)
}
