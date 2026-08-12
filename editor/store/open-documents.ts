import { useStore } from 'zustand'

import { ASSET_META_FORMAT, type AssetMeta } from '../../runtime/formats/meta-schema'
import { PREFAB_FORMAT, SCENE_FORMAT, type Prefab, type Scene } from '../../runtime/formats/scene-schema'
import { writeDocumentToDisk } from './document-disk'
import { createDocumentStore, type Document, type DocumentState } from './documents'
import { writeMetaToDisk } from './meta-disk'

/**
 * The one document store this editor window has, and the hooks panels read it
 * through.
 *
 * One store per window, for the same reason the project folder is read once per
 * window (editor-ui U9): two stores would be two answers, refreshed on separate
 * timers, with nothing on screen saying which one you were looking at. It is a
 * module singleton rather than a context because — unlike selection — there is
 * exactly one of it and nothing would ever want a second.
 *
 * What is deliberately *not* here: selection, and which scene is open. Both are
 * UI state, live in their own context, and stay outside the document so that
 * pressing Ctrl-Z reverses the last thing that was changed rather than the last
 * thing that was looked at (editor-ui U8).
 */

/**
 * Which door a document goes out of.
 *
 * The only place in the editor that cares what kind of document it is holding.
 * Import settings go to the endpoint that knows about sidecars and orphans;
 * everything else goes to the one that replaces a named document. A format with
 * no door is a programming error rather than something to fail quietly about —
 * the store would otherwise record it as a save failure and try again for ever.
 */
function saveToDisk(path: string, document: Document): Promise<unknown> {
  if (document.format === ASSET_META_FORMAT) return writeMetaToDisk(path, document)
  if (document.format === SCENE_FORMAT || document.format === PREFAB_FORMAT) {
    return writeDocumentToDisk(path, document)
  }
  throw new Error(`This editor has nowhere to save a ${String((document as { format: string }).format)}.`)
}

const store = createDocumentStore({ writeToDisk: saveToDisk })

export const { edit, editDocument, sealEdits, undo, redo, peekUndo, peekRedo, beginRead, adoptFromDisk } =
  store

export type { Document }

/** The document for one path, whatever kind it is, or null if not loaded. */
export function useDocument(path: string | null): Document | null {
  return useDocumentState((state) => (path === null ? null : (state.docs[path] ?? null)))
}

/**
 * Every document this window is holding.
 *
 * For the one reader that needs a *set* of documents whose membership changes —
 * the textures a scene refers to. Returning the map itself rather than a
 * computed subset is deliberate: the map is replaced only when something in it
 * actually changes, so it is stable to depend on, where a fresh object built
 * per render would re-render for ever.
 */
export function useAllDocuments(): Readonly<Record<string, Document>> {
  return useDocumentState((state) => state.docs)
}

/**
 * The import settings for one file, or null.
 *
 * Typed rather than left to the caller to narrow, because "the store might be
 * holding a scene under this path" is a thought no panel should have to have.
 */
export function useMetaDocument(path: string | null): AssetMeta | null {
  return useDocumentState((state) => {
    const document = path === null ? undefined : state.docs[path]
    return document !== undefined && document.format === ASSET_META_FORMAT ? document : null
  })
}

/** The scene at one path, or null. */
export function useSceneDocument(path: string | null): Scene | null {
  return useDocumentState((state) => {
    const document = path === null ? undefined : state.docs[path]
    return document !== undefined && document.format === SCENE_FORMAT ? document : null
  })
}

/** The prefab at one path, or null. */
export function usePrefabDocument(path: string | null): Prefab | null {
  return useDocumentState((state) => {
    const document = path === null ? undefined : state.docs[path]
    return document !== undefined && document.format === PREFAB_FORMAT ? document : null
  })
}

/** Why the document for one path could not be saved, if it could not. */
export function useSaveFailure(path: string | null): string | null {
  return useDocumentState((state) => (path === null ? null : (state.saveFailures[path] ?? null)))
}

function useDocumentState<T>(select: (state: DocumentState) => T): T {
  return useStore(store.reader, select)
}
