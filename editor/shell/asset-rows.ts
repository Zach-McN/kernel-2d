import { annotatedPathFor, isMetaFileName } from '../../runtime/formats/meta-schema'
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
  /**
   * When those folded-in settings were last written, or null when there are
   * none.
   *
   * Here rather than fetched, because it is what lets anything derived from a
   * file's settings know it is stale without asking: re-slice a sheet in the
   * Inspector and this number moves, and the tile's picture (`thumbnail.ts`)
   * changes with it. The row already knows the `.meta` exists; carrying its
   * timestamp as well costs nothing and saves a round trip per file.
   */
  settingsMtimeMs: number | null
  /** True when this row *is* a `.meta` whose file is gone. */
  isOrphanedSettings: boolean
}

export function assetRowsFor(children: readonly TreeNode[]): AssetRow[] {
  const byPath = new Map(children.map((child) => [child.path, child]))
  const rows: AssetRow[] = []

  for (const node of children) {
    if (node.kind === 'file' && isMetaFileName(node.name)) {
      const annotated = annotatedPathFor(node.path)
      if (annotated !== null && byPath.has(annotated)) continue
      rows.push({ node, hasSettings: false, settingsMtimeMs: null, isOrphanedSettings: true })
      continue
    }

    const settings = node.kind === 'file' ? byPath.get(`${node.path}.meta`) : undefined

    rows.push({
      node,
      hasSettings: settings !== undefined,
      settingsMtimeMs: settings?.kind === 'file' ? settings.mtimeMs : null,
      isOrphanedSettings: false,
    })
  }

  return rows
}
