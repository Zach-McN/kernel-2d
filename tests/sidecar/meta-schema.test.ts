import { describe, expect, it } from 'vitest'

import {
  ASSET_TYPE_BY_EXTENSION,
  AssetMetaSchema,
  annotatedPathFor,
  assetTypeForName,
  defaultMeta,
  isMetaFileName,
  metaPathFor,
  serializeMeta,
  type AssetMeta,
} from '../../runtime/formats/meta-schema.js'

/**
 * The round-trip tripwire (editor-kernel G1, editor-verification V7) for the
 * `.meta` format, in place from the moment the format exists — before there is
 * a second writer of it, which is when drift starts and starts silently.
 *
 * Every comparison is against the *original* object, never against a re-parse
 * of the round-tripped one: that is the comparison that fails when a writer
 * emits a field the schema does not know (text-formats F1).
 */

const texture: AssetMeta = {
  format: 'kernel2d.asset-meta',
  version: 1,
  id: '8f2a1c94d6b30e57',
  type: 'texture',
  importSettings: {
    type: 'texture',
    filter: 'nearest',
    pivot: { x: 0.5, y: 1 },
    slice: { mode: 'grid', frameWidth: 16, frameHeight: 16, margin: 0, spacing: 0 },
  },
}

const audio: AssetMeta = {
  format: 'kernel2d.asset-meta',
  version: 1,
  id: 'aabbccdd00112233',
  type: 'audio',
  importSettings: { type: 'audio' },
}

const font: AssetMeta = { ...audio, id: '0011223344556677', type: 'font', importSettings: { type: 'font' } }
const other: AssetMeta = { ...audio, id: '7766554433221100', type: 'other', importSettings: { type: 'other' } }

const generated: AssetMeta = {
  ...texture,
  generatedBy: 'claude-opus-5',
  generatedAt: '2026-08-11',
}

describe('a .meta survives a round trip', () => {
  it.each([
    ['a sliced texture', texture],
    ['a single-frame texture', defaultMeta('texture', 'ffffffffffffffff')],
    ['a sound', audio],
    ['a font', font],
    ['a file the editor does not import', other],
    ['one an AI produced', generated],
  ])('reads back identical for %s', (_description, meta) => {
    expect(AssetMetaSchema.parse(JSON.parse(JSON.stringify(meta)))).toEqual(meta)
  })

  it('survives the trip through the text that is actually written to disk', () => {
    expect(AssetMetaSchema.parse(JSON.parse(serializeMeta(generated)))).toEqual(generated)
  })

  it('keeps the generated marking, because dropping it destroys provenance', () => {
    const roundTripped = AssetMetaSchema.parse(JSON.parse(serializeMeta(generated)))

    expect(roundTripped.generatedBy).toBe('claude-opus-5')
    expect(roundTripped.generatedAt).toBe('2026-08-11')
  })

  it('is written as readable, line-at-a-time text', () => {
    const written = serializeMeta(generated)

    expect(written.split('\n').length).toBeGreaterThan(5)
    expect(written.endsWith('\n')).toBe(true)
  })
})

describe('a .meta keeps what a human put in it by hand', () => {
  /**
   * The point of this block: the editor rewrites a `.meta` from the object it
   * parsed, so anything the parse drops is deleted from a file the human wrote.
   * A strict schema drops silently and the round-trip test above still passes,
   * because it only ever compares fields the schema knows about — which is
   * exactly the trap text-formats F1 describes. These compare against the
   * original object, extra keys and all.
   */
  const handEdited = {
    ...texture,
    myOwnNote: 'the walk cycle starts on frame 3',
    importSettings: {
      ...texture.importSettings,
      teamColourMask: true,
      pivot: { x: 0.5, y: 1, comment: 'feet' },
      slice: { mode: 'grid', frameWidth: 16, frameHeight: 16, margin: 0, spacing: 0, rows: 4 },
    },
  }

  it('keeps a key at the top level', () => {
    expect(AssetMetaSchema.parse(JSON.parse(JSON.stringify(handEdited)))).toEqual(handEdited)
  })

  it('keeps one nested inside the settings, the pivot and the slice too', () => {
    const roundTripped = AssetMetaSchema.parse(JSON.parse(serializeMeta(handEdited as AssetMeta)))

    expect(roundTripped).toEqual(handEdited)
  })

  it('survives being written, read, and written again unchanged', () => {
    const once = serializeMeta(AssetMetaSchema.parse(JSON.parse(serializeMeta(handEdited as AssetMeta))))
    const twice = serializeMeta(AssetMetaSchema.parse(JSON.parse(once)))

    // The same property that stops serialization drift is what stops the
    // editor's write/watch/re-read cycle feeding itself: the round trip is
    // identity, so writing back what came back changes nothing.
    expect(twice).toBe(once)
  })
})

