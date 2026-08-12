import { applyPatches, enablePatches, freeze, produceWithPatches, type Draft, type Patch } from 'immer'
import { createStore } from 'zustand/vanilla'

import type { AssetMeta } from '../../runtime/formats/meta-schema'
import type { Scene } from '../../runtime/formats/scene-schema'

/**
 * The transaction API: the one door every change to a document goes through,
 * and the only place in the editor that implements undo.
 *
 * Undo is document-level, recorded as immer patches over the document map, and
 * written exactly once (editor-kernel D7). No tool ever writes an inverse of its
 * own operation — that is the failure this design exists to prevent, because a
 * hand-written inverse is subtly wrong in a way that surfaces three actions
 * later, nowhere near the tool that caused it (G2).
 *
 * Two things keep the direct-mutation path shut rather than merely discouraged.
 * The zustand store is created inside this module and never leaves it, so there
 * is no `setState` for a panel to reach; and immer freezes every state it
 * produces, so a panel that tries to assign to a document throws on the spot
 * instead of leaving the store and the undo stack quietly out of step.
 *
 * There are exactly two ways in:
 *
 *   - `edit` / `editDocument` — a change the human made. Undoable.
 *   - `adoptFromDisk` — the file changed underneath us. Not an edit, so it
 *     records no undo step; undoing a change somebody made in Notepad is not a
 *     thing this editor should offer.
 */

enablePatches()

/**
 * A document as everything outside this module sees it. Reads are ordinary;
 * writes go through the doors above.
 *
 * A union rather than one type, and the store itself knows nothing about which
 * member it is holding: undo is patches over a map of JSON, and every rule in
 * this file — merging, coalescing, staleness, the save debounce — is the same
 * whether the thing being edited is a texture's import settings or a level.
 * That is the whole payoff of document-level undo (editor-kernel D7): the scene
 * format arrived and not one line of undo was written for it.
 *
 * The only place the difference shows is which service endpoint the write goes
 * to, and that is a one-line branch on `format` in `open-documents.ts`.
 */
export type Document = AssetMeta | Scene

export interface DocumentState {
  /** Keyed by the project-relative path of the file the settings belong to. */
  readonly docs: Readonly<Record<string, Document>>
  /**
   * Paths whose settings could not be written, and one plain sentence saying
   * so. A save that silently fails is the worst outcome available here: the
   * screen says one thing and the folder — which is the database — says
   * another. Cleared by the next save that works.
   */
  readonly saveFailures: Readonly<Record<string, string>>
}

export interface EditIntent {
  /** What the human did, in their words. */
  label: string
  /**
   * Edits that share a merge key and land close together become one undo step,
   * so typing `24` into a field is one press of Ctrl-Z rather than two.
   * Conventionally `<path>#<field>`. Omit it and every edit stands alone.
   */
  merge?: string
}

/** Writes one document to disk. Resolves when it is there, rejects when it is not. */
export type WriteToDisk = (path: string, document: Document) => Promise<unknown>

export interface DocumentStoreOptions {
  writeToDisk: WriteToDisk
  /** Overridden by tests so a merge window can be crossed without waiting. */
  now?: () => number
  saveDebounceMs?: number
  mergeWindowMs?: number
}

/**
 * How long a document sits still before it is written.
 *
 * Spent out of the human's one-second budget (editor-ui U6) and the only cost
 * this feature adds to it: the watcher's 200ms write-settling delay and the
 * folder's 75ms burst settle are already spent, and they govern when the change
 * comes back round, not when the file on disk is correct.
 */
export const SAVE_DEBOUNCE_MS = 200

/**
 * How long consecutive edits to the same field keep merging into one undo step.
 * Long enough to type a number; short enough that a pause to think reads as
 * finishing one change and starting another.
 */
export const MERGE_WINDOW_MS = 600

interface HistoryEntry {
  label: string
  patches: Patch[]
  inversePatches: Patch[]
}

export interface DocumentStore {
  /**
   * Read-only view, for the React bindings. `setState` is deliberately absent:
   * this is the whole of what anything outside can do to the store without
   * going through a transaction.
   */
  readonly reader: {
    getState: () => DocumentState
    getInitialState: () => DocumentState
    subscribe: (listener: (state: DocumentState, previous: DocumentState) => void) => () => void
  }

  /** The primitive: one transaction over the whole document map. */
  edit: (intent: EditIntent, recipe: (docs: Draft<Record<string, Document>>) => void) => void

  /**
   * The shorthand for the common case — one document, which must already be
   * loaded. Does nothing if it is not, rather than inventing one.
   */
  editDocument: (path: string, intent: EditIntent, recipe: (document: Draft<Document>) => void) => void

  /** Ends an open merge run, so the next edit starts a fresh undo step. */
  sealEdits: () => void

  /** True when there was something to reverse. */
  undo: () => boolean
  redo: () => boolean

  /** What Ctrl-Z would reverse, for anything that wants to name it. */
  peekUndo: () => string | null
  peekRedo: () => string | null

