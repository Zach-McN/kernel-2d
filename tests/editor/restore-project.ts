import fs from 'node:fs'
import path from 'node:path'

import { test } from '@playwright/test'

import { editorTestProjectPath } from './test-project.js'

/**
 * Putting the shared project folder back after a test has changed it.
 *
 * The browser suite builds one sample project per run and runs single-worker in
 * file order (editor-verification V14), so a test that leaves a changed file
 * behind makes a *later* test's outcome depend on which files happen to run
 * first — the worst kind of flake, because it gets diagnosed as a product bug in
 * whichever test drew the short straw.
 *
 * Everything the editor can write is snapshotted, not just the files a test says
 * it will touch: a test that writes somewhere unexpected is exactly the one that
 * would forget to declare it. That is now `.meta` files *and* documents, since
 * the editor can rewrite a scene.
 */

const EDITABLE = ['.meta', '.json']

export function restoreProjectAfterEach(): void {
  let snapshot = new Map<string, string>()

  test.beforeEach(() => {
    snapshot = new Map(editableFiles().map((file) => [file, fs.readFileSync(file, 'utf8')]))
  })

  test.afterEach(() => {
    for (const [file, contents] of snapshot) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) {
        fs.writeFileSync(file, contents)
      }
    }
    for (const file of editableFiles()) {
      if (!snapshot.has(file)) fs.rmSync(file, { force: true })
    }
  })
}

export function editableFiles(root = editorTestProjectPath()): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) return editableFiles(full)
      return EDITABLE.some((suffix) => entry.name.endsWith(suffix)) ? [full] : []
    })
    .sort()
}
