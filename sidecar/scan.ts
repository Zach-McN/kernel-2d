import fs from 'node:fs/promises'
import path from 'node:path'

import { isIgnoredName } from './ignore.js'
import { relativePosixPath, toPosixPath } from './paths.js'
import {
  FILE_TREE_FORMAT,
  FILE_TREE_VERSION,
  type DirectoryNode,
  type ProjectTree,
  type TreeNode,
} from './tree-schema.js'

interface Counts {
  files: number
  directories: number
}

/**
 * Reads the project folder into the file-tree format.
 *
 * The scan happens per request rather than from a cached index, so the tree URL
 * can never serve a stale answer. It is also the same reader the startup banner
 * uses — one reader of the folder, not two that can disagree.
 */
export async function scanProject(projectPath: string): Promise<ProjectTree> {
  const counts: Counts = { files: 0, directories: 0 }
  const tree = await scanDirectory(projectPath, projectPath, counts)
  return {
    format: FILE_TREE_FORMAT,
    version: FILE_TREE_VERSION,
    projectPath: toPosixPath(projectPath),
    projectName: path.basename(projectPath),
    fileCount: counts.files,
    directoryCount: counts.directories,
    tree,
  }
}

async function scanDirectory(projectPath: string, directory: string, counts: Counts): Promise<DirectoryNode> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const children: TreeNode[] = []

  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue
    // Symlinks are never followed: a link could otherwise list files outside
    // the project folder, or loop forever.
    if (entry.isSymbolicLink()) continue

    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      counts.directories += 1
      children.push(await scanDirectory(projectPath, absolute, counts))
    } else if (entry.isFile()) {
      const stats = await fs.stat(absolute)
      counts.files += 1
      children.push({
        kind: 'file',
        name: entry.name,
        path: relativePosixPath(projectPath, absolute),
        ext: path.extname(entry.name).toLowerCase(),
        size: stats.size,
      })
    }
  }

  children.sort(compareNodes)

  const relative = relativePosixPath(projectPath, directory)
  return {
    kind: 'directory',
    name: path.basename(directory),
    path: relative === '' ? '.' : relative,
    children,
  }
}

/** Folders before files, alphabetical within each group — reads like a file explorer. */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, 'en')
}
