import { describe, expect, it } from 'vitest'

import { FileChangeSchema, type FileChange } from '../../sidecar/file-change-schema.js'

/**
 * The round-trip tripwire (editor-kernel G1) for the answer `POST /move` and
 * `POST /delete` give, and the rejections that make it a contract rather than a
 * suggestion.
 */

const moved: FileChange = {
  format: 'kernel2d.file-change',
  version: 1,
  kind: 'moved',
  path: 'assets/textures/knight.png',
  to: 'assets/sprites/hero.png',
  isDirectory: false,
  settings: 'assets/textures/knight.png.meta',
}

const deleted: FileChange = {
  format: 'kernel2d.file-change',
  version: 1,
  kind: 'deleted',
  path: 'assets/audio/jump.wav',
  to: null,
  isDirectory: false,
  settings: 'assets/audio/jump.wav.meta',
}

describe('the file-change format survives a round trip', () => {
  it('reads a move back identical to what was written', () => {
    expect(FileChangeSchema.parse(JSON.parse(JSON.stringify(moved)))).toEqual(moved)
  })

  it('reads a delete back identical to what was written', () => {
    expect(FileChangeSchema.parse(JSON.parse(JSON.stringify(deleted)))).toEqual(deleted)
  })
})

describe('the file-change format rejects what it should', () => {
  it('rejects a version it does not know', () => {
    expect(() => FileChangeSchema.parse({ ...moved, version: 2 })).toThrow()
  })

  it('rejects something that happened to a file it cannot name', () => {
    expect(() => FileChangeSchema.parse({ ...moved, path: '' })).toThrow()
  })

  it('rejects a kind of change this service does not make', () => {
    expect(() => FileChangeSchema.parse({ ...moved, kind: 'copied' })).toThrow()
  })

  it('rejects some other answer arriving at the same call site', () => {
    expect(() => FileChangeSchema.parse({ error: 'that path is taken' })).toThrow()
  })
})
