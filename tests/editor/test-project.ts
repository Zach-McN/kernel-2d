import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The throwaway project the browser tests point the editor at.
 *
 * Built on disk at run time rather than committed, for the same reason as the
 * unit-test fixtures. It sits at a fixed location instead of a random temp
 * folder because the test harness and the assertions are in separate processes
 * and both need to name it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_FOLDER = path.join(HERE, '..', '.tmp', 'editor-project')

const CONTENTS: Readonly<Record<string, string>> = {
  'assets/textures/knight.png': 'pretend-png-bytes',
  'scenes/level-01.json': '{}',
}

/** Rebuilds the folder from scratch and returns its real, absolute path. */
export function buildEditorTestProject(): string {
  fs.rmSync(PROJECT_FOLDER, { recursive: true, force: true })

  for (const [relativePath, contents] of Object.entries(CONTENTS)) {
    const absolute = path.join(PROJECT_FOLDER, relativePath)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, contents)
  }

  // The temp folder is commonly reached through a link; the sidecar reports the
  // resolved path, so the assertions have to compare against that one.
  return fs.realpathSync(PROJECT_FOLDER)
}

/** The folder as the editor shows it: absolute, forward slashes. */
export function editorTestProjectDisplayPath(): string {
  return fs.realpathSync(PROJECT_FOLDER).replaceAll('\\', '/')
}

export const EDITOR_TEST_PROJECT_NAME = path.basename(PROJECT_FOLDER)
