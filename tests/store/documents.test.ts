import { beforeEach, describe, expect, it } from 'vitest'

import {
  createDocumentStore,
  sameJson,
  type Document,
  type DocumentStore,
} from '../../editor/store/documents'
import {
  ASSET_META_FORMAT,
  defaultMeta,
  type AssetMeta,
  type TextureImportSettings,
} from '../../runtime/formats/meta-schema'
import {
  SCENE_FORMAT,
  defaultEntity,
  defaultScene,
  spriteOf,
  type Entity,
  type Scene,
} from '../../runtime/formats/scene-schema'

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
const LEVEL = 'scenes/level-01.json'

function textureMeta(id: string): AssetMeta {
  return defaultMeta('texture', id)
}

function textureSettings(document: Document | undefined): TextureImportSettings {
  if (document === undefined || document.format !== ASSET_META_FORMAT) throw new Error('not import settings')
  const settings = document.importSettings
  if (settings.type !== 'texture') throw new Error('not a texture')
  return settings
}

function asScene(document: Document | undefined): Scene {
  if (document === undefined || document.format !== SCENE_FORMAT) throw new Error('not a scene')
  return document
}

/**
 * A read of the folder, the way the real caller does it: the token is taken
 * before the question is asked and handed back with the answer, which is what
 * lets the store tell a fresh answer from one that set off before its own last
 * write.
 */
function adopt(store: DocumentStore, path: string, document: Document): void {
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
  scene: (path: string) => Scene
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
  adopt(store, LEVEL, {
    ...defaultScene(),
    entities: [knightEntity('aaaa000000000000', 'Knight'), knightEntity('bbbb000000000000', 'Slime')],
  })

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
    scene: (path) => asScene(store.reader.getState().docs[path]),
  }
})

function knightEntity(id: string, name: string): Entity {
  return {
    ...defaultEntity(id, name),
    components: { sprite: { texture: { id: '1111111111111111', path: KNIGHT } } },
  }
}

function setFilter(path: string, filter: 'nearest' | 'linear'): void {
  harness.store.editDocument(path, { label: 'Filtering', merge: `${path}#filter` }, (document) => {
    if (document.format !== ASSET_META_FORMAT) return
    if (document.importSettings.type === 'texture') document.importSettings.filter = filter
  })
}

function setFrameWidth(path: string, frameWidth: number): void {
  harness.store.editDocument(path, { label: 'Frame width', merge: `${path}#frameWidth` }, (document) => {
    if (document.format !== ASSET_META_FORMAT) return
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
    if (document.format !== ASSET_META_FORMAT) return
    if (document.importSettings.type === 'texture') document.importSettings.pivot.x = x
  })
}

/**
 * The four things the Hierarchy does, as the store sees them.
 *
 * Written here in the same shape the panel writes them, because the point of
 * these is that adding and deleting an entity are *edits* like any other. A
 * tool that reached past the transaction API to create something would look
 * like it worked and would take undo out with it (editor-kernel G2), and
 * creating is where the temptation is, because it feels different from editing.
 */
function addEntity(path: string, id: string, name: string): void {
  harness.store.editDocument(path, { label: 'Add entity' }, (document) => {
    if (document.format !== SCENE_FORMAT) return
    document.entities.push(defaultEntity(id, name))
  })
}

function deleteEntity(path: string, id: string): void {
  harness.store.editDocument(path, { label: 'Delete entity' }, (document) => {
    if (document.format !== SCENE_FORMAT) return
    const at = document.entities.findIndex((entity) => entity.id === id)
    if (at >= 0) document.entities.splice(at, 1)
  })
}

function moveEntity(path: string, id: string, by: number): void {
  harness.store.editDocument(path, { label: 'Reorder entity' }, (document) => {
    if (document.format !== SCENE_FORMAT) return
    const at = document.entities.findIndex((entity) => entity.id === id)
    const to = at + by
    if (at < 0 || to < 0 || to >= document.entities.length) return
    const [moved] = document.entities.splice(at, 1)
    if (moved !== undefined) document.entities.splice(to, 0, moved)
  })
}

