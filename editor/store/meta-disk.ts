import { MetaViewSchema } from '../../sidecar/meta-view-schema'

import type { Document } from './documents'

/**
 * Putting one document back on disk, through the editor service.
 *
 * The whole of the editor's write privilege in one function: it names a single
 * file and hands over every byte of the settings that file should now hold. The
 * service never decides on its own that a `.meta` should be different — see the
 * three lines at the top of `sidecar/meta-files.ts`.
 *
 * The service's own refusals arrive as a sentence meant for a human, so they are
 * carried through unchanged rather than replaced with a status code.
 */
export async function writeMetaToDisk(path: string, document: Document): Promise<void> {
  const response = await fetch(`/api/meta?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(await refusal(response))

  // Validated rather than trusted, the same as every other answer this editor
  // reads: a service speaking a shape this editor does not know should be
  // treated as a failed write, not as a successful one.
  MetaViewSchema.parse(await response.json())
}

async function refusal(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error !== '') return body.error
  } catch {
    // Fall through to the generic sentence below.
  }
  return 'The editor service would not save these settings.'
}
