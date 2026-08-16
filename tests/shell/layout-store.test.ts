import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  forgetLayout,
  lastProject,
  readLayout,
  rememberProject,
  writeLayout,
} from '../../editor/shell/layout-store'

/**
 * Where the window remembers its arrangement. Two properties carry it: each
 * half (the dock, the Assets panel) can be written without knowing about the
 * other, and anything unusable in storage is a default rather than an error.
 */

const PROJECT = 'C:/games/one'

/** A stand-in for the browser's storage, in memory. */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key)
    },
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

beforeEach(() => {
  ;(globalThis as { window?: unknown }).window = { localStorage: fakeStorage() }
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('remembering a layout', () => {
  it('is nothing until something is written', () => {
    expect(readLayout(PROJECT)).toBeNull()
    expect(lastProject()).toBeNull()
  })

  it('keeps each half when the other is written, and names the project last written', () => {
    writeLayout(PROJECT, { dock: { grid: 'pretend' } })
    writeLayout(PROJECT, { assets: { view: 'list', folder: 'assets/textures' } })

    expect(readLayout(PROJECT)).toEqual({
      format: LAYOUT_FORMAT,
      version: LAYOUT_VERSION,
      dock: { grid: 'pretend' },
      assets: { view: 'list', folder: 'assets/textures' },
    })
    expect(lastProject()).toBe(PROJECT)
  })

  it('keeps projects apart', () => {
    writeLayout(PROJECT, { assets: { view: 'split', folder: '' } })
    writeLayout('D:/other', { assets: { view: 'icons', folder: 'scenes' } })
    expect(readLayout(PROJECT)?.assets?.view).toBe('split')
    expect(readLayout('D:/other')?.assets?.folder).toBe('scenes')
    rememberProject(PROJECT)
    expect(lastProject()).toBe(PROJECT)
  })

  it('forgets on request', () => {
    writeLayout(PROJECT, { dock: {} })
    forgetLayout(PROJECT)
    expect(readLayout(PROJECT)).toBeNull()
  })

  it('treats anything unusable as nothing rather than as an error', () => {
    const store = (globalThis as { window: { localStorage: Storage } }).window.localStorage
    store.setItem(`kernel2d:layout:${PROJECT}`, 'not json at all')
    expect(readLayout(PROJECT)).toBeNull()

    store.setItem(`kernel2d:layout:${PROJECT}`, JSON.stringify({ format: LAYOUT_FORMAT, version: 99, dock: {} }))
    expect(readLayout(PROJECT)).toBeNull()

    store.setItem(
      `kernel2d:layout:${PROJECT}`,
      JSON.stringify({ format: LAYOUT_FORMAT, version: LAYOUT_VERSION, assets: { view: 'sideways', folder: '' } }),
    )
    expect(readLayout(PROJECT)).toBeNull()

    // And a write over the rubbish starts clean.
    writeLayout(PROJECT, { assets: { view: 'icons', folder: '' } })
    expect(readLayout(PROJECT)?.assets).toEqual({ view: 'icons', folder: '' })
  })

  it('does nothing at all in a browser with no storage', () => {
    delete (globalThis as { window?: unknown }).window
    expect(() => writeLayout(PROJECT, { dock: {} })).not.toThrow()
    expect(readLayout(PROJECT)).toBeNull()
  })
})
