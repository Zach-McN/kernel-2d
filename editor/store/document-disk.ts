import { DocumentViewSchema, type EditorDocument } from '../../sidecar/document-view-schema'

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
 * carried through unchanged rather than replaced with a status code.
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
  const response = await fetch(`/api/document?path=${encodeURIComponent(path)}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(await refusal(response, fallback))

  // Validated rather than trusted, the same as every other answer this editor
  // reads: a service speaking a shape this editor does not know should be
  // treated as a failed write, not as a successful one.
  DocumentViewSchema.parse(await response.json())
}

async function refusal(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error !== '') return body.error
  } catch {
    // Fall through to the generic sentence below.
  }
  return fallback
}
