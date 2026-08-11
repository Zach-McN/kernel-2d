import path from 'node:path'

/**
 * Names the sidecar never lists and never watches, matched on the base name at
 * any depth. Tooling folders and OS junk only — never anything the human might
 * have authored.
 */
export const IGNORED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  '.thumbs',
  'Thumbs.db',
  '.DS_Store',
])

export function isIgnoredName(name: string): boolean {
  return IGNORED_NAMES.has(name)
}

/**
 * Whether an absolute path should be skipped. The project folder itself is
 * never ignored, even if it happens to be named something on the list.
 */
export function isIgnoredPath(projectPath: string, absolutePath: string): boolean {
  if (path.resolve(absolutePath) === path.resolve(projectPath)) return false
  const relative = path.relative(projectPath, absolutePath)
  if (relative === '') return false
  return relative.split(path.sep).some(isIgnoredName)
}
