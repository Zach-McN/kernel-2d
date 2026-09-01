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

/**
 * Every row on screen in the tree, top to bottom: a folder's children only
 * when it is open. What a Shift-click's range is measured over — the same
 * rows, in the same order, as the eye sees them, which is the whole reason it
 * cannot be "every file in the project".
 */
export function visibleTreeRows(children: readonly TreeNode[], expanded: ReadonlySet<string>): AssetRow[] {
  const rows: AssetRow[] = []
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const row of assetRowsFor(nodes)) {
      rows.push(row)
      if (row.node.kind === 'directory' && expanded.has(row.node.path)) walk(row.node.children)
    }
  }
  walk(children)
  return rows
}

/**
 * The files between two rows, inclusive, in the order given — the range a
 * Shift-click selects. Folders on the way are left out (a folder is always
 * selected alone), and either end that is a folder is a range of nothing.
 * Empty when either end is not in the list.
 */
export function fileRangeBetween(rows: readonly AssetRow[], from: string, to: string): string[] {
  const paths = rows.map((row) => row.node.path)
  const a = paths.indexOf(from)
  const b = paths.indexOf(to)
  if (a < 0 || b < 0) return []
  const [start, end] = a <= b ? [a, b] : [b, a]
  return rows
    .slice(start, end + 1)
    .filter((row) => row.node.kind === 'file')
    .map((row) => row.node.path)
}

/**
 * Every row anywhere in the project whose *name* says every word of the query
 * — what the Assets panel's search box lists.
 *
 * By name and not by path, deliberately: a search for `textures` that returned
 * every file under `assets/textures/` would be a search that found everything
 * and told you nothing, and the folder a match lives in is shown beside it
 * anyway. Case does not matter, and every space-separated word has to be in the
 * name, in any order, so `knight run` finds `knight-run-strip.png` and not the
 * idle frame. Folders match too — a folder is a thing you look for.
 *
 * Walks the same rows the tree and the grid show, so a `.meta` is folded into
 * its file here as everywhere else (searching `knight` finds the picture once,
 * with its settings badge, and never the sidecar), and a stranded `.meta` is
 * findable by its own name. Tree order — a folder's matches follow the folder —
 * so the list reads the way the project does.
 *
 * An empty or blank query matches nothing: "no search" is the panel's ordinary
 * view, not a list of every file in the project.
 */
export function searchRows(children: readonly TreeNode[], query: string): AssetRow[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0)
  if (words.length === 0) return []

  const found: AssetRow[] = []
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const row of assetRowsFor(nodes)) {
      const name = row.node.name.toLowerCase()
      if (words.every((word) => name.includes(word))) found.push(row)
      if (row.node.kind === 'directory') walk(row.node.children)
    }
  }
  walk(children)
  return found
}
