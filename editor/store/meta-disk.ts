import type { AssetMeta } from '../../runtime/formats/meta-schema'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import { askService, jsonBody } from './service'

/**
 * Putting one document back on disk, through the editor service.
 *
 * The whole of the editor's write privilege in one function: it names a single
 * file and hands over every byte of the settings that file should now hold. The
 * service never decides on its own that a `.meta` should be different — see the
 * three lines at the top of `sidecar/meta-files.ts`.
 *
 * The service's own refusals arrive as a sentence meant for a human, so they are
 * carried through unchanged rather than replaced with a status code (`service.ts`).
 */
export async function writeMetaToDisk(path: string, document: AssetMeta): Promise<void> {
  await askService(
    `/api/meta?path=${encodeURIComponent(path)}`,
    jsonBody('PUT', document),
    MetaViewSchema,
    'The editor service would not save these settings.',
  )
}
