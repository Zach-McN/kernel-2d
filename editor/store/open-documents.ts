import { useStore } from 'zustand'

import { ASSET_META_FORMAT, type AssetMeta } from '../../runtime/formats/meta-schema'
import { PREFAB_FORMAT, type Prefab } from '../../runtime/formats/prefab-schema'
import { SCENE_FORMAT, type Scene } from '../../runtime/formats/scene-schema'
import { writeDocumentToDisk } from './document-disk'
import { createDocumentStore, type Document, type DocumentState, type DocumentStore } from './documents'
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

/**
 * Editing, suspended — the whole of "nothing writes to my level while it is
 * running".
 *
 * Play mode shows a level the runtime read off disk, so an edit made while it is
 * running would change the file, change nothing on screen, and leave the human
 * unable to tell whether the editor or the game was at fault. The panels are put
 * out of reach as well (`editor/shell/panels.tsx`), and that is what the human
 * sees; this is what makes the guarantee hold whichever control anybody finds a
 * way to reach.
 *
 * It gates this module rather than the transaction API itself, and the boundary
 * is deliberate: play mode is a fact about *this editor window*, not about the
 * document model, and `documents.ts` is a file that ought to be readable without
 * knowing that play mode exists.
 *
 * **Undo is gated with the edits.** Ctrl-Z is a change to a document like any
 * other and would be written to disk like any other. `adoptFromDisk` is left
 * open on purpose — a file changing underneath the editor is a read, and taking
 * it writes nothing.
 */
let editingSuspended = false

export function suspendEditing(): void {
  editingSuspended = true
}

export function resumeEditing(): void {
  editingSuspended = false
}

export const edit: DocumentStore['edit'] = (intent, recipe) => {
  if (editingSuspended) return
  store.edit(intent, recipe)
}

export const editDocument: DocumentStore['editDocument'] = (path, intent, recipe) => {
  if (editingSuspended) return
  store.editDocument(path, intent, recipe)
}

export const undo: DocumentStore['undo'] = () => (editingSuspended ? false : store.undo())
export const redo: DocumentStore['redo'] = () => (editingSuspended ? false : store.redo())

export const { sealEdits, peekUndo, peekRedo, beginRead, adoptFromDisk, flushSaves } = store

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

/**
 * Every file the editor is holding a change the folder never accepted for, as
 * things stand right now.
 *
 * Not a hook, because its one caller is a button handler rather than a render:
 * Play has to know, at the moment it is pressed, whether the file it is about to
 * hand the runtime is really what is on screen.
 */
export function currentSaveFailures(): Readonly<Record<string, string>> {
  return store.reader.getState().saveFailures
}

/** Why the document for one path could not be saved, if it could not. */
export function useSaveFailure(path: string | null): string | null {
  return useDocumentState((state) => (path === null ? null : (state.saveFailures[path] ?? null)))
}

function useDocumentState<T>(select: (state: DocumentState) => T): T {
  return useStore(store.reader, select)
}
