import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Test project folders are built on disk rather than committed as fixture
 * files, because the ignore rules cover `node_modules`, `.git` and `dist` —
 * folders this repo's own .gitignore would strip out of a committed fixture,
 * silently gutting the tests that check them.
 */

export interface TempProject {
  /** Absolute, real path to the temporary project folder. */
  root: string
  /** Absolute path for a project-relative path. */
  file: (relativePath: string) => string
  cleanup: () => Promise<void>
}

/**
 * Creates a throwaway project folder. Keys are project-relative paths; a key
 * ending in `/` creates an empty folder, anything else creates a file with the
 * given contents.
 */
export async function makeTempProject(files: Readonly<Record<string, string>> = {}): Promise<TempProject> {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel2d-'))
  // The system temp folder is commonly reached through a link. Watchers and
  // path arithmetic report the real path, so normalise up front.
  const root = await fs.realpath(created)

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = path.join(root, relativePath)
    if (relativePath.endsWith('/')) {
      await fs.mkdir(absolute, { recursive: true })
      continue
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, contents)
  }

  return {
    root,
    file: (relativePath) => path.join(root, relativePath),
    cleanup: async () => {
      await fs.rm(created, { recursive: true, force: true })
    },
  }
}

/**
 * Polls until `probe` returns something, or fails the test with a useful
 * message. Used instead of fixed sleeps so watcher tests are neither flaky nor
 * artificially slow.
 */
export async function waitFor<T>(
  probe: () => T | undefined,
  description: string,
  timeoutMs = 4000,
  intervalMs = 10,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = probe()
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
