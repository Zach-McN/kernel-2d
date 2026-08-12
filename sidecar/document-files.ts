import fs from 'node:fs/promises'
import path from 'node:path'

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
 * This is where the service's write privilege lives, and the whole of it is four
 * lines (editor-kernel D22, widening D17), each one a sentence:
 *
 *   - of its own accord, creates a `.meta` when an asset has none, and deletes
 *     a stranded one at startup;
 *   - creates one file the editor names, when there is nothing at that path and
 *     the document is valid in a format this editor knows;
 *   - replaces the whole contents of one file the editor names, when that file
 *     already exists and the document is valid and of the format already there;
 *   - never modifies anything else, and never changes a file on its own
 *     initiative.
 *
 * **Creating and replacing are two separate requests, and that is the load-
 * bearing decision here.** The obvious design is one write with a flag, or one
 * write that creates when there is nothing there — and either of them means a
 * single mistake in the editor can turn "make a new level" into "erase this
 * level". Kept apart, `createDocumentFor` refuses when anything is there and
 * `writeDocumentFor` refuses when nothing is, so neither can do the other's job
 * however wrong the caller is. Every widening of this file should be checked the
 * same way: not "is this operation safe?" but "what does this operation do if
 * the caller is confused about which one it wanted?"
 *
 * Three guards are worth stating on their own, because each is the difference
 * between a bounded privilege and a general "write anything" endpoint:
 *
 *   1. **Replacing only ever replaces a document with one of the format it
 *      already is.** The existing file is read and parsed first. Without this, a
 *      valid scene document sent at the path of somebody's PNG would overwrite
 *      their art — the document is valid, the path is inside the project, and
 *      every other check passes. "Valid document" is a statement about the body;
 *      this is the statement about the target, and both are needed.
 *
 *   2. **Creating never creates a folder.** A path whose parent is not already
 *      there is refused rather than filled in. Making folders is a second
 *      privilege wearing the first one's clothes, and a mistyped path would
 *      quietly grow a tree of them in somebody's project.
 *
 *   3. **Creating is exclusive at the filesystem**, not an existence check
 *      followed by a write. The check-then-write version has a window, and two
 *      editors open on one folder land in it. `EEXIST` is not an error here, it
 *      is the answer.
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

  const parsed = parseSupplied(document)

  // What is there now decides whether this write is allowed at all. Reading
  // before writing costs one small read and is the whole of guard 1 above.
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

  if (current.document.format !== parsed.format) {
    throw new BadPathError(
      `That would turn a ${current.document.format} into a ${parsed.format}, which is not a change this editor makes.`,
    )
  }

  await fs.writeFile(resolved.absolute, serialize(parsed), 'utf8')

  // Read back from disk rather than assumed, so one round trip tells the editor
  // what is actually there.
  return readDocumentView(projectPath, requestedPath)
}

/**
 * Makes one document where there is nothing.
 *
 * Refuses rather than overwrites, always — a create that quietly replaced would
 * be indistinguishable from working right up until it destroyed a level. Every
 * refusal is one plain sentence and leaves the folder exactly as it was.
 */
export async function createDocumentFor(
  projectPath: string,
  requestedPath: string,
  document: unknown,
): Promise<DocumentView> {
  const resolved = resolveInsideProject(projectPath, requestedPath)
  if (!resolved.ok) throw new BadPathError(resolved.problem)

  const parsed = parseSupplied(document)

  // The folder has to be there already. Creating one is a privilege this
  // service does not have and should not acquire by accident.
  const parent = path.dirname(resolved.absolute)
  try {
    const stats = await fs.stat(parent)
    if (!stats.isDirectory()) {
      throw new BadPathError('That path is inside something that is not a folder.')
    }
  } catch (error) {
    if (error instanceof BadPathError) throw error
    throw new BadPathError(
      'There is no folder at that path to put a document in, and this editor never creates one.',
    )
  }

  try {
    // `wx` is what makes this a create rather than a write: the filesystem
    // decides whether the path was free, in the same operation that takes it.
    await fs.writeFile(resolved.absolute, serialize(parsed), { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'EISDIR') {
      throw new BadPathError('There is already something at that path, and this editor never writes over it.')
    }
    throw error
  }

  // Read back from disk rather than assumed, so one round trip tells the editor
  // what is actually there.
  return readDocumentView(projectPath, requestedPath)
}

/** A document the browser sent, validated, or the sentence saying why not. */
function parseSupplied(document: unknown): EditorDocument {
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

  return parsed.data
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
