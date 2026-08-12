import { DocumentViewSchema, type EditorDocument } from '../../sidecar/document-view-schema'

/**
 * Putting one document back on disk, through the editor service.
 *
 * The sibling of `meta-disk.ts`, and held to the same shape: it names a single
 * file and hands over every byte that file should now hold. The service never
 * decides on its own that a document should be different, and it will not
 * create a file that is not already there — the whole of what it will and will
 * not overwrite is stated at the top of `sidecar/document-files.ts`.
 *
 * The service's refusals arrive as a sentence meant for a human, so they are
 * carried through unchanged rather than replaced with a status code.
 */
export async function writeDocumentToDisk(path: string, document: EditorDocument): Promise<void> {
  const response = await fetch(`/api/document?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(await refusal(response))

  // Validated rather than trusted, the same as every other answer this editor
  // reads: a service speaking a shape this editor does not know should be
  // treated as a failed write, not as a successful one.
  DocumentViewSchema.parse(await response.json())
}

async function refusal(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error !== '') return body.error
  } catch {
    // Fall through to the generic sentence below.
  }
  return 'The editor service would not save this document.'
}
