import type { ReactElement, ReactNode } from 'react'

import {
  assetTypeForName,
  isMetaFileName,
  type AssetMeta,
  type ImportSettings,
} from '../../runtime/formats/meta-schema'
import { PREFAB_FORMAT } from '../../runtime/formats/prefab-schema'
import { PROJECT_FORMAT } from '../../runtime/formats/project-schema'
import { prefabRefOf } from '../../runtime/formats/scene-schema'
import { formatBytes } from '../../sidecar/bytes'
import type { MetaView } from '../../sidecar/meta-view-schema'
import type { DirectoryNode, TreeNode } from '../../sidecar/tree-schema'
import { TYPE_NAMES, basename, couldBeDocument, describeKind, findNode } from '../shell/asset-kinds'
import { useSelectedAssetMeta } from '../shell/asset-meta-context'
import { assetRowsFor } from '../shell/asset-rows'
import { useDocumentAnswer, useOpenScene } from '../shell/open-scene'
import { useProject } from '../shell/project-context'
import { useSceneAssets } from '../shell/scene-assets'
import { useResolvedScene } from '../shell/scene-prefabs'
import { useSelection } from '../shell/selection'
import type { AssetMetaState } from '../shell/useAssetMeta'
import {
  useMetaDocument,
  usePrefabDocument,
  useProjectDocument,
  useSaveFailure,
} from '../store/open-documents'
import { EntityInspector } from './EntityInspector'
import { Field, Note, Section } from './fields'
import { PrefabInspector } from './PrefabInspector'
import { ProjectInspector } from './ProjectInspector'
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
  const selection = useSelection()

  // One panel, two kinds of thing to describe. Branching on the selection union
  // rather than on a pair of nullable fields is what makes "an entity in a
  // scene that is not open" an unwritable state rather than one to guard for.
  if (selection.selected.kind === 'entity') {
    return <EntityBody scene={selection.selected.scene} entity={selection.selected.entity} />
  }

  if (selection.selected.kind === 'none') {
    return <Empty>Select a file or folder in the Assets panel to see what it holds.</Empty>
  }

  return <FileInspector path={selection.selected.path} />
}

// --- an entity -------------------------------------------------------------

function EntityBody({ scene, entity }: { scene: string; entity: string }): ReactElement {
  const open = useOpenScene()
  const project = useProject()
  const assets = useSceneAssets()
  const resolved = useResolvedScene()

  if (open.state !== 'open' || open.path !== scene) {
    return (
      <Empty>
        That entity is in <strong>{basename(scene)}</strong>, which is not open.
      </Empty>
    )
  }

  const found = open.scene.entities.find((candidate) => candidate.id === entity)

  if (found === undefined) {
    return <Empty>That entity is no longer in {basename(scene)}.</Empty>
  }

  // The file's entity is what gets edited; the resolved one is what it draws.
  // Falling back to the file's own is the gap of one render before the prefabs
  // it points at have been read.
  const drawn = resolved.entities.find((candidate) => candidate.id === entity) ?? found
  const source = prefabRefOf(found)

  return (
    <div className="inspector" data-testid="inspector-panel" data-inspecting-entity={found.id}>
      <header className="inspector__header">
        <h2 className="inspector__name" data-testid="inspector-name">
          {found.name}
        </h2>
        <p className="inspector__path" data-testid="inspector-path">
          {scene}
        </p>
      </header>

      <EntityInspector
        scenePath={scene}
        scene={open.scene}
        entity={found}
        resolved={drawn}
        tree={project.state === 'ready' ? project.tree : null}
        assets={assets}
        prefabProblem={source === null ? undefined : resolved.problems[source.path]}
      />
    </div>
  )
}

// --- a file or a folder ----------------------------------------------------

