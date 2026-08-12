import fs from 'node:fs/promises'
import type { Stats } from 'node:fs'

import { assetTypeForName } from '../runtime/formats/meta-schema.js'
import { BadPathError, RefusedError, resolveInsideProject } from './meta-files.js'

/**
 * The service handing over the bytes of one asset — the whole of what it will
 * read out of a human's project folder, and nothing beyond it.
 *
 * D17 states the write privilege in three lines so that it stays small enough
 * to hold in your head. This is the same discipline for the read that the
 * viewport needed, in four:
 *
 *   - it serves only a file the editor recognises as an asset — a texture, a
 *     sound, a font. Never a `.meta`, never a scene, never anything else;
 *   - it never reads outside the project folder, and refuses `..`, absolute
 *     paths and ignored folders through the same check every other path from
 *     the browser passes;
 *   - it is a read: it creates nothing, writes nothing, and lists nothing;
 *   - it answers with a content type taken from the file's extension, never
 *     guessed from the file's contents.
 *
 * The first line is the one doing the work, and it is deliberately narrower
 * than "any file in the project". A general static server over somebody's
 * project folder is a far bigger privilege than "draw me this PNG", and the
 * moment it exists nobody can say what the editor is able to read without going
 * and looking. Widening this list means widening the asset vocabulary in
 * `runtime/formats/meta-schema.ts`, which is one place and is already the
 * answer to "does the editor know about this file?" everywhere else.
 */

/**
 * What each extension is served as.
 *
 * Every key here is in `ASSET_TYPE_BY_EXTENSION`, and a file whose extension is
 * missing from this map is served as bytes rather than refused — being unable
 * to name a type is not a reason to withhold a file the editor recognises.
 */
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',

  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',

  '.fnt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const OCTET_STREAM = 'application/octet-stream'

export interface AssetBytes {
  absolutePath: string
  contentType: string
  size: number
}

/** Thrown when the file the browser named is not there. Answered as 404. */
export class NotFoundError extends Error {}

/**
 * Resolves a request for an asset's bytes into something a response can be
 * built from, or refuses.
 *
 * Deliberately returns the path and the stats rather than the contents: a
 * texture can be tens of megabytes, and the caller streams it. Reading it into
 * memory here would make the size of a human's art the size of this service's
 * heap.
 */
export async function resolveAssetBytes(projectPath: string, requestedPath: string): Promise<AssetBytes> {
  const resolved = resolveInsideProject(projectPath, requestedPath)
  if (!resolved.ok) throw new BadPathError(resolved.problem)

  const name = requestedPath.split(/[\\/]/).at(-1) ?? ''
  if (assetTypeForName(name) === null) {
    throw new NotAnAssetError(
      'That is not a file the editor imports, so it is not served. Only textures, audio and fonts are.',
    )
  }

  let stats: Stats
  try {
    stats = await fs.stat(resolved.absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('There is no file at that path.')
    }
    throw error
  }

  // A folder named `knight.png` is not a texture. Unlikely, and cheaper to rule
  // out than to explain later.
  if (!stats.isFile()) throw new NotFoundError('There is no file at that path.')

  return {
    absolutePath: resolved.absolute,
    contentType: CONTENT_TYPE_BY_EXTENSION[extensionOf(name)] ?? OCTET_STREAM,
    size: stats.size,
  }
}

/** Refused because the file is not one this editor imports. Answered as 400. */
export class NotAnAssetError extends RefusedError {}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}
