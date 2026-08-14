import fs from 'node:fs/promises'

/**
 * Two filesystem questions the service asks in more than one place, answered
 * once. Both had grown byte-identical copies in `meta-files.ts` and
 * `file-operations.ts` before a gardening pass folded them together.
 */

export async function exists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath)
    return true
  } catch {
    return false
  }
}

export async function remove(absolutePath: string): Promise<void> {
  try {
    await fs.unlink(absolutePath)
  } catch (error) {
    // Already gone is the outcome that was wanted.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
