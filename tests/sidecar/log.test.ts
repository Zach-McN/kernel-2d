import { describe, expect, it } from 'vitest'

import type { SidecarConfig } from '../../sidecar/config.js'
import { formatBanner, formatBytes, formatEvent, formatTimestamp } from '../../sidecar/log.js'
import type { ProjectTree } from '../../sidecar/tree-schema.js'
import type { FileEvent } from '../../sidecar/watcher.js'

const event = (overrides: Partial<FileEvent> = {}): FileEvent => ({
  kind: 'added',
  path: 'assets/textures/knight.png',
  isDirectory: false,
  size: 12_700,
  at: 0,
  ...overrides,
})

describe('the line printed for each change', () => {
  it('shows a new file with its size', () => {
    expect(formatEvent(event())).toBe('+ added   assets/textures/knight.png (12.4 KB)')
  })

  it('shows an edited file', () => {
    expect(formatEvent(event({ kind: 'changed', path: 'scenes/level-01.json', size: 512 }))).toBe(
      '~ changed scenes/level-01.json (512 B)',
    )
  })

  it('shows a removed file without a size, since there is nothing left to measure', () => {
    const line = formatEvent(event({ kind: 'removed', size: null }))

    expect(line).toBe('- removed assets/textures/knight.png')
  })

  it('marks folders as folders, with a trailing slash', () => {
    const line = formatEvent(event({ path: 'assets/models', isDirectory: true, size: null }))

    expect(line).toBe('+ added   assets/models/ (folder)')
  })

  it('lines the file names up in a column, so a run of changes is scannable', () => {
    const lines = [
      formatEvent(event()),
      formatEvent(event({ kind: 'changed' })),
      formatEvent(event({ kind: 'removed', size: null })),
    ]

    const columns = new Set(lines.map((line) => line.indexOf('assets/')))
    expect(columns.size).toBe(1)
  })
})

describe('showing file sizes the way a person reads them', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [12_700, '12.4 KB'],
    [1024 * 1024, '1.0 MB'],
    [3 * 1024 * 1024 + 512 * 1024, '3.5 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
  ])('shows %i bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('the time stamp on each line', () => {
  it('is a plain wall clock', () => {
    expect(formatTimestamp(Date.now())).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

describe('the banner printed at startup', () => {
  const config: SidecarConfig = {
    projectPath: 'C:\\games\\my-game',
    displayPath: 'C:/games/my-game',
    projectName: 'my-game',
    host: '127.0.0.1',
    port: 7331,
  }

  const tree = (fileCount: number, directoryCount: number): ProjectTree => ({
    format: 'kernel2d.file-tree',
    version: 1,
    projectPath: config.displayPath,
    projectName: config.projectName,
    fileCount,
    directoryCount,
    tree: { kind: 'directory', name: 'my-game', path: '.', children: [] },
  })

  it('says which folder is being watched and where to look at it', () => {
    const banner = formatBanner(config, tree(12, 4), 'http://127.0.0.1:7331').join('\n')

    expect(banner).toContain('C:/games/my-game')
    expect(banner).toContain('http://127.0.0.1:7331/tree')
    expect(banner).toContain('12 files in 4 folders')
  })

  it('warns that a rename will look like two changes', () => {
    const banner = formatBanner(config, tree(0, 0), 'http://127.0.0.1:7331').join('\n')

    expect(banner).toContain('a rename shows as one removal and one addition')
  })

  it('counts one thing as one thing', () => {
    const banner = formatBanner(config, tree(1, 1), 'http://127.0.0.1:7331').join('\n')

    expect(banner).toContain('1 file in 1 folder')
  })
})
