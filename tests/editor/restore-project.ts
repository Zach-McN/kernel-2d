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
 * **Every file is snapshotted, bytes and all — not only the ones the editor
 * writes.** It used to be `.meta` files and documents, on the reasoning that
 * those are what the editor can *write*; but the editor can also *rename* any
 * file, and a test that renamed a picture through the file menu left the
 * project with `icon-life.png` where `icon-heart.png` had been. Nothing put it
 * back. Every play-mode test that runs later in file order then failed on the
 * missing heart, Playwright started a fresh worker after the first failure, the
 * worker re-evaluated the config and rebuilt the whole project under the dev
 * server, and the rebuild took Vite's watch on `src/` with it — which is how a
 * renamed icon became "the hot-replacement test is flaky" for a month
 * (`editor-verification` W26, V33). The project is small; reading all of it
 * twice a test is cheaper than diagnosing that again.
 */

export function restoreProjectAfterEach(): void {
  let snapshot = new Map<string, Buffer>()

  test.beforeEach(() => {
    snapshot = new Map(editableFiles().map((file) => [file, fs.readFileSync(file)]))
  })

  test.afterEach(() => {
    for (const [file, contents] of snapshot) {
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(contents)) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
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
      return [full]
    })
    .sort()
}
