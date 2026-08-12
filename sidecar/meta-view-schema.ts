import { z } from 'zod'

import { AssetMetaSchema, type AssetMeta } from './meta-schema.js'

/**
 * What `GET /meta?path=…` answers with.
 *
 * A format that is only ever served and never stored still gets a schema
 * (text-formats T4): the consumer is a separate process, so the shape is a
 * contract across a boundary whether or not it lands on disk.
 *
 * Kept separate from `AssetMetaSchema` on purpose. That schema describes what
 * is *in the file*; this one describes *the answer to a question about a file*,
 * including the two answers that are not a meta at all — there isn't one, and
 * there is one but this editor cannot read it.
 */

export const META_VIEW_FORMAT = 'kernel2d.meta-view'
export const META_VIEW_VERSION = 1

export type MetaViewStatus =
  /** A `.meta` was found and parsed. */
  | 'ok'
  /** No `.meta` exists beside the file. */
  | 'none'
  /** A `.meta` exists and is not something this editor understands. */
  | 'unreadable'

export interface MetaView {
  format: typeof META_VIEW_FORMAT
  version: typeof META_VIEW_VERSION
  /** The path that was asked about, project-relative and forward-slashed. */
  path: string
  /** The sidecar file consulted, or null when there is none. */
  metaPath: string | null
  status: MetaViewStatus
  meta: AssetMeta | null
  /** One plain sentence saying what is wrong. Only set when `unreadable`. */
  problem: string | null
  /**
   * The file's raw text, so the human can see what is actually in it rather
   * than only being told it could not be read. Only set when `unreadable`, and
   * only when the file is small enough to be worth showing.
   */
  text: string | null
}

/**
 * A `.meta` is a handful of settings. Anything larger is not one, and shipping
 * it to the browser to be shown in a panel would help nobody.
 */
export const MAX_SHOWN_TEXT_BYTES = 8 * 1024

export const MetaViewSchema: z.ZodType<MetaView> = z.object({
  format: z.literal(META_VIEW_FORMAT),
  version: z.literal(META_VIEW_VERSION),
  path: z.string().min(1),
  metaPath: z.string().min(1).nullable(),
  status: z.enum(['ok', 'none', 'unreadable']),
  meta: AssetMetaSchema.nullable(),
  problem: z.string().min(1).nullable(),
  text: z.string().nullable(),
})
