import fs from 'node:fs/promises'

import {
  DOCUMENT_VIEW_FORMAT,
  DOCUMENT_VIEW_VERSION,
  KNOWN_DOCUMENT_FORMATS,
  MAX_SHOWN_DOCUMENT_BYTES,
  documentSchemaFor,
  type DocumentView,
  type EditorDocument,
} from './document-view-schema.js'
import { BadDocumentError, BadPathError, resolveInsideProject } from './meta-files.js'
import { relativePosixPath } from './paths.js'

/**
 * Documents the editor opens and puts back — scenes today, prefabs and data
 * tables as those formats arrive.
 *
 * This is where the service's write privilege was widened, and the widened rule
 * still fits in three lines (editor-kernel D17):
 *
 *   - of its own accord, creates a `.meta` when an asset has none, and deletes
 *     a stranded one at startup;
 *   - replaces the whole contents of one file the editor names, when that file
 *     already exists and the document is valid in a format this editor knows;
 *   - never modifies anything else, and never changes a file on its own
 *     initiative.
 *
 * The middle line is doing more work than it did, so the two guards that keep it
 * honest are worth stating on their own, because both are the difference between
 * a bounded privilege and a general "write anything" endpoint:
 *
 *   1. **It never creates a file.** A path with nothing at it is refused, not
 *      filled in. Making a new scene is a feature that does not exist yet, and
 *      when it does it should be a deliberate one rather than a side effect of
 *      a typo in a path.
 *
 *   2. **It only replaces a document with one of the format it already is.**
 *      The existing file is read and parsed first. Without this, a valid scene
 *      document sent at the path of somebody's PNG would overwrite their art —
 *      the document is valid, the path is inside the project, and every other
 *      check passes. "Valid document" is a statement about the body; this is the
 *      statement about the target, and both are needed.
 */

/** What a document is written as: two spaces and a trailing newline, like a `.meta`. */
function serialize(document: EditorDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * Answers "what document is at this path?", including the two answers that are
 * not a document: there is nothing there, and there is something there this
 * editor cannot read. Both are ordinary rather than exceptional, and both are
 * what a panel most needs to say something useful about.
 */
export async function readDocumentView(projectPath: string, requestedPath: string): Promise<DocumentView> {
  const resolved = resolveInsideProject(projectPath, requestedPath)
  if (!resolved.ok) throw new BadPathError(resolved.problem)

  const shownPath = relativePosixPath(projectPath, resolved.absolute)

  let raw: string
  try {
    raw = await fs.readFile(resolved.absolute, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // A folder reads as EISDIR on Linux and EPERM/EISDIR elsewhere; either way
    // there is no document there, which is the same answer as nothing at all.
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'EPERM') {
      return view(shownPath, { status: 'none' })
    }
    throw error
  }

  const unreadable = (problem: string): DocumentView =>
    view(shownPath, {
      status: 'unreadable',
      problem,
      text: Buffer.byteLength(raw, 'utf8') <= MAX_SHOWN_DOCUMENT_BYTES ? raw : null,
    })

  const read = parseDocument(raw)
  if (!read.ok) return unreadable(read.problem)

  return view(shownPath, { status: 'ok', document: read.document })
}

/**
 * Replaces one document with the one the editor supplied in full.
 *
 * Every refusal is one plain sentence and leaves the file byte-for-byte as it
 * was, because these sentences are shown to a human rather than logged.
 */
export async function writeDocumentFor(
  projectPath: string,
  requestedPath: string,
  document: unknown,
): Promise<DocumentView> {
  const resolved = resolveInsideProject(projectPath, requestedPath)
  if (!resolved.ok) throw new BadPathError(resolved.problem)

  const schema = documentSchemaFor((document as { format?: unknown } | null)?.format)
  if (schema === undefined) {
    throw new BadDocumentError(
      `That is not a document this editor writes. It knows ${KNOWN_DOCUMENT_FORMATS.join(', ')}.`,
    )
  }

  const parsed = schema.safeParse(document)
  if (!parsed.success) {
    throw new BadDocumentError(`That document is not one this editor can write — ${firstIssue(parsed.error)}.`)
  }

  // What is there now decides whether this write is allowed at all. Reading
  // before writing costs one small read and is the whole of guard 2 above.
  let existing: string
  try {
    existing = await fs.readFile(resolved.absolute, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'EPERM') {
      throw new BadPathError('There is no document at that path, and this editor never creates one.')
    }
    throw error
  }

  const current = parseDocument(existing)
  if (!current.ok) {
    throw new BadPathError(
      'The file at that path is not a document this editor recognises, so it is left exactly as it is.',
    )
  }

  if (current.document.format !== parsed.data.format) {
    throw new BadPathError(
      `That would turn a ${current.document.format} into a ${parsed.data.format}, which is not a change this editor makes.`,
    )
  }

  await fs.writeFile(resolved.absolute, serialize(parsed.data), 'utf8')

  // Read back from disk rather than assumed, so one round trip tells the editor
  // what is actually there.
  return readDocumentView(projectPath, requestedPath)
}

type ParseResult = { ok: true; document: EditorDocument } | { ok: false; problem: string }

/**
 * Text on disk to a document, or the reason it is not one.
 *
 * The three failures are deliberately different sentences: not JSON at all, a
 * format this editor has never heard of, and a document of a known format that
 * is malformed. Only the third is a bug in something; the second is most likely
 * a file belonging to a newer editor or a genre layer, and telling a human "this
 * is not valid" about it would be wrong.
 */
function parseDocument(raw: string): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    return { ok: false, problem: `This file is not valid JSON: ${(error as Error).message}.` }
  }

  const format = (value as { format?: unknown } | null)?.format
  const schema = documentSchemaFor(format)
  if (schema === undefined) {
    return {
      ok: false,
      problem:
        typeof format === 'string'
          ? `This editor does not know the format "${format}". It knows ${KNOWN_DOCUMENT_FORMATS.join(', ')}.`
          : 'This file does not say what format it is, so this editor cannot open it.',
    }
  }

  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, problem: `This ${String(format)} is not one this editor can read — ${firstIssue(parsed.error)}.` }
  }

  return { ok: true, document: parsed.data }
}

function view(
  shownPath: string,
  parts: Partial<Omit<DocumentView, 'format' | 'version' | 'path'>> & Pick<DocumentView, 'status'>,
): DocumentView {
  return {
    format: DOCUMENT_VIEW_FORMAT,
    version: DOCUMENT_VIEW_VERSION,
    path: shownPath,
    status: parts.status,
    document: parts.document ?? null,
    problem: parts.problem ?? null,
    text: parts.text ?? null,
  }
}

/** One issue, said plainly. A wall of validator output helps nobody read a panel. */
function firstIssue(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0]
  if (issue === undefined) return 'it did not validate'
  const where = issue.path.map(String).join('.')
  return where === '' ? issue.message : `${where}: ${issue.message}`
}
