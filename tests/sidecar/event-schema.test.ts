import { describe, expect, it } from 'vitest'

import {
  FileEventMessageSchema,
  toFileEventMessage,
  type FileEventMessage,
} from '../../sidecar/event-schema.js'

/**
 * The round-trip tripwire (editor-kernel G1) for the format the change feed
 * carries. This one crosses a process boundary as text every time it is used,
 * so drift here would show up as the editor quietly ignoring changes.
 */
describe('the change-event format survives a round trip', () => {
  const message: FileEventMessage = {
    format: 'kernel2d.file-event',
    version: 1,
    kind: 'added',
    path: 'assets/textures/knight.png',
    isDirectory: false,
    size: 12_700,
    at: 1_760_000_000_000,
  }

  it('reads back identical to what was written', () => {
    expect(FileEventMessageSchema.parse(JSON.parse(JSON.stringify(message)))).toEqual(message)
  })

  it('wraps a watcher event without changing anything about it', () => {
    const wrapped = toFileEventMessage({
      kind: 'removed',
      path: 'scenes/level-01.json',
      isDirectory: false,
      size: null,
      at: 1_760_000_000_000,
    })

    expect(FileEventMessageSchema.parse(wrapped)).toEqual(wrapped)
    expect(wrapped.kind).toBe('removed')
    expect(wrapped.size).toBeNull()
  })

  it('carries a removal, which has no size to report', () => {
    const removal = { ...message, kind: 'removed' as const, size: null }

    expect(FileEventMessageSchema.parse(JSON.parse(JSON.stringify(removal)))).toEqual(removal)
  })

  it('carries a folder appearing', () => {
    const folder = { ...message, path: 'assets/models', isDirectory: true, size: null }

    expect(FileEventMessageSchema.parse(JSON.parse(JSON.stringify(folder)))).toEqual(folder)
  })
})

describe('the change-event format rejects what it should', () => {
  const valid = {
    format: 'kernel2d.file-event',
    version: 1,
    kind: 'changed',
    path: 'scenes/level-01.json',
    isDirectory: false,
    size: 2,
    at: 1_760_000_000_000,
  }

  it('accepts a well-formed event written by hand', () => {
    expect(() => FileEventMessageSchema.parse(valid)).not.toThrow()
  })

  it('rejects an event from a format version it does not know', () => {
    expect(() => FileEventMessageSchema.parse({ ...valid, version: 2 })).toThrow()
  })

  it('rejects a kind of change it has no meaning for', () => {
    expect(() => FileEventMessageSchema.parse({ ...valid, kind: 'renamed' })).toThrow()
  })

  it('rejects an event about nothing in particular', () => {
    expect(() => FileEventMessageSchema.parse({ ...valid, path: '' })).toThrow()
  })
})