describe('a .meta rejects what it should', () => {
  it('accepts one written by hand with an id a person chose', () => {
    expect(() => AssetMetaSchema.parse({ ...audio, id: 'the-menu-theme' })).not.toThrow()
  })

  it('refuses a version it does not know, rather than reading it on a hope', () => {
    expect(() => AssetMetaSchema.parse({ ...texture, version: 2 })).toThrow()
  })

  it('refuses a document that is not a .meta at all', () => {
    expect(() => AssetMetaSchema.parse({ generatedBy: 'claude-opus-5', generatedAt: '2026-08-11' })).toThrow()
  })

  it('refuses a sheet that does not say how big its frames are', () => {
    expect(() =>
      AssetMetaSchema.parse({
        ...texture,
        importSettings: { ...texture.importSettings, slice: { mode: 'grid' } },
      }),
    ).toThrow()
  })

  it('refuses settings that disagree with the type they are filed under', () => {
    expect(() => AssetMetaSchema.parse({ ...texture, type: 'audio' })).toThrow()
  })

  it('refuses a file with no id', () => {
    expect(() => AssetMetaSchema.parse({ ...audio, id: '' })).toThrow()
  })
})

describe('what the editor calls a file', () => {
  it.each([
    ['knight.png', 'texture'],
    ['KNIGHT.PNG', 'texture'],
    ['tileset.webp', 'texture'],
    ['jump.wav', 'audio'],
    ['theme.ogg', 'audio'],
    ['pixel-8.fnt', 'font'],
    ['ui.ttf', 'font'],
  ])('%s is a %s', (name, type) => {
    expect(assetTypeForName(name)).toBe(type)
  })

  it.each([['README.txt'], ['level-01.json'], ['notes'], ['.gitignore'], ['knight.blend']])(
    '%s is not something the editor imports',
    (name) => {
      expect(assetTypeForName(name)).toBeNull()
    },
  )

  it('never treats a sidecar as an asset, so a .meta cannot get a .meta', () => {
    expect(assetTypeForName('knight.png.meta')).toBeNull()
    expect(isMetaFileName('knight.png.meta')).toBe(true)
  })

  it('pairs a file with its sidecar in both directions', () => {
    expect(metaPathFor('assets/textures/knight.png')).toBe('assets/textures/knight.png.meta')
    expect(annotatedPathFor('assets/textures/knight.png.meta')).toBe('assets/textures/knight.png')
    expect(annotatedPathFor('assets/textures/knight.png')).toBeNull()
  })

  it('lists every extension in lower case with its leading dot, so lookups cannot miss', () => {
    for (const extension of Object.keys(ASSET_TYPE_BY_EXTENSION)) {
      expect(extension).toBe(extension.toLowerCase())
      expect(extension.startsWith('.')).toBe(true)
    }
  })
})

describe('the settings a file starts life with', () => {
  it('gives a texture crisp pixels, a centred pivot and one frame', () => {
    const meta = defaultMeta('texture', 'abc123')

    expect(meta.importSettings).toEqual({
      type: 'texture',
      filter: 'nearest',
      pivot: { x: 0.5, y: 0.5 },
      slice: { mode: 'single' },
    })
  })

  it.each([['audio'], ['font'], ['other']] as const)('gives a %s nothing to tune yet', (type) => {
    expect(defaultMeta(type, 'abc123').importSettings).toEqual({ type })
  })

  it('produces something the schema accepts, for every kind', () => {
    for (const type of ['texture', 'audio', 'font', 'other'] as const) {
      expect(() => AssetMetaSchema.parse(defaultMeta(type, 'abc123'))).not.toThrow()
    }
  })
})
