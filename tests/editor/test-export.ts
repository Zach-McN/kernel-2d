import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { editorTestProjectPath } from './test-project.js'

/**
 * The exported game the browser tests open.
 *
 * Built by running **the real command**, as a process, for the same reason the browser
 * suite starts the editor with the one command a human uses (`editor-verification`
 * V8): the command is then itself under test on every browser run. If `npm run export`
 * breaks — a refusal that should not fire, a bundle that will not build, an editor
 * marker sneaking into the output — the browser suite goes red rather than passing
 * against a folder assembled some other way.
 *
 * Run synchronously so the Playwright config can call it while deciding what to start.
 * The static server it hands the folder to would refuse to point at a folder that is
 * not there yet, and Playwright starts its servers before anything else.
 *
 * The date is pinned, so re-running never rewrites the manifest just because the day
 * moved on — the same arrangement the sample generator has, for the same reason.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const EXPORT_FOLDER = path.join(HERE, '..', '.tmp', 'exported-game')

/** Fixed, like the sample project's, so two runs produce identical bytes. */
const GENERATED_AT = '2026-08-11'

/** Rebuilds the folder from scratch by running the export, and returns its real path. */
export function buildEditorTestExport(): string {
  // From scratch rather than re-exported: exporting into a folder a previous run left
  // is a promise with its own test (`tests/scripts/export.test.ts`), and it is not this
  // harness's job to be the one exercising it.
  fs.rmSync(EXPORT_FOLDER, { recursive: true, force: true })

  try {
    execFileSync(
      'npm',
      [
        'run',
        '--silent',
        'export',
        '--',
        editorTestProjectPath(),
        '--out',
        EXPORT_FOLDER,
        '--date',
        GENERATED_AT,
      ],
      { cwd: REPO_ROOT, stdio: 'pipe', shell: true },
    )
  } catch (error) {
    // The command's own sentences are the useful part, and `execFileSync` puts them
    // where nobody looks. Surfaced here, because a failure at this point stops the
    // whole browser suite and "Command failed" would explain none of it.
    const output = error as { stdout?: Buffer; stderr?: Buffer }
    throw new Error(
      [
        'Could not build the exported game the browser tests open.',
        output.stdout?.toString() ?? '',
        output.stderr?.toString() ?? '',
      ].join('\n'),
    )
  }

  return fs.realpathSync(EXPORT_FOLDER)
}

/** The folder, for tests that read what is in it. */
export function editorTestExportPath(): string {
  return fs.realpathSync(EXPORT_FOLDER)
}
