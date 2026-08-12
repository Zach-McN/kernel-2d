import { beforeEach, describe, expect, it } from 'vitest'

import {
  createDocumentStore,
  sameJson,
  type Document,
  type DocumentStore,
} from '../../editor/store/documents'
import { defaultMeta, type AssetMeta, type TextureImportSettings } from '../../sidecar/meta-schema'

/**
 * The transaction API, on its own.
 *
 * Everything here is about the property the whole design rests on: undo is
 * written once, over the document, and reverses the last thing that was
 * *changed*. Every future genre tool inherits whatever this file proves, having
 * written no undo code of its own — so the cases worth having are the ones a
 * later tool would otherwise discover for us, three actions after the fact.
 *
 * The clock and the save are both injected, so a merge window can be crossed
 * without waiting and a write can be made to fail on demand.
 */

const KNIGHT = 'assets/textures/knight.png'
const SLIME = 'assets/textures/slime.png'

function textureMeta(id: string): AssetMeta {
  return defaultMeta('texture', id)
}

function textureSettings(document: Document | undefined): TextureImportSettings {
  const settings = document?.importSettings
  if (settings === undefined || settings.type !== 'texture') throw new Error('not a texture')
  return settings
}

/**
 * A read of the folder, the way the real caller does it: the token is taken
 * before the question is asked and handed back with the answer, which is what
 * lets the store tell a fresh answer from one that set off before its own last
 * write.
 */
function adopt(store: DocumentStore, path: string, document: AssetMeta): void {
  store.adoptFromDisk(path, document, store.beginRead())
}

interface Harness {
  store: DocumentStore
  /** Every write the store asked for, in order. */
  writes: { path: string; document: Document }[]
  /** Including the ones that were refused, so retries are countable. */
  attempts: () => number
  /** Moves the injected clock, so merge windows can be crossed instantly. */
  advance: (ms: number) => void
  /** Makes the next write fail with this sentence. */
  failNextWrite: (message: string) => void
  docs: () => Readonly<Record<string, Document>>
  settings: (path: string) => TextureImportSettings
}

let harness: Harness

beforeEach(() => {
  let clock = 1_000
  const writes: Harness['writes'] = []
  let attempts = 0
  let failWith: string | null = null

  const store = createDocumentStore({
    now: () => clock,
    // Zero, because these tests are about what is written and in what order,
    // not about how long the editor waits before writing it.
    saveDebounceMs: 0,
    writeToDisk: async (path, document) => {
      attempts += 1
      if (failWith !== null) {
        const message = failWith
        failWith = null
        throw new Error(message)
      }
      writes.push({ path, document })
    },
  })

  adopt(store, KNIGHT, textureMeta('1111111111111111'))
  adopt(store, SLIME, textureMeta('2222222222222222'))

  harness = {
    store,
    writes,
    attempts: () => attempts,
    advance: (ms) => {
      clock += ms
    },
    failNextWrite: (message) => {
      failWith = message
    },
    docs: () => store.reader.getState().docs,
    settings: (path) => textureSettings(store.reader.getState().docs[path]),
  }
})

function setFilter(path: string, filter: 'nearest' | 'linear'): void {
  harness.store.editDocument(path, { label: 'Filtering', merge: `${path}#filter` }, (document) => {
    if (document.importSettings.type === 'texture') document.importSettings.filter = filter
  })
}

function setFrameWidth(path: string, frameWidth: number): void {
  harness.store.editDocument(path, { label: 'Frame width', merge: `${path}#frameWidth` }, (document) => {
    if (document.importSettings.type !== 'texture') return
    document.importSettings.slice = {
      mode: 'grid',
      frameWidth,
      frameHeight: 16,
      margin: 0,
      spacing: 0,
    }
  })
}

function setPivotX(path: string, x: number): void {
  harness.store.editDocument(path, { label: 'Pivot', merge: `${path}#pivot.x` }, (document) => {
    if (document.importSettings.type === 'texture') document.importSettings.pivot.x = x
  })
}

