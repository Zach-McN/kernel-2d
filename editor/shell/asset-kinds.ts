import {
  annotatedPathFor,
  assetTypeForName,
  isMetaFileName,
  type AssetMeta,
  type AssetType,
} from '../../runtime/formats/meta-schema'
import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema'

/**
 * What a file is, and how to find it — the two questions every panel that shows
 * something about the selection has to answer.
 *
 * Shared rather than kept in a panel because there are now two of them: the
 * Inspector says what the selected file is, and the Viewport decides from the
 * same answer whether it has anything to draw. Two copies of this rule would
 * disagree the first time either changed, and the symptom would be a panel
 * calling a file a texture while its neighbour refuses to draw it.
 */

export const TYPE_NAMES: Readonly<Record<AssetType, string>> = {
  texture: 'Texture',
  audio: 'Audio',
  font: 'Font',
  other: 'Not something the editor imports',
}

/**
 * What kind of thing a file is, or null when the editor does not import it.
 *
 * The `.meta` wins over the extension whenever there is one: the sidecar is
 * authored and the name is a guess, so preferring the guess would make a
 * deliberate override invisible (`editor-ui` U11).
 */
export function assetTypeOf(name: string, settings: AssetMeta | null): AssetType | null {
  if (settings !== null) return settings.type
  return assetTypeForName(name)
}

/** How a file with no settings is described, by name alone. */
export function describeKind(name: string): string {
  if (isMetaFileName(name)) return `Import settings for ${basename(annotatedPathFor(name) ?? name)}`
  const type = assetTypeForName(name)
  return type === null ? 'File' : TYPE_NAMES[type]
}

export function findNode(tree: ProjectTree, path: string): TreeNode | null {
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

export function basename(path: string): string {
  return path.split('/').at(-1) ?? path
}
