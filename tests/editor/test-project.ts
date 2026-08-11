import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeSampleProject } from '../../scripts/sample/write.js'

/**
 * The throwaway project the browser tests point the editor at.
 *
 * It is the real sample project, written by the real generator — so the
 * generator is exercised on every browser run, and the panel is tested against
 * the same folder the human will be looking at rather than a thinner stand-in.
 *
 * Built at run time rather than committed, and at a fixed location rather than
 * a random temp folder, because the harness and the assertions live in separate
 * processes and both have to name it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_FOLDER = path.join(HERE, '..', '.tmp', 'editor-project')

/** Fixed so re-running never rewrites a file just because the date moved on. */
const GENERATED_AT = '2026-08-11'

/** Rebuilds the folder from scratch and returns its real, absolute path. */
export function buildEditorTestProject(): string {
  fs.rmSync(PROJECT_FOLDER, { recursive: true, force: true })
  fs.mkdirSync(PROJECT_FOLDER, { recursive: true })
  writeSampleProject(PROJECT_FOLDER, { generatedAt: GENERATED_AT })

  // The temp folder is commonly reached through a link; the sidecar reports the
  // resolved path, so the assertions have to compare against that one.
  return fs.realpathSync(PROJECT_FOLDER)
}

/** The absolute path, for tests that write into the folder to see what happens. */
export function editorTestProjectPath(): string {
  return fs.realpathSync(PROJECT_FOLDER)
}

/** The folder as the editor shows it: absolute, forward slashes. */
export function editorTestProjectDisplayPath(): string {
  return editorTestProjectPath().replaceAll('\\', '/')
}

export const EDITOR_TEST_PROJECT_NAME = path.basename(PROJECT_FOLDER)
