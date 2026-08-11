import path from 'node:path'

/**
 * Every path the sidecar puts into JSON or prints uses forward slashes,
 * on Windows as well. Consumers (the editor, tests, the human reading the
 * tree URL) never have to care which OS wrote the file.
 */
export function toPosixPath(p: string): string {
  return p.split(path.sep).join('/')
}

/** Project-relative, forward-slashed path for an absolute path inside the project. */
export function relativePosixPath(projectPath: string, absolutePath: string): string {
  return toPosixPath(path.relative(projectPath, absolutePath))
}
