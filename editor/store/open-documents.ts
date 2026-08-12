import { useStore } from 'zustand'

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
 * What is deliberately *not* here: selection. What is selected stays in its own
 * context, outside the document and outside undo, so that pressing Ctrl-Z after
 * clicking around reverses the last thing that was changed rather than the last
 * thing that was looked at (editor-ui U8).
 */

const store = createDocumentStore({ writeToDisk: writeMetaToDisk })

export const { edit, editDocument, sealEdits, undo, redo, peekUndo, peekRedo, beginRead, adoptFromDisk } =
  store

export type { Document }

/** The settings for one file, or null when this window has not loaded them. */
export function useDocument(path: string | null): Document | null {
  return useDocumentState((state) => (path === null ? null : (state.docs[path] ?? null)))
}

/** Why the settings for one file could not be saved, if they could not. */
export function useSaveFailure(path: string | null): string | null {
  return useDocumentState((state) => (path === null ? null : (state.saveFailures[path] ?? null)))
}

function useDocumentState<T>(select: (state: DocumentState) => T): T {
  return useStore(store.reader, select)
}