  /**
   * Taken before asking the service what a file holds, and handed back to
   * `adoptFromDisk` with the answer. It is what lets the store tell a read that
   * predates its own write from one that followed it.
   */
  beginRead: () => number

  /**
   * The file changed on disk. Disk wins — except where the incoming value is
   * stale by construction, which is what `readStartedAt` is for.
   */
  adoptFromDisk: (path: string, document: Document, readStartedAt: number) => void

  /** Writes anything outstanding immediately. For teardown and for tests. */
  flushSaves: () => Promise<void>
}

export function createDocumentStore(options: DocumentStoreOptions): DocumentStore {
  const now = options.now ?? Date.now
  const saveDebounceMs = options.saveDebounceMs ?? SAVE_DEBOUNCE_MS
  const mergeWindowMs = options.mergeWindowMs ?? MERGE_WINDOW_MS

  const store = createStore<DocumentState>()(() => ({ docs: {}, saveFailures: {} }))

  // One stack for the whole project, ordered by time. Never one per file: a
  // per-file stack makes Ctrl-Z mean something different depending on what
  // happens to be selected, which is precisely the jank this API exists to
  // prevent.
  const undoStack: HistoryEntry[] = []
  const redoStack: HistoryEntry[] = []
  let openMerge: { key: string; at: number } | null = null

  // The disk relationship, deliberately outside the store: none of it is
  // undoable, and none of it belongs in a patch.
  const lastKnownDisk = new Map<string, Document>()
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const inFlight = new Set<string>()
  const lastWriteAt = new Map<string, number>()

  // --- the transaction ------------------------------------------------------

  const edit: DocumentStore['edit'] = (intent, recipe) => {
    const before = store.getState().docs
    const [after, patches, inversePatches] = produceWithPatches(before, recipe)

    // A control that re-emits the value it already had is not a change, and an
    // undo step that reverses nothing is a step Ctrl-Z appears to skip.
    if (patches.length === 0) return

    const at = now()
    const merging =
      intent.merge !== undefined && openMerge?.key === intent.merge && at - openMerge.at <= mergeWindowMs

    const previous = undoStack.at(-1)
    if (merging && previous !== undefined) {
      undoStack[undoStack.length - 1] = {
        label: intent.label,
        patches: [...previous.patches, ...patches],
        // Inverses concatenate in reverse: undoing both means undoing the newer
        // change first. Same-field replaces would survive the naive order, so
        // this is the kind of wrong that passes every test written against the
        // case in hand and fails the first one that isn't.
        inversePatches: [...inversePatches, ...previous.inversePatches],
      }
    } else {
      undoStack.push({ label: intent.label, patches, inversePatches })
    }

    openMerge = intent.merge === undefined ? null : { key: intent.merge, at }
    redoStack.length = 0

    store.setState({ docs: after })
    scheduleSaves(pathsTouchedBy(patches))
  }

  const editDocument: DocumentStore['editDocument'] = (path, intent, recipe) => {
    if (store.getState().docs[path] === undefined) return
    edit(intent, (docs) => {
      const document = docs[path]
      if (document !== undefined) recipe(document)
    })
  }

  const sealEdits = (): void => {
    openMerge = null
  }

  const step = (from: HistoryEntry[], to: HistoryEntry[], direction: 'undo' | 'redo'): boolean => {
    sealEdits()
    const entry = from.pop()
    if (entry === undefined) return false

    const patches = direction === 'undo' ? entry.inversePatches : entry.patches
    store.setState({ docs: applyPatches(store.getState().docs, patches) })
    to.push(entry)
    scheduleSaves(pathsTouchedBy(patches))
    return true
  }

  // --- the disk -------------------------------------------------------------

  const adoptFromDisk: DocumentStore['adoptFromDisk'] = (path, document, readStartedAt) => {
    // A change of ours that has not reached disk yet makes the incoming value
    // stale by definition — it is the file as it was before we wrote. Adopting
    // it here would undo a keystroke the human has just made. The second case is
    // the same thing with the timer already gone: a write that was refused
    // leaves the editor holding a change the folder has never seen, and letting
    // a re-read replace it would discard the human's work *and* the only sign
    // on screen that anything went wrong.
    if (saveTimers.has(path) || inFlight.has(path)) return
    if (store.getState().saveFailures[path] !== undefined) return

    /*
     * The third case is the one that is easy to miss and hard to spot
     * afterwards: a read that was *issued* before this editor wrote the file
     * can be *answered* after it, and it then carries the contents from before
     * the write. Nothing about the answer says so — it is a perfectly ordinary
     * reply to a perfectly ordinary question, and taking it silently reverts
     * the change and then writes the reversion back to disk, so the setting
     * appears not to have worked at all.
     *
     * It has to be the read's *start* that is compared, not its arrival: by the
     * time it arrives the write is long finished and the two are
     * indistinguishable. Discarding it costs nothing, because the write's own
     * watcher event triggers a fresh read that is unambiguously newer.
     */
    const wroteAt = lastWriteAt.get(path)
    if (wroteAt !== undefined && readStartedAt <= wroteAt) return

    const incoming = freeze(document, true)
    lastKnownDisk.set(path, incoming)

    /*
     * Why the write / watch / re-read cycle stops here rather than going round
     * for ever.
     *
     * Writing a `.meta` makes the watcher report a change, which re-reads the
     * folder, which re-asks for these settings, which arrives back at this
     * function — the same shape as the loop in editor-kernel G9, one layer up.
     * That one terminated by *rule*: a `.meta` is not an asset, so the second
     * pass through had nothing to do.
     *
     * This one terminates because the round trip is identity. What comes back
     * is exactly the document that went out, so `sameJson` holds, so no state
     * changes, so nothing schedules another write. The cycle has a fixed point
     * and the very first iteration is already sitting on it.
     *
     * What guarantees the identity is the round-trip property the format is
     * already tested for — `load(save(x))` equals `x` (editor-kernel G1,
     * editor-verification V7). That test is therefore doing double duty, and a
     * session that breaks it does not only break the format: it turns this into
     * a loop that writes the same file for ever. If you are changing how a
     * document is serialized, that is the test to watch.
     */
    if (sameJson(store.getState().docs[path], incoming)) return

    store.setState((state) => ({ docs: { ...state.docs, [path]: incoming } }))
  }

  function scheduleSaves(paths: Iterable<string>): void {
    for (const path of paths) {
      const timer = saveTimers.get(path)
      if (timer !== undefined) clearTimeout(timer)

      if (sameJson(store.getState().docs[path], lastKnownDisk.get(path))) {
        saveTimers.delete(path)
        continue
      }

      saveTimers.set(
        path,
        setTimeout(() => {
          void save(path)
        }, saveDebounceMs),
      )
    }
  }

  async function save(path: string): Promise<void> {
    saveTimers.delete(path)

    const document = store.getState().docs[path]
    if (document === undefined || sameJson(document, lastKnownDisk.get(path))) return

    inFlight.add(path)
    try {
      await options.writeToDisk(path, document)
    } catch (error) {
      // Deliberately not retried on a timer. A service that refused once will
      // refuse again, and a save that quietly retries for ever is a service
      // being hammered by an editor nobody has told anything is wrong. The
      // failure is recorded instead, and the next edit tries again.
      recordFailure(path, error)
      return
    } finally {
      inFlight.delete(path)
    }

    // What we sent, not what came back: if the service ever wrote something
    // different, the watcher's echo comes through `adoptFromDisk` and settles
    // it there, along one path rather than two.
    lastKnownDisk.set(path, document)
    lastWriteAt.set(path, now())
    clearFailure(path)

    // Changed again while that was in the air.
    if (!sameJson(store.getState().docs[path], lastKnownDisk.get(path))) scheduleSaves([path])
  }

  function recordFailure(path: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    store.setState((state) => ({
      saveFailures: { ...state.saveFailures, [path]: detail },
    }))
  }

  function clearFailure(path: string): void {
    if (store.getState().saveFailures[path] === undefined) return
    store.setState((state) => {
      const { [path]: _cleared, ...rest } = state.saveFailures
      return { saveFailures: rest }
    })
  }

  return {
    reader: {
      getState: store.getState,
      getInitialState: store.getInitialState,
      subscribe: store.subscribe,
    },
    edit,
    editDocument,
    sealEdits,
    undo: () => step(undoStack, redoStack, 'undo'),
    redo: () => step(redoStack, undoStack, 'redo'),
    peekUndo: () => undoStack.at(-1)?.label ?? null,
    peekRedo: () => redoStack.at(-1)?.label ?? null,
    beginRead: now,
    adoptFromDisk,
    flushSaves: async () => {
      // A save can schedule the next one — a document changed while its write
      // was in the air — so this drains rather than sweeps once. The bound is a
      // backstop against a document that somehow never settles, not a budget.
      for (let pass = 0; pass < 100 && (saveTimers.size > 0 || inFlight.size > 0); pass += 1) {
        for (const [path, timer] of [...saveTimers]) {
          clearTimeout(timer)
          saveTimers.delete(path)
          await save(path)
        }
        if (inFlight.size > 0) await new Promise((resolve) => setTimeout(resolve, 5))
      }
    },
  }
}

/**
 * Which documents a set of patches touched. Patches are rooted at the document
 * map, so the first path segment is the document's own path.
 */
function pathsTouchedBy(patches: readonly Patch[]): Set<string> {
  const touched = new Set<string>()
  for (const patch of patches) {
    const first = patch.path[0]
    if (typeof first === 'string') touched.add(first)
  }
  return touched
}

/**
 * Deep equality for the JSON these documents are made of.
 *
 * Not `JSON.stringify` on both sides: that answers "were these written in the
 * same key order", which is a different question and one whose answer changes
 * when a document makes a round trip through a schema.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameJson(item, b[index]))
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false

  return keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
}
