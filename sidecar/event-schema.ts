import { z } from 'zod'

/**
 * A change to the project folder, as it travels to the editor.
 *
 * The watcher already produces this shape in memory; wrapping it with a format
 * name and version is what makes the stream self-describing, so an editor
 * reading a feed from a newer sidecar can say so rather than silently
 * misreading it (editor-kernel D6).
 *
 * This module is compiled into the browser, so it must not import anything
 * Node-only — not even for a type. The vocabulary therefore starts here and the
 * watcher imports it, rather than the other way round.
 */

export const FILE_EVENT_FORMAT = 'kernel2d.file-event'
export const FILE_EVENT_VERSION = 1

export type FileEventKind = 'added' | 'changed' | 'removed'

export interface FileEventMessage {
  format: typeof FILE_EVENT_FORMAT
  version: typeof FILE_EVENT_VERSION
  /**
   * A rename arrives as a `removed` and an `added`, because no operating system
   * reports it as one thing. See `watcher.ts`.
   */
  kind: FileEventKind
  /** Project-relative, forward-slashed. */
  path: string
  isDirectory: boolean
  /** Size in bytes when the operating system reported one, otherwise null. */
  size: number | null
  /** Milliseconds since the epoch, when the sidecar saw the change. */
  at: number
}

export const FileEventMessageSchema: z.ZodType<FileEventMessage> = z.object({
  format: z.literal(FILE_EVENT_FORMAT),
  version: z.literal(FILE_EVENT_VERSION),
  kind: z.union([z.literal('added'), z.literal('changed'), z.literal('removed')]),
  path: z.string().min(1),
  isDirectory: z.boolean(),
  size: z.number().int().nonnegative().nullable(),
  at: z.number().int().nonnegative(),
})

/** Adds the format wrapper to a change the watcher just reported. */
export function toFileEventMessage(event: Omit<FileEventMessage, 'format' | 'version'>): FileEventMessage {
  return {
    format: FILE_EVENT_FORMAT,
    version: FILE_EVENT_VERSION,
    kind: event.kind,
    path: event.path,
    isDirectory: event.isDirectory,
    size: event.size,
    at: event.at,
  }
}