describe('changing a setting', () => {
  it('changes it, and reversing puts it back', () => {
    setFilter(KNIGHT, 'linear')
    expect(harness.settings(KNIGHT).filter).toBe('linear')

    harness.store.undo()
    expect(harness.settings(KNIGHT).filter).toBe('nearest')

    harness.store.redo()
    expect(harness.settings(KNIGHT).filter).toBe('linear')
  })

  it('leaves every other document alone', () => {
    const before = harness.docs()[SLIME]

    setFilter(KNIGHT, 'linear')

    expect(harness.docs()[SLIME]).toBe(before)
  })

  it('does nothing at all when the value is the one already there', () => {
    setFilter(KNIGHT, 'nearest')

    expect(harness.store.peekUndo()).toBeNull()
    expect(harness.store.undo()).toBe(false)
  })

  it('does nothing for a document this window has not loaded', () => {
    setFilter('assets/textures/never-opened.png', 'linear')

    expect(harness.store.peekUndo()).toBeNull()
  })

  it('refuses to be changed except through a transaction', () => {
    setFilter(KNIGHT, 'linear')
    const document = harness.docs()[KNIGHT]

    // The runtime half of keeping the direct-mutation path shut: a panel that
    // assigns to a document fails on the spot rather than leaving the store and
    // the undo stack quietly out of step (editor-kernel G2).
    expect(() => {
      ;(document as AssetMeta).id = 'tampered'
    }).toThrow()
  })
})

describe('one undo stack for the whole project, ordered by time', () => {
  it('reverses across files, most recent first, whatever is selected', () => {
    setPivotX(KNIGHT, 0.25)
    harness.advance(1_000)
    setFilter(SLIME, 'linear')

    expect(harness.store.undo()).toBe(true)
    expect(harness.settings(SLIME).filter).toBe('nearest')
    expect(harness.settings(KNIGHT).pivot.x).toBe(0.25)

    expect(harness.store.undo()).toBe(true)
    expect(harness.settings(KNIGHT).pivot.x).toBe(0.5)
  })

  it('runs out rather than pretending, once everything has been reversed', () => {
    setFilter(KNIGHT, 'linear')

    expect(harness.store.undo()).toBe(true)
    expect(harness.store.undo()).toBe(false)
  })

  it('forgets what was reversed once something new is changed', () => {
    setFilter(KNIGHT, 'linear')
    harness.store.undo()
    expect(harness.store.peekRedo()).toBe('Filtering')

    harness.advance(1_000)
    setPivotX(SLIME, 0.25)

    expect(harness.store.peekRedo()).toBeNull()
    expect(harness.store.redo()).toBe(false)
  })

  it('names what would be reversed, so anything that wants to say so can', () => {
    setPivotX(KNIGHT, 0.25)

    expect(harness.store.peekUndo()).toBe('Pivot')
  })
})

describe('what counts as one step while typing', () => {
  it('merges a run of edits to the same field into one', () => {
    setFrameWidth(KNIGHT, 2)
    harness.advance(50)
    setFrameWidth(KNIGHT, 24)

    harness.store.undo()

    expect(harness.settings(KNIGHT).slice).toEqual({ mode: 'single' })
    expect(harness.store.undo()).toBe(false)
  })

  it('starts a new step once the human has paused', () => {
    setFrameWidth(KNIGHT, 2)
    harness.advance(1_000)
    setFrameWidth(KNIGHT, 24)

    harness.store.undo()

    expect(harness.settings(KNIGHT).slice).toMatchObject({ frameWidth: 2 })
  })

  it('starts a new step when the human moves to a different field', () => {
    setFrameWidth(KNIGHT, 24)
    setPivotX(KNIGHT, 0.25)

    harness.store.undo()

    expect(harness.settings(KNIGHT).pivot.x).toBe(0.5)
    expect(harness.settings(KNIGHT).slice).toMatchObject({ frameWidth: 24 })
  })

  it('starts a new step when the field is left, however fast the human comes back', () => {
    setFrameWidth(KNIGHT, 2)
    harness.store.sealEdits()
    setFrameWidth(KNIGHT, 24)

    harness.store.undo()

    expect(harness.settings(KNIGHT).slice).toMatchObject({ frameWidth: 2 })
  })

  it('never merges the same field across two different files', () => {
    setFilter(KNIGHT, 'linear')
    setFilter(SLIME, 'linear')

    harness.store.undo()

    expect(harness.settings(SLIME).filter).toBe('nearest')
    expect(harness.settings(KNIGHT).filter).toBe('linear')
  })

  /**
   * A merged step reverses to where the run started, not to where its last
   * edit started. Getting this wrong survives every test written against a
   * single field being replaced twice, and fails the first time a run touches
   * more than one key — which is exactly what a frame-size run does.
   */
  it('reverses a merged run to where the run began, not to the middle of it', () => {
    setFrameWidth(KNIGHT, 2)
    harness.advance(50)
    setFrameWidth(KNIGHT, 24)
    harness.advance(50)
    setFrameWidth(KNIGHT, 240)

    harness.store.undo()

    expect(harness.settings(KNIGHT).slice).toEqual({ mode: 'single' })
  })

  it('seals the run when something is reversed, so redo does not swallow the next edit', () => {
    setFrameWidth(KNIGHT, 24)
    harness.store.undo()
    harness.store.redo()
    setFrameWidth(KNIGHT, 48)

    harness.store.undo()

    expect(harness.settings(KNIGHT).slice).toMatchObject({ frameWidth: 24 })
  })
})

