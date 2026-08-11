import { z } from 'zod'

/**
 * The sidecar status format: what `GET /` returns.
 *
 * This is the first thing the editor asks for and the only thing it needs in
 * order to say which project it is looking at, so it is a format like any
 * other — one schema, read by the sidecar that writes it and the editor that
 * reads it (editor-kernel D6). The endpoint list is part of the payload so a
 * visitor, human or machine, never has to guess what else is served here.
 */

export const SIDECAR_STATUS_FORMAT = 'kernel2d.sidecar-status'
export const SIDECAR_STATUS_VERSION = 1

export interface SidecarStatus {
  format: typeof SIDECAR_STATUS_FORMAT
  version: typeof SIDECAR_STATUS_VERSION
  /** Absolute path to the watched project folder, forward-slashed. */
  projectPath: string
  /** Base name of that folder — the short name the editor shows. */
  projectName: string
  endpoints: {
    /** Path to the file tree, relative to this server's root. */
    tree: string
    /** Path to the change feed, which is a server-sent event stream. */
    events: string
  }
}

export const SidecarStatusSchema: z.ZodType<SidecarStatus> = z.object({
  format: z.literal(SIDECAR_STATUS_FORMAT),
  version: z.literal(SIDECAR_STATUS_VERSION),
  projectPath: z.string().min(1),
  projectName: z.string().min(1),
  endpoints: z.object({
    tree: z.string().min(1),
    events: z.string().min(1),
  }),
})