function FileInspector({ path }: { path: string }): ReactElement {
  const project = useProject()
  const tree = project.state === 'ready' ? project.tree : null
  // Read from the window rather than fetched here: the Texture tab needs the
  // same answer, and two panels each asking would be two answers on two timers
  // (`editor-ui` U9).
  const meta = useSelectedAssetMeta()

  const node = tree === null ? null : findNode(tree, path)

  if (node === null) {
    return (
      <Empty>
        <strong>{basename(path)}</strong> is no longer in the project folder.
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
  const document = useMetaDocument(node.path)
  const settings: AssetMeta | null = document ?? (view !== null && view.status === 'ok' ? view.meta : null)

  // A file the editor might open as a document is a different kind of thing
  // from a file it imports as an asset: it has no `.meta`, will never have one,
  // and what it holds is inside it rather than beside it.
  const isDocument = couldBeDocument(node.name)

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

      {isDocument ? (
        <DocumentBody path={node.path} />
      ) : (
        <>
          {meta.state === 'loading' && <Note>Reading its import settings…</Note>}
          {meta.state === 'unavailable' && (
            <Note data-testid="inspector-note">
              Could not ask the editor service about this file. Is the editor command still running?
            </Note>
          )}
          {view !== null && <MetaBody node={node} view={view} document={document} />}
        </>
      )}
    </>
  )
}

/**
 * What a document holds, for a file the editor opens rather than imports.
 *
 * Three formats have a body of their own now, each reached by what the document
 * says it is. The scene's is the fall-through and is deliberately short: a scene's
 * properties *are* its entities, and those are the Hierarchy's to list and the
 * entity inspector's to tune. Repeating them here would be a second place to read
 * the same thing.
 */
function DocumentBody({ path }: { path: string }): ReactElement {
  const answer = useDocumentAnswer(path)
  const open = useOpenScene()

  if (answer.state === 'loading') {
    return (
      <Section title="Document">
        <Note>Reading it…</Note>
      </Section>
    )
  }

  if (answer.state === 'unavailable') {
    return (
      <Section title="Document">
        <Note data-testid="inspector-note">
          Could not ask the editor service about this file. Is the editor command still running?
        </Note>
      </Section>
    )
  }

  if (answer.view.status === 'unreadable') {
    return (
      <Section title="Document">
        <Note data-testid="inspector-note">
          {answer.view.problem} It has been left exactly as it is on disk — nothing here rewrites a file it
          cannot read.
        </Note>
        {answer.view.text !== null && <pre className="inspector__raw">{answer.view.text}</pre>}
      </Section>
    )
  }

  if (answer.view.status === 'none') {
    return (
      <Section title="Document">
        <Note data-testid="inspector-note">There is nothing at that path any more.</Note>
      </Section>
    )
  }

  // Which body a document gets is decided by the `format` it carries, never by
  // where it sits or what it is called (`editor-ui` U11) — so a project's settings
  // are recognised wherever somebody keeps them.
  if (answer.view.document?.format === PREFAB_FORMAT) return <PrefabBody path={path} />
  if (answer.view.document?.format === PROJECT_FORMAT) return <ProjectBody path={path} />

  const scene = open.state === 'open' && open.path === path ? open.scene : null

  return (
    <Section title="Document">
      <Field label="Format" value="Scene" testId="inspector-document-format" />
      {scene !== null && (
        <Field
          label="Holds"
          value={`${scene.entities.length} ${scene.entities.length === 1 ? 'entity' : 'entities'}`}
          testId="inspector-entity-count"
        />
      )}
      <Note data-testid="inspector-note">
        It is open in the Viewport. Select an entity in the Hierarchy to tune it.
      </Note>
    </Section>
  )
}

/**
 * A prefab, with controls.
 *
 * Rendered from the **document store** rather than from the answer the service
 * gave, on the same grounds as a texture's import settings: the transaction API
 * can only change a document the store is holding, so a control built over the
 * served copy would look entirely correct and do nothing (`editor-ui` U12). The
 * served answer above is still what decides that this file is a prefab at all.
 */
function PrefabBody({ path }: { path: string }): ReactElement {
  const project = useProject()
  const prefab = usePrefabDocument(path)

  if (prefab === null) {
    return (
      <Section title="Document">
        <Field label="Format" value="Prefab" testId="inspector-document-format" />
        <Note>Reading it…</Note>
      </Section>
    )
  }

  return (
    <>
      <Section title="Document">
        <Field label="Format" value="Prefab" testId="inspector-document-format" />
      </Section>
      <PrefabInspector path={path} prefab={prefab} tree={project.state === 'ready' ? project.tree : null} />
    </>
  )
}

/**
 * The project's own settings, with controls.
 *
 * From the store rather than from the served answer, on the same grounds as a
 * prefab and a texture's import settings (`editor-ui` U12). The served answer above
 * is still what decides this file is project settings at all.
 */
function ProjectBody({ path }: { path: string }): ReactElement {
  const project = useProject()
  const settings = useProjectDocument(path)
  const saveFailure = useSaveFailure(path)

  if (settings === null) {
    return (
      <Section title="Document">
        <Field label="Format" value="Project settings" testId="inspector-document-format" />
        <Note>Reading it…</Note>
      </Section>
    )
  }

  return (
    <>
      <Section title="Document">
        <Field label="Format" value="Project settings" testId="inspector-document-format" />
        {saveFailure !== null && <SaveFailure reason={saveFailure} />}
      </Section>
      <ProjectInspector
        path={path}
        project={settings}
        tree={project.state === 'ready' ? project.tree : null}
      />
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
 * Why a file has no import settings.
 *
 * `.json` files never reach here — a file the editor might open as a document
 * is described by what is inside it rather than by what is missing beside it,
 * which is `DocumentBody`'s job.
 */
function describeMissingMeta(path: string): string {
  const name = basename(path)

  if (isMetaFileName(name)) {
    return 'This is an import-settings file, and the file it describes is not beside it. It will be cleared out the next time the editor starts.'
  }

  if (assetTypeForName(name) !== null) {
    return 'No import settings yet. One is written within a second of the file appearing — if this stays, check the editor command is still running.'
  }

  return 'The editor does not import this kind of file, so it has no settings.'
}

// --- small pieces ----------------------------------------------------------

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
