import { annotatedPathFor, isMetaFileName } from '../../runtime/formats/meta-schema'
import type { ProjectReader } from '../../runtime'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import { DocumentViewSchema } from '../../sidecar/document-view-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { findNode } from './asset-kinds'

/**
 * How the runtime's scene loader reads files when it is running inside the
 * editor.
 *
 * The whole adapter, and the only place that knows the runtime is talking to a
 * development service rather than to a folder of static files. In an exported
 * game the same two functions are `fetch(path).then((r) => r.json())` and a
 * build number — which is exactly why the loader takes them as arguments instead
 * of reaching for either (`editor-kernel` D1).
 *
 * Two things worth knowing before changing anything here.
 *
 * **A `.meta` is asked for through its own endpoint.** The loader asks for
 * `knight.png.meta`, because that is the file on disk and that is what a shipped
 * game will fetch. This service addresses import settings by the path of the
 * thing they annotate, so the `.meta` suffix is taken off on the way out. That is
 * an adapter doing an adapter's job, not a special case leaking into the
 * runtime — the loader has no idea it happened.
 *
 * **The service parses documents before the runtime sees them.** So the
 * runtime's own validation is never exercised in the browser, and a level broken
 * by hand is described by the service's sentence rather than by the loader's.
 * Both are honest; the loader's half is covered by unit tests that hand it
 * garbage directly (`tests/runtime/load-scene.test.ts`), because nothing in the
 * editor can reach it.
 *
 * The version is the texture's own modification time, read from the same project
 * tree the editing view reads it from (`editor-kernel` G11). Sharing that source
 * is what lets play and edit share the renderer's texture cache instead of
 * uploading every texture to the graphics card a second time.
 */
export function projectReaderFor(tree: ProjectTree | null): ProjectReader {
  return {
    readJson: async (path) => {
      const meta = isMetaFileName(path) ? annotatedPathFor(path) : null
      return meta === null ? readDocument(path) : readMeta(meta)
    },

    assetVersion: (path) => {
      if (tree === null) return 0
      const node = findNode(tree, path)
      return node !== null && node.kind === 'file' ? node.mtimeMs : 0
    },
  }
}

async function readDocument(path: string): Promise<unknown | null> {
  const response = await fetch(`/api/document?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('the editor service would not answer about it')

  const view = DocumentViewSchema.parse(await response.json())
  if (view.status === 'none') return null
  if (view.status === 'unreadable' || view.document === null) {
    throw new Error(view.problem ?? 'this editor cannot read that file')
  }
  return view.document
}

async function readMeta(assetPath: string): Promise<unknown | null> {
  const response = await fetch(`/api/meta?path=${encodeURIComponent(assetPath)}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('the editor service would not answer about it')

  const view = MetaViewSchema.parse(await response.json())
  if (view.status === 'none') return null
  if (view.status === 'unreadable' || view.meta === null) {
    throw new Error(view.problem ?? 'its import settings could not be read')
  }
  return view.meta
}