describe('saving what changed', () => {
  it('writes the file after a change, and after reversing one', async () => {
    setFilter(KNIGHT, 'linear')
    await harness.store.flushSaves()

    expect(harness.writes.map((write) => write.path)).toEqual([KNIGHT])
    expect(textureSettings(harness.writes[0]?.document).filter).toBe('linear')

    harness.store.undo()
    await harness.store.flushSaves()

    expect(textureSettings(harness.writes[1]?.document).filter).toBe('nearest')
  })

  it('writes nothing when a change is reversed before it lands', async () => {
    const store = createDocumentStore({
      saveDebounceMs: 50,
      writeToDisk: async (path, document) => {
        harness.writes.push({ path, document })
      },
    })
    adopt(store, KNIGHT, textureMeta('1111111111111111'))

    store.editDocument(KNIGHT, { label: 'Filtering' }, (document) => {
      if (document.importSettings.type === 'texture') document.importSettings.filter = 'linear'
    })
    store.undo()
    await store.flushSaves()

    expect(harness.writes).toEqual([])
  })

  it('says which file could not be saved, rather than failing quietly', async () => {
    harness.failNextWrite('The editor service would not save these settings.')

    setFilter(KNIGHT, 'linear')
    await harness.store.flushSaves()

    expect(harness.store.reader.getState().saveFailures[KNIGHT]).toContain('would not save')
  })

  it('does not keep hammering a service that refused, and waits to be asked again', async () => {
    harness.failNextWrite('nope')

    setFilter(KNIGHT, 'linear')
    await harness.store.flushSaves()

    expect(harness.attempts()).toBe(1)
  })

  it('forgets the failure once a save works', async () => {
    harness.failNextWrite('nope')
    setFilter(KNIGHT, 'linear')
    await harness.store.flushSaves()

    harness.advance(1_000)
    setPivotX(KNIGHT, 0.25)
    await harness.store.flushSaves()

    expect(harness.store.reader.getState().saveFailures[KNIGHT]).toBeUndefined()
  })
})

