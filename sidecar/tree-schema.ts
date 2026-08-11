import { z } from 'zod'

/**
 * The file-tree format: what `GET /tree` returns.
 *
 * This schema is the single source of truth for the shape (editor-kernel D6).
 * Nothing else may declare or duplicate it — the TypeScript interfaces below
 * exist only because Zod cannot infer a recursive type on its own, and they are
 * held to the schema by the `z.ZodType<...>` annotations.
 */

export const FILE_TREE_FORMAT = 'kernel2d.file-tree'
export const FILE_TREE_VERSION = 1

export interface FileNode {
  kind: 'file'
  /** Base name including extension, e.g. `knight.png`. */
  name: string
  /** Project-relative, forward-slashed, e.g. `assets/textures/knight.png`. */
  path: string
  /** Lower-cased extension including the dot, e.g. `.png`. Empty when there is none. */
  ext: string
  /** Size on disk in bytes. */
  size: number
}

export interface DirectoryNode {
  kind: 'directory'
  name: string
  /** Project-relative, forward-slashed. The project root itself is `.`. */
  path: string
  /** Directories first, then files; alphabetical within each group. */
  children: TreeNode[]
}

export type TreeNode = FileNode | DirectoryNode

export interface ProjectTree {
  format: typeof FILE_TREE_FORMAT
  version: typeof FILE_TREE_VERSION
  /** Absolute path to the project folder, forward-slashed. */
  projectPath: string
  projectName: string
  fileCount: number
  /** Folders inside the project, not counting the project folder itself. */
  directoryCount: number
  tree: DirectoryNode
}

export const FileNodeSchema: z.ZodType<FileNode> = z.object({
  kind: z.literal('file'),
  name: z.string().min(1),
  path: z.string().min(1),
  ext: z.string(),
  size: z.number().int().nonnegative(),
})

export const DirectoryNodeSchema: z.ZodType<DirectoryNode> = z.object({
  kind: z.literal('directory'),
  name: z.string().min(1),
  path: z.string().min(1),
  children: z.lazy(() => z.array(TreeNodeSchema)),
})

export const TreeNodeSchema: z.ZodType<TreeNode> = z.union([FileNodeSchema, DirectoryNodeSchema])

export const ProjectTreeSchema: z.ZodType<ProjectTree> = z.object({
  format: z.literal(FILE_TREE_FORMAT),
  version: z.literal(FILE_TREE_VERSION),
  projectPath: z.string().min(1),
  projectName: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  directoryCount: z.number().int().nonnegative(),
  tree: DirectoryNodeSchema,
})
