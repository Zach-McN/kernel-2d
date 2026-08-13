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

/**
 * Whether it is worth asking the service what document this file holds.
 *
 * Deliberately the weakest possible test, and deliberately not "is this a
 * scene?". What a file *is* is decided by the `format` it declares inside
 * itself (`editor-ui` U11), which means finding out requires reading it — and
 * this is only about which files are worth reading. A `.png` read as text and
 * handed to `JSON.parse` is a wasted round trip carrying a megabyte of binary
 * back as an error message; a `.json` anywhere in the project might be a scene,
 * including one outside `scenes/`, because the folder is a convention and the
 * document is a fact.
 */
export function couldBeDocument(name: string): boolean {
  return name.toLowerCase().endsWith('.json')
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

/** The folder a path sits in, or `''` for the top of the project. */
export function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

/**
 * Every folder in the project, deepest last, for a control that has to offer a
 * destination.
 *
 * The top of the project is `''` and is not in here — it is not a node in the
 * tree, and a caller that offers it has to word it ("the top of the project")
 * rather than show an empty option.
 */
export function folderPathsIn(tree: ProjectTree): string[] {
  const found: string[] = []

  const walk = (node: TreeNode): void => {
    if (node.kind !== 'directory') return
    // The root's own path is `.`, which is not a folder anybody moves into.
    if (node.path !== '.') found.push(node.path)
    for (const child of node.children) walk(child)
  }

  walk(tree.tree)
  return found
}
