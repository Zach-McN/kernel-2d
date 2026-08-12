import { annotatedPathFor, isMetaFileName } from '../../sidecar/meta-schema'
import type { TreeNode } from '../../sidecar/tree-schema'

/**
 * What a folder shows: one row per thing worth showing.
 *
 * Every file on disk is represented, but a `.meta` appears *attached to the
 * file it annotates* rather than as a row of its own — the sidecar is that
 * asset's import settings, and listing the two separately doubles the length of
 * every folder while saying nothing the asset's own row does not.
 *
 * A `.meta` with no file beside it does get its own row, marked. That is the
 * same rule rather than an exception to it: with nothing to attach to, the only
 * honest place to show it is on its own — and a stranded one is exactly the
 * thing a human needs to be able to find.
 *
 * Shared rather than living in the panel, because the Inspector counts what a
 * folder holds and has to count it the same way the panel lists it. Two rules
 * would disagree the first time either changed.
 */

export interface AssetRow {
  node: TreeNode
  /** True when this file has a `.meta` beside it, folded into this row. */
  hasSettings: boolean
  /** True when this row *is* a `.meta` whose file is gone. */
  isOrphanedSettings: boolean
}

export function assetRowsFor(children: readonly TreeNode[]): AssetRow[] {
  const present = new Set(children.map((child) => child.path))
  const rows: AssetRow[] = []

  for (const node of children) {
    if (node.kind === 'file' && isMetaFileName(node.name)) {
      const annotated = annotatedPathFor(node.path)
      if (annotated !== null && present.has(annotated)) continue
      rows.push({ node, hasSettings: false, isOrphanedSettings: true })
      continue
    }

    rows.push({
      node,
      hasSettings: node.kind === 'file' && present.has(`${node.path}.meta`),
      isOrphanedSettings: false,
    })
  }

  return rows
}
