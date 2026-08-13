import { z } from 'zod'

/**
 * What `POST /move` and `POST /delete` answer with: one sentence-worth of fact
 * about what happened to one file.
 *
 * A format that is only ever served and never stored still gets a schema
 * (text-formats T4) — the consumer is a separate process, so this is a contract
 * across a boundary whether or not it lands on disk.
 *
 * It is the answer to *what did you do*, not a view of anything. There is no
 * `status` and no `problem` field, and that is deliberate: unlike a read, these
 * requests have exactly two outcomes. Either the whole operation happened, and
 * this describes it, or it was refused and the answer is a 400 carrying one
 * plain sentence. Giving refusal a spelling inside this schema would invite a
 * caller to treat "I did nothing" as a kind of success.
 *
 * **`settings` is here because the `.meta` is the one file this service touches
 * that the editor did not name.** Everything else in the write privilege names
 * exactly one path; a move takes the sidecar with the file it annotates and a
 * delete takes it too, so the answer says which one went along rather than
 * leaving the caller to derive it and hope.
 */

export const FILE_CHANGE_FORMAT = 'kernel2d.file-change'
export const FILE_CHANGE_VERSION = 1

export type FileChangeKind = 'moved' | 'deleted'

export interface FileChange {
  format: typeof FILE_CHANGE_FORMAT
  version: typeof FILE_CHANGE_VERSION
  kind: FileChangeKind
  /** Where it was, project-relative and forward-slashed. */
  path: string
  /** Where it is now, or null when it was deleted. */
  to: string | null
  /** Whether the thing named was a folder. Only a move can say true. */
  isDirectory: boolean
  /**
   * The `.meta` that went with it, as it was addressed before — or null when the
   * file had none, and always null for a folder, whose sidecars are inside it
   * and travel as part of it. After a move it is at `<to>.meta`; after a delete
   * it is gone.
   */
  settings: string | null
}

export const FileChangeSchema: z.ZodType<FileChange> = z.object({
  format: z.literal(FILE_CHANGE_FORMAT),
  version: z.literal(FILE_CHANGE_VERSION),
  kind: z.enum(['moved', 'deleted']),
  path: z.string().min(1),
  to: z.string().min(1).nullable(),
  isDirectory: z.boolean(),
  settings: z.string().min(1).nullable(),
})
