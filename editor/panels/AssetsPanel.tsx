import { useState, type ReactElement } from 'react'

import { formatBytes } from '../../sidecar/bytes'
import { assetRowsFor, type AssetRow } from '../shell/asset-rows'
import { useProject } from '../shell/project-context'
import { useSelection } from '../shell/selection'

/**
 * The project folder, mirrored. Selecting anything here is what the Inspector
 * answers about.
 *
 * Which rows a folder has — and why a `.meta` is folded into the row of the
 * file it annotates — is decided in `asset-rows.ts`, because the Inspector has
 * to count a folder's contents the same way this lists them.
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

      <ul className="assets__tree" role="tree" aria-label="Project folder">
        {assetRowsFor(project.tree.tree.children).map((row) => (
          <AssetNode
            key={row.node.path}
            row={row}
            depth={0}
            expanded={expanded}
            selected={selection.path}
            onToggle={toggle}
            onSelect={selection.select}
          />
        ))}
      </ul>

      {project.tree.tree.children.length === 0 && (
        <p className="assets__message">This project folder is empty.</p>
      )}
    </div>
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
