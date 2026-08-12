import { z } from 'zod'

/**
 * The record of what an export wrote, kept in the folder it wrote.
 *
 * This is what makes exporting twice safe, and the discipline is the same question
 * the filesystem service's write privilege keeps being asked (`editor-kernel`
 * D17/D22): not "is this operation safe?" but "what does it do if the caller is
 * confused about what is in that folder?"
 *
 * Three rules follow from it, and they are the whole of the answer:
 *
 *   - A folder with one of these in it may be replaced, file by file, and anything
 *     it lists that the game no longer needs is deleted — so a level that loses a
 *     texture does not leave the old one behind, and exporting twice gives the same
 *     folder rather than an accumulating one.
 *   - A folder holding a file this does *not* list is refused. That is the guard
 *     that stands between the command and a folder somebody keeps something else in.
 *   - A folder with anything in it and no manifest is refused outright.
 *
 * It lives with the export command rather than in `runtime/`, because nothing in a
 * shipped game reads it: it is a record of a build, addressed to the next build and
 * to whoever opens the folder wondering where it came from. It is served alongside
 * the game and is harmless there.
 *
 * `generatedAt` is a date rather than a timestamp, and the command takes `--date` so
 * a test can pin it — the same arrangement as the sample generator, for the same
 * reason (`editor-kernel` G4): output that changes on every run churns the folder
 * and hides real changes in the noise.
 */

export const EXPORT_MANIFEST_FORMAT = 'kernel2d.export'
export const EXPORT_MANIFEST_VERSION = 1

/** The file the manifest lives in, at the root of an export. */
export const EXPORT_MANIFEST_FILE = 'kernel2d-export.json'

export interface ExportManifest {
  format: typeof EXPORT_MANIFEST_FORMAT
  version: typeof EXPORT_MANIFEST_VERSION
  generatedBy: string
  /** `YYYY-MM-DD`. */
  generatedAt: string
  /** The level this game starts on, project-relative — the same path it has in the project. */
  startupScene: string
  /**
   * Every file this export wrote, relative to the folder, forward-slashed and
   * sorted. Includes the page and the game, and does not include this manifest.
   */
  files: string[]
}

export const ExportManifestSchema: z.ZodType<ExportManifest> = z.object({
  format: z.literal(EXPORT_MANIFEST_FORMAT),
  version: z.literal(EXPORT_MANIFEST_VERSION),
  generatedBy: z.string().min(1),
  generatedAt: z.string().min(1),
  startupScene: z.string().min(1),
  files: z.array(z.string().min(1)),
})

/** Written with two spaces and a trailing newline, like every other document here. */
export function serializeExportManifest(manifest: ExportManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