describe('the file changing on disk while the editor has it', () => {
  it('takes the new value, because disk wins', () => {
    const edited: AssetMeta = {
      ...textureMeta('1111111111111111'),
      importSettings: { type: 'texture', filter: 'linear', pivot: { x: 0, y: 0 }, slice: { mode: 'single' } },
    }

    adopt(harness.store, KNIGHT, edited)

    expect(harness.settings(KNIGHT).filter).toBe('linear')
  })

  it('is not an edit, so it is not on the undo stack', () => {
    adopt(harness.store, KNIGHT, textureMeta('changed-on-disk'))

    expect(harness.store.peekUndo()).toBeNull()
  })

  it('keeps a key the schema does not model, because the document is the file', () => {
    const handEdited = { ...textureMeta('1111111111111111'), myOwnNote: 'frame 3' } as AssetMeta

    adopt(harness.store, KNIGHT, handEdited)
    setFilter(KNIGHT, 'linear')

    expect(harness.docs()[KNIGHT]).toMatchObject({ myOwnNote: 'frame 3' })
  })

  it('ignores what comes back while this editor has a change of its own in hand', async () => {
    const store = createDocumentStore({
      saveDebounceMs: 50,
      writeToDisk: async () => undefined,
    })
    adopt(store, KNIGHT, textureMeta('1111111111111111'))

    store.editDocument(KNIGHT, { label: 'Filtering' }, (document) => {
      if (document.importSettings.type === 'texture') document.importSettings.filter = 'linear'
    })
    // The folder re-read arriving mid-keystroke, carrying the file as it was
    // before the write. Adopting it here would undo what was just typed.
    adopt(store, KNIGHT, textureMeta('1111111111111111'))

    expect(textureSettings(store.reader.getState().docs[KNIGHT]).filter).toBe('linear')
    await store.flushSaves()
  })

  it('holds on to a change the folder never got, rather than letting a re-read discard it', async () => {
    harness.failNextWrite('nope')
    setFilter(KNIGHT, 'linear')
    await harness.store.flushSaves()

    // The folder re-read arrives carrying the file as it still is, because the
    // write was refused. Taking it would throw away the human's change and the
    // only sign on screen that anything had gone wrong.
    adopt(harness.store, KNIGHT, textureMeta('1111111111111111'))

    expect(harness.settings(KNIGHT).filter).toBe('linear')
  })

  /**
   * The write / watch / re-read cycle, in one test: the editor writes, the
   * change comes back round, and adopting it changes nothing — so nothing is
   * written a second time and the cycle stops on its first pass.
   */
  it('settles when the editor hears its own write come back', async () => {
    setFilter(KNIGHT, 'linear')
    await harness.store.flushSaves()
    expect(harness.writes).toHaveLength(1)

    const echoed = harness.writes[0]?.document
    if (echoed === undefined) throw new Error('nothing was written')
    // Read after the write, so it is the identity of the round trip that makes
    // this settle rather than the staleness guard below.
    harness.advance(500)
    adopt(harness.store, KNIGHT, JSON.parse(JSON.stringify(echoed)) as Document)
    await harness.store.flushSaves()

    expect(harness.writes).toHaveLength(1)
  })

  /**
   * The failure this guards against is the nastiest one in the feature, because
   * every part of it looks correct: a folder re-read sets off, the editor writes
   * the file, the read comes back carrying the contents from *before* the write,
   * and taking it reverts the change and then writes the reversion to disk. On
   * screen the setting simply does not stick, and nothing anywhere reports an
   * error.
   */
  it('ignores an answer to a question asked before its own write', async () => {
    // A read of the folder that sets off now...
    const readStartedAt = harness.store.beginRead()

    harness.advance(10)
    setFilter(KNIGHT, 'linear')
    await harness.store.flushSaves()

    // ...and is answered only now, carrying the file as it was beforehand.
    harness.advance(10)
    harness.store.adoptFromDisk(KNIGHT, textureMeta('1111111111111111'), readStartedAt)
    await harness.store.flushSaves()

    expect(harness.settings(KNIGHT).filter).toBe('linear')
    expect(harness.writes).toHaveLength(1)
  })
})

describe('comparing two documents', () => {
  it.each([
    ['the same object', { a: 1 }, { a: 1 }],
    ['keys written in a different order', { a: 1, b: 2 }, { b: 2, a: 1 }],
    ['nested sameness', { a: { b: [1, 2] } }, { a: { b: [1, 2] } }],
  ])('calls %s the same', (_description, a, b) => {
    expect(sameJson(a, b)).toBe(true)
  })

  it.each([
    ['a changed value', { a: 1 }, { a: 2 }],
    ['an extra key', { a: 1 }, { a: 1, b: 2 }],
    ['a missing key', { a: 1, b: 2 }, { a: 1 }],
    ['a shorter list', { a: [1, 2] }, { a: [1] }],
    ['nothing at all', { a: 1 }, undefined],
  ])('calls %s different', (_description, a, b) => {
    expect(sameJson(a, b)).toBe(false)
  })
})
