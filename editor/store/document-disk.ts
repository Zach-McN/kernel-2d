import { DocumentViewSchema, type EditorDocument } from '../../sidecar/document-view-schema'
import { askService, jsonBody } from './service'

/**
 * Reading one document, with no side effect anywhere.
 *
 * The fourth place in the editor that asks `/api/document` about a path, and
 * deliberately the only one that does *nothing else with the answer*. The other
 * three each put what arrives into the document store, because for them reading
 * a file is how it comes to be open (`open-scene.tsx`, `scene-prefabs.tsx`) or
 * how a picker finds out what a file is (`ProjectInspector.tsx`). A rename needs
 * neither: it reads a level it is about to rewrite, and putting an un-rewritten
 * copy in the store on the way past would be the change arriving twice.
 *
 * It also needs the failure, not just the absence: "this level cannot be read"
 * is the sentence that stops a move before anything has been renamed, so the
 * problem is answered rather than flattened into null.
 */
export type ReadDocument =
  | { ok: true; document: EditorDocument }
  /**
   * `foreign` carries the service's own answer through: true when the file said
   * it belongs to something other than this editor, false when it might have
   * been one of this editor's own. A caller repairing this editor's documents
   * can skip the first and must not skip the second.
   */
  | { ok: false; foreign: boolean; problem: string }

export async function readDocumentFromDisk(path: string): Promise<ReadDocument> {
  let view
  try {
    const response = await fetch(`/api/document?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    view = DocumentViewSchema.parse(await response.json())
  } catch {
    // Unreachable, not foreign: nothing was learned about this file at all, so a
    // caller that refuses over a level it cannot read must refuse over this too.
    return { ok: false, foreign: false, problem: 'the editor service could not be asked about it' }
  }

  if (view.status === 'none') {
    // Gone between the folder listing and this read. There is no document to
    // repair, so nothing should stop on its account.
    return { ok: false, foreign: true, problem: 'it is not in the project folder' }
  }
  if (view.status === 'unreadable' || view.document === null) {
    return { ok: false, foreign: view.foreign, problem: view.problem ?? 'this editor cannot read it' }
  }

  return { ok: true, document: view.document }
}

/**
 * Putting one document on disk, through the editor service.
 *
 * The sibling of `meta-disk.ts`, and held to the same shape: it names a single
 * file and hands over every byte that file should now hold. The service never
 * decides on its own that a document should be different — the whole of what it
 * will and will not overwrite is stated at the top of
 * `sidecar/document-files.ts`.
 *
 * **Making one and replacing one are two calls**, mirroring the two requests the
 * service answers, and for the same reason: kept apart, neither can do the
 * other's job however confused the caller is. A create that fell back to
 * replacing would look identical on the day it was written and destroy a level
 * later.
 *
 * The service's refusals arrive as a sentence meant for a human, so they are
 * carried through unchanged rather than replaced with a status code (`service.ts`).
 */
export async function writeDocumentToDisk(path: string, document: EditorDocument): Promise<void> {
  await send('PUT', path, document, 'The editor service would not save this document.')
}

/**
 * Makes a document where there is nothing, and fails if there is something.
 *
 * Deliberately not part of the document store. The store holds documents that
 * are *open*, and a file that does not exist yet is not one of them — putting an
 * entry in the map to save it would be inventing a document nothing had read,
 * and would make the new file's first appearance an edit rather than a read. It
 * arrives in the editor the ordinary way instead: the watcher notices the file,
 * and the folder is re-read.
 *
 * The consequence, which is the honest one: making a level is not undoable.
 * Ctrl-Z reverses changes to documents, and it has never deleted a file.
 */
export async function createDocumentOnDisk(path: string, document: EditorDocument): Promise<void> {
  await send('POST', path, document, 'The editor service would not make this document.')
}

async function send(
  method: 'PUT' | 'POST',
  path: string,
  document: EditorDocument,
  fallback: string,
): Promise<void> {
  await askService(
    `/api/document?path=${encodeURIComponent(path)}`,
    jsonBody(method, document),
    DocumentViewSchema,
    fallback,
  )
}
