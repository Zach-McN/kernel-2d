import { z } from 'zod'

import { PREFAB_FORMAT, PrefabSchema } from '../runtime/formats/prefab-schema.js'
import { PROJECT_FORMAT, ProjectSchema } from '../runtime/formats/project-schema.js'
import { SCENE_FORMAT, SceneSchema } from '../runtime/formats/scene-schema.js'

/**
 * The documents this service will read and write, and the answer it gives about
 * one.
 *
 * A `.meta` has its own endpoint and its own view, because it is an annotation
 * *about* a file rather than a document in its own right — it is addressed by
 * the path of the thing it annotates, it has orphan rules, and the service
 * creates one on its own initiative. Nothing in here does any of that. Two
 * nearly-identical envelopes is a duplication worth watching; the moment a third
 * arrives, generalise them.
 */

export const DOCUMENT_VIEW_FORMAT = 'kernel2d.document-view'
export const DOCUMENT_VIEW_VERSION = 1

/**
 * The registry: every document format the editor knows, keyed by the `format`
 * string the document itself carries.
 *
 * **This is the one list.** The union type below is derived from it and the
 * validator that guards a write is looked up in it, so a format cannot be added
 * to one and forgotten in the other. Keying on the document's own `format`
 * rather than on the path is what T1's format literal was always for: where a
 * file happens to sit in the folder tree is a convention, and what it says it is
 * is a fact.
 *
 * The prefab was the first test of that. Teaching this service a second document
 * format was one line here and nothing anywhere else: reading, creating and
 * replacing all look the answer up in this object, so the write privilege at the
 * top of `document-files.ts` is the same four lines it was with one format in it.
 * The project settings were the third, and cost the same one line — including the
 * guard that matters most, which is that a document is only ever replaced by one
 * of the format already at that path. A valid set of project settings sent at the
 * path of somebody's level is refused by a rule that was written before either
 * format existed.
 */
export const DOCUMENT_SCHEMAS = {
  [SCENE_FORMAT]: SceneSchema,
  [PREFAB_FORMAT]: PrefabSchema,
  [PROJECT_FORMAT]: ProjectSchema,
} as const

export type EditorDocument = z.infer<(typeof DOCUMENT_SCHEMAS)[keyof typeof DOCUMENT_SCHEMAS]>

/** Every format the editor can write, for saying so in a refusal. */
export const KNOWN_DOCUMENT_FORMATS: readonly string[] = Object.keys(DOCUMENT_SCHEMAS)

/** The schema for a format string, or undefined when it is not one we know. */
export function documentSchemaFor(format: unknown): z.ZodType<EditorDocument> | undefined {
  if (typeof format !== 'string') return undefined
  return Object.hasOwn(DOCUMENT_SCHEMAS, format)
    ? DOCUMENT_SCHEMAS[format as keyof typeof DOCUMENT_SCHEMAS]
    : undefined
}

/** Any registered document. Used where the *service* has already picked a format. */
export const EditorDocumentSchema: z.ZodType<EditorDocument> = z.union(Object.values(DOCUMENT_SCHEMAS))

export type DocumentViewStatus =
  /** A document was found and parsed. */
  | 'ok'
  /** There is no file at that path. */
  | 'none'
  /** There is a file and it is not something this editor understands. */
  | 'unreadable'

export interface DocumentView {
  format: typeof DOCUMENT_VIEW_FORMAT
  version: typeof DOCUMENT_VIEW_VERSION
  /** The path that was asked about, project-relative and forward-slashed. */
  path: string
  status: DocumentViewStatus
  /**
   * True when this file is readable JSON that has **positively said it is not
   * one of this editor's documents** — a data table, a placeholder, something a
   * newer editor wrote. False for everything else, including a file this editor
   * could not read at all.
   *
   * The three cases behind one flag, because the difference between them is only
   * cheap to work out here, where the registry is:
   *
   *   - readable, and claims a format this editor knows → **not foreign**,
   *     whether it parsed or is malformed;
   *   - readable, and claims a format this editor does not know, or claims none
   *     → **foreign**, and it is not broken; nothing should describe it as such;
   *   - not JSON at all → **not foreign**, because a file that says nothing about
   *     itself might be one of this editor's own documents that somebody mangled,
   *     and guessing otherwise is the guess that loses work.
   *
   * The consumer is the rename fixup: it refuses to move a file while a *level*
   * whose references it would have to repair cannot be read, and it must not
   * refuse over a data table that could never have held one. Every other reader
   * wants the sentence, which all three cases already have.
   */
  foreign: boolean
  document: EditorDocument | null
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
 * A scene can reasonably be large — a level with a thousand entities is not a
 * mistake — so this is generous next to the `.meta` limit. It bounds only the
 * *unreadable* case, where the text is shipped to a panel to be looked at.
 */
export const MAX_SHOWN_DOCUMENT_BYTES = 64 * 1024

export const DocumentViewSchema: z.ZodType<DocumentView> = z.object({
  format: z.literal(DOCUMENT_VIEW_FORMAT),
  version: z.literal(DOCUMENT_VIEW_VERSION),
  path: z.string().min(1),
  status: z.enum(['ok', 'none', 'unreadable']),
  foreign: z.boolean(),
  document: EditorDocumentSchema.nullable(),
  problem: z.string().min(1).nullable(),
  text: z.string().nullable(),
})
