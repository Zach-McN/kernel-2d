import { useState, type ReactElement } from 'react'

import { formatBytes } from '../../sidecar/bytes'
import type { TreeNode } from '../../sidecar/tree-schema'
import { useProjectTree } from '../shell/useProjectTree'

/**
 * The project folder, mirrored exactly.
 *
 * Everything on disk is shown, including the `.meta` sidecars — the folder is
 * the database, and a browser that quietly hides part of it is no longer a
 * mirror. Folding a sidecar into the row of the asset it belongs to is a job
 * for the feature that gives those files meaning.
 */
export function AssetsPanel(): ReactElement {
  const project = useProjectTree()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)

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
        {project.tree.tree.children.map((node) => (
          <AssetNode
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            selected={selected}
            onToggle={toggle}
            onSelect={setSelected}
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
  node: TreeNode
  depth: number
  expanded: ReadonlySet<string>
  selected: string | null
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}

function AssetNode({ node, depth, expanded, selected, onToggle, onSelect }: AssetNodeProps): ReactElement {
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
        onClick={() => (isFolder ? onToggle(node.path) : onSelect(node.path))}
      >
        <span className="asset-row__chevron" aria-hidden="true">
          {isFolder ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="asset-row__name">{node.name}</span>
        {!isFolder && <span className="asset-row__size">{formatBytes(node.size)}</span>}
      </button>

      {isFolder && isOpen && (
        <ul className="assets__tree" role="group">
          {node.children.map((child) => (
            <AssetNode
              key={child.path}
              node={child}
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
