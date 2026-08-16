import { FileChangeSchema, type FileChange } from '../../sidecar/file-change-schema'
import { askService } from './service'

/**
 * Moving one file, and deleting one file, through the editor service.
 *
 * The third file in this folder that reaches the service, beside `meta-disk.ts`
 * and `document-disk.ts`, and held to the same shape: it names paths and nothing
 * else. **Neither of these carries a body**, which is not a saving — it is the
 * statement that these requests are entirely described by the files they name.
 *
 * **Two calls, mirroring the service's two requests**, for the reason the create
 * and the replace are two calls: kept apart, neither can do the other's job
 * however confused the caller is. A "move, or delete when there is no
 * destination" would look identical on the day it was written.
 *
 * Nothing here fixes up a reference. That is `editor/shell/useFileMoves.ts`,
 * above this layer, because it is a change to *documents* and this file's whole
 * subject is one file on disk. The service's refusals arrive as a sentence meant
 * for a human, so they are carried through unchanged rather than replaced with a
 * status code (`service.ts`).
 */
export function moveFileOnDisk(from: string, to: string): Promise<FileChange> {
  return send(
    `/api/move?path=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    'The editor service would not move this file.',
  )
}

export function deleteFileOnDisk(path: string): Promise<FileChange> {
  return send(
    `/api/delete?path=${encodeURIComponent(path)}`,
    'The editor service would not delete this file.',
  )
}

function send(url: string, fallback: string): Promise<FileChange> {
  return askService(url, { method: 'POST' }, FileChangeSchema, fallback)
}
