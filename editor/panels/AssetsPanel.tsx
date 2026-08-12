import { useState, type ReactElement } from 'react'

import { defaultScene } from '../../runtime/formats/scene-schema'
import { formatBytes } from '../../sidecar/bytes'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { findNode } from '../shell/asset-kinds'
import { assetRowsFor, type AssetRow } from '../shell/asset-rows'
import { useProject } from '../shell/project-context'
import { useSelection } from '../shell/selection'
import { createDocumentOnDisk } from '../store/document-disk'

/**
 * The project folder, mirrored. Selecting anything here is what the Inspector
 * answers about.
 *
 * Which rows a folder has — and why a `.meta` is folded into the row of the
 * file it annotates — is decided in `asset-rows.ts`, because the Inspector has
 * to count a folder's contents the same way this lists them.
 *
 * It is also the one panel that makes a file, which is why the row above the
 * tree shows the whole path it is about to create. Where a level goes is the
 * human's decision, taken from what they have selected — no folder name is
 * written into the code, because `scenes/` is a convention in the folder map and
 * not a fact this editor is allowed to rely on.
 */
export function AssetsPanel(): ReactElement {
  const project = useProject()
  const selection = useSelection()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const toggle = (path: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  const reveal = (path: string): void => {
    // Every folder on the way, so a file made inside a shut folder is not made
    // somewhere the human cannot see it.
    const parts = path.split('/').slice(0, -1)
    setExpanded((previous) => {
      const next = new Set(previous)
      let at = ''
      for (const part of parts) {
        at = at === '' ? part : `${at}/${part}`
        next.add(at)
      }
      return next
    })
    selection.selectFile(path)
  }

  if (project.state === 'loading') {
    return <p className="assets__message">Reading the project folder…</p>
  }

  if (project.state === 'unavailable') {
    return (
      <p className="assets__message assets__message--bad" data-testid="assets-unavailable">
        {project.reason} Is the editor command still running?
      </p>
    )
  }

  return (
    <div className="assets" data-testid="assets-panel" data-live={project.live}>
      {!project.live && (
        <p className="assets__stale" data-testid="assets-stale">
          Not hearing about changes — this may be out of date.
        </p>
      )}

      <NewScene folder={folderFor(selection.selectedFilePath, project.tree)} onCreated={reveal} />

      <ul className="assets__tree" role="tree" aria-label="Project folder">
        {assetRowsFor(project.tree.tree.children).map((row) => (
          <AssetNode
            key={row.node.path}
            row={row}
            depth={0}
            expanded={expanded}
            selected={selection.selectedFilePath}
            onToggle={toggle}
            onSelect={selection.selectFile}
          />
        ))}
      </ul>

      {project.tree.tree.children.length === 0 && (
        <p className="assets__message">This project folder is empty.</p>
      )}
    </div>
  )
}

// --- making a level --------------------------------------------------------

/**
 * Which folder a new file goes in: the selected folder, the selected file's
 * folder, or the top of the project.
 *
 * Read from the tree rather than guessed from the path, because whether
 * `scenes` is a folder or a file called `scenes` is a fact about the project and
 * not about the string.
 */
function folderFor(selectedPath: string | null, tree: ProjectTree): string {
  if (selectedPath === null) return ''

  const node = findNode(tree, selectedPath)
  if (node === null) return ''
  if (node.kind === 'directory') return node.path

  return node.path.split('/').slice(0, -1).join('/')
}

/**
 * Making a level.
 *
 * The whole path is on screen before anything is committed, because this is the
 * one control in the editor that puts a file in somebody's project folder and
 * "where did it go?" is not a question a human should have to answer by
 * searching. Refusals are the service's own sentences, shown as they arrive —
 * it knows things this panel does not, like whether the name is already taken.
 */
function NewScene({ folder, onCreated }: { folder: string; onCreated: (path: string) => void }): ReactElement {
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const typed = name.trim()
  // `.json` is added rather than demanded, and left alone when it is already
  // there, so nobody ends up with `level-03.json.json`.
  const file = typed === '' ? '' : typed.endsWith('.json') ? typed : `${typed}.json`
  const path = file === '' ? '' : folder === '' ? file : `${folder}/${file}`

  const create = (): void => {
    if (path === '' || busy) return

    setBusy(true)
    setProblem(null)

    void createDocumentOnDisk(path, defaultScene())
      .then(() => {
        setName('')
        // Selecting it is what opens it: a file becomes the open scene because
        // of the format inside it, which the shell reads when it is selected.
        onCreated(path)
      })
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <form
      className="assets__new"
      data-testid="new-scene"
      onSubmit={(event) => {
        event.preventDefault()
        create()
      }}
    >
      <div className="assets__new-row">
        <input
          type="text"
          className="control control--text"
          data-testid="new-scene-name"
          placeholder="New level"
          aria-label="Name for a new level"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setProblem(null)
          }}
        />
        <button
          type="submit"
          className="control control--action"
          data-testid="new-scene-create"
          disabled={path === '' || busy}
        >
          New scene
        </button>
      </div>

      {path !== '' && (
        <p className="assets__new-path" data-testid="new-scene-path">
          Will make <strong>{path}</strong>
        </p>
      )}

      {problem !== null && (
        <p className="assets__new-problem" data-testid="new-scene-problem">
          {problem}
        </p>
      )}
    </form>
  )
}

interface AssetNodeProps {
  row: AssetRow
  depth: number
  expanded: ReadonlySet<string>
  selected: string | null
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}

function AssetNode({ row, depth, expanded, selected, onToggle, onSelect }: AssetNodeProps): ReactElement {
  const { node } = row
  const isFolder = node.kind === 'directory'
  const isOpen = isFolder && expanded.has(node.path)

  return (
    <li className="asset-row" role="treeitem" aria-expanded={isFolder ? isOpen : undefined}>
      <button
        type="button"
        className="asset-row__button"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        data-asset-path={node.path}
        data-kind={node.kind}
        data-selected={selected === node.path}
        data-has-settings={row.hasSettings}
        data-orphaned-settings={row.isOrphanedSettings}
        onClick={() => {
          onSelect(node.path)
          if (isFolder) onToggle(node.path)
        }}
      >
        <span className="asset-row__chevron" aria-hidden="true">
          {isFolder ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="asset-row__name">{node.name}</span>
        {row.hasSettings && (
          <span className="asset-row__badge" title="Has import settings beside it">
            meta
          </span>
        )}
        {row.isOrphanedSettings && (
          <span className="asset-row__badge asset-row__badge--orphan" title="Import settings with no file beside them">
            orphaned
          </span>
        )}
        {!isFolder && <span className="asset-row__size">{formatBytes(node.size)}</span>}
      </button>

      {isFolder && isOpen && (
        <ul className="assets__tree" role="group">
          {assetRowsFor(node.children).map((child) => (
            <AssetNode
              key={child.node.path}
              row={child}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