function setEntityX(path: string, id: string, x: number): void {
  harness.store.editDocument(path, { label: 'Position', merge: `${path}#${id}#x` }, (document) => {
    if (document.format !== SCENE_FORMAT) return
    const entity = document.entities.find((candidate) => candidate.id === id)
    if (entity !== undefined) entity.transform.x = x
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

/**
 * Calling a gesture off, which is a different thing from reversing it.
 *
 * A grab in the viewport is a run of edits that the human can decide never
 * happened. The tempting implementation — write the old position back — ends at
 * the right document and leaves a step on the stack that reverses nothing, so
 * the next press of Ctrl-Z appears to do nothing at all. These are the cases
 * that pin the difference.
 */
describe('taking a run of edits back', () => {
  /** One move of a gesture, keyed the way the viewport keys one: per gesture. */
  function moveTo(id: string, x: number, gesture: string): void {
    harness.store.editDocument(LEVEL, { label: 'Move entity', merge: gesture }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      const entity = document.entities.find((candidate) => candidate.id === id)
      if (entity !== undefined) entity.transform.x = x
    })
  }

  it('puts the document back where the run started', () => {
    moveTo('aaaa000000000000', 40, 'move1')
    moveTo('aaaa000000000000', 90, 'move1')

    expect(harness.store.abandonEdits('move1')).toBe(true)

    expect(harness.scene(LEVEL).entities[0]?.transform.x).toBe(0)
  })

  it('leaves no step behind, so the next Ctrl-Z reverses what came before it', () => {
    setFilter(KNIGHT, 'linear')
    harness.advance(1_000)
    moveTo('aaaa000000000000', 90, 'move1')

    harness.store.abandonEdits('move1')
    harness.store.undo()

    expect(harness.settings(KNIGHT).filter).toBe('nearest')
  })

  /**
   * The one that decides the merge key has to be minted per gesture rather than
   * per field. A run that paused for longer than the merge window is two steps,
   * and taking back half of a cancelled move is worse than taking back none.
   */
  it('takes back every step of a run that paused long enough to split', () => {
    moveTo('aaaa000000000000', 40, 'move1')
    harness.advance(5_000)
    moveTo('aaaa000000000000', 90, 'move1')

    harness.store.abandonEdits('move1')

    expect(harness.scene(LEVEL).entities[0]?.transform.x).toBe(0)
    expect(harness.store.peekUndo()).toBeNull()
  })

  it('stops at a run that is not this one, however the keys were minted', () => {
    moveTo('aaaa000000000000', 40, 'move1')
    harness.advance(5_000)
    moveTo('aaaa000000000000', 90, 'move2')

    harness.store.abandonEdits('move2')

    // The first gesture was somebody else's and stands, at exactly where it
    // left the entity.
    expect(harness.scene(LEVEL).entities[0]?.transform.x).toBe(40)
    expect(harness.store.peekUndo()).toBe('Move entity')
  })

  it('says so, and changes nothing, when there was nothing to take back', () => {
    setFilter(KNIGHT, 'linear')

    expect(harness.store.abandonEdits('move1')).toBe(false)
    expect(harness.settings(KNIGHT).filter).toBe('linear')
  })

  it('writes the restored document to disk, because the folder saw the run', async () => {
    moveTo('aaaa000000000000', 90, 'move1')
    await harness.store.flushSaves()

    harness.store.abandonEdits('move1')
    await harness.store.flushSaves()

    expect(asScene(harness.writes.at(-1)?.document).entities[0]?.transform.x).toBe(0)
  })

  it('seals what it did not take back, so the next edit is a step of its own', () => {
    moveTo('aaaa000000000000', 40, 'move1')
    harness.store.abandonEdits('other')
    moveTo('aaaa000000000000', 90, 'move1')

    harness.store.undo()

    expect(harness.scene(LEVEL).entities[0]?.transform.x).toBe(40)
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
      if (document.format !== ASSET_META_FORMAT) return
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
      if (document.format !== ASSET_META_FORMAT) return
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

/**
 * A second format in the same store.
 *
 * The point of this block is what it does *not* need: not one line of undo,
 * merging, saving or staleness logic was written for scenes. Everything here
 * passes because the store holds documents rather than import settings, which
 * is the whole bet of document-level undo (editor-kernel D7).
 */
describe('a scene is a document like any other', () => {
  it('shares one stack with a texture, ordered by time rather than by kind', () => {
    setFilter(KNIGHT, 'linear')
    harness.advance(1_000)
    setEntityX(LEVEL, 'aaaa000000000000', 200)

    harness.store.undo()
    expect(harness.scene(LEVEL).entities[0]?.transform.x).toBe(0)
    expect(harness.settings(KNIGHT).filter).toBe('linear')

    harness.store.undo()
    expect(harness.settings(KNIGHT).filter).toBe('nearest')
  })

  it('goes to disk on the same terms, and reversing writes it back', async () => {
    setEntityX(LEVEL, 'aaaa000000000000', 200)
    await harness.store.flushSaves()

    expect(harness.writes.map((write) => write.path)).toEqual([LEVEL])
    expect(asScene(harness.writes[0]?.document).entities[0]?.transform.x).toBe(200)

    harness.store.undo()
    await harness.store.flushSaves()

    expect(asScene(harness.writes[1]?.document).entities[0]?.transform.x).toBe(0)
  })

  it('merges a run of keystrokes in one field into one press of Ctrl-Z', () => {
    setEntityX(LEVEL, 'aaaa000000000000', 2)
    harness.advance(50)
    setEntityX(LEVEL, 'aaaa000000000000', 24)
    harness.advance(50)
    setEntityX(LEVEL, 'aaaa000000000000', 240)

    harness.store.undo()

    expect(harness.scene(LEVEL).entities[0]?.transform.x).toBe(0)
    expect(harness.store.undo()).toBe(false)
  })

  it('never merges the same field across two entities', () => {
    setEntityX(LEVEL, 'aaaa000000000000', 100)
    setEntityX(LEVEL, 'bbbb000000000000', 200)

    harness.store.undo()

    expect(harness.scene(LEVEL).entities[1]?.transform.x).toBe(0)
    expect(harness.scene(LEVEL).entities[0]?.transform.x).toBe(100)
  })

  it('keeps a component the kernel has never heard of through an edit', () => {
    const withPatrol: Scene = {
      ...defaultScene(),
      entities: [
        {
          ...knightEntity('aaaa000000000000', 'Knight'),
          components: {
            sprite: { texture: { id: '1111111111111111', path: KNIGHT } },
            patrolRoute: { waypoints: [{ x: 10, y: 0 }] },
          },
        },
      ],
    }
    adopt(harness.store, LEVEL, withPatrol)

    setEntityX(LEVEL, 'aaaa000000000000', 200)

    expect(harness.scene(LEVEL).entities[0]?.components['patrolRoute']).toEqual({
      waypoints: [{ x: 10, y: 0 }],
    })
  })
})

/**
 * Adding and deleting through the transaction API and nothing else.
 *
 * This is the block worth having, because creating something feels different
 * from editing it and is where a session is most likely to reach past the API —
 * and a tool that writes its own inverse is a defect whether or not it appears
 * to work.
 */
describe('adding, deleting and reordering an entity', () => {
  it('adds one, and one press of Ctrl-Z takes it away again', () => {
    addEntity(LEVEL, 'cccc000000000000', 'Torch')

    expect(harness.scene(LEVEL).entities.map((entity) => entity.name)).toEqual(['Knight', 'Slime', 'Torch'])

    harness.store.undo()

    expect(harness.scene(LEVEL).entities.map((entity) => entity.name)).toEqual(['Knight', 'Slime'])
  })

  it('deletes one, and reversing brings it back with everything it had', () => {
    deleteEntity(LEVEL, 'aaaa000000000000')
    expect(harness.scene(LEVEL).entities.map((entity) => entity.id)).toEqual(['bbbb000000000000'])

    harness.store.undo()

    const restored = harness.scene(LEVEL).entities[0]
    expect(restored?.id).toBe('aaaa000000000000')
    expect(spriteOf(restored as Entity)?.texture.path).toBe(KNIGHT)
  })

  it('moves one down the list, changing what is drawn in front', () => {
    moveEntity(LEVEL, 'aaaa000000000000', 1)

    // List order is draw order, so this is the whole of "bring it forward".
    expect(harness.scene(LEVEL).entities.map((entity) => entity.name)).toEqual(['Slime', 'Knight'])

    harness.store.undo()

    expect(harness.scene(LEVEL).entities.map((entity) => entity.name)).toEqual(['Knight', 'Slime'])
  })

  it('does nothing at the ends of the list, rather than wrapping around', () => {
    moveEntity(LEVEL, 'aaaa000000000000', -1)
    moveEntity(LEVEL, 'bbbb000000000000', 1)

    expect(harness.scene(LEVEL).entities.map((entity) => entity.name)).toEqual(['Knight', 'Slime'])
    // Nothing changed, so there is nothing to reverse — an undo step that
    // reverses nothing is a step Ctrl-Z appears to skip.
    expect(harness.store.peekUndo()).toBeNull()
  })

  it('writes the file after each of them, the same as any other edit', async () => {
    addEntity(LEVEL, 'cccc000000000000', 'Torch')
    await harness.store.flushSaves()
    expect(asScene(harness.writes.at(-1)?.document).entities).toHaveLength(3)

    deleteEntity(LEVEL, 'cccc000000000000')
    await harness.store.flushSaves()
    expect(asScene(harness.writes.at(-1)?.document).entities).toHaveLength(2)
  })

  it('is a separate step per action, so undo unwinds them one at a time', () => {
    addEntity(LEVEL, 'cccc000000000000', 'Torch')
    addEntity(LEVEL, 'dddd000000000000', 'Chest')

    harness.store.undo()
    expect(harness.scene(LEVEL).entities).toHaveLength(3)

    harness.store.undo()
    expect(harness.scene(LEVEL).entities).toHaveLength(2)
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
