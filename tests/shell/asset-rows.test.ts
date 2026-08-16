import { describe, expect, it } from 'vitest'

import { assetRowsFor, fileRangeBetween, visibleTreeRows } from '../../editor/shell/asset-rows'
import type { DirectoryNode, FileNode, TreeNode } from '../../sidecar/tree-schema'

/**
 * The rows the Assets panel shows and the range a Shift-click selects over
 * them. What matters is that the range is *what is on screen, in the order it
 * is on screen*: a closed folder's contents are not between two rows the eye
 * can see, and a folder is never part of a group.
 */

function file(path: string): FileNode {
  const name = path.split('/').at(-1) ?? path
  const dot = name.lastIndexOf('.')
  return { kind: 'file', name, path, ext: dot < 0 ? '' : name.slice(dot), size: 1, mtimeMs: 0 }
}

function folder(path: string, children: TreeNode[]): DirectoryNode {
  return { kind: 'directory', name: path.split('/').at(-1) ?? path, path, children }
}

const TREE: TreeNode[] = [
  folder('assets', [
    folder('assets/audio', [file('assets/audio/jump.wav'), file('assets/audio/jump.wav.meta')]),
    file('assets/knight.png'),
    file('assets/knight.png.meta'),
    file('assets/slime.png'),
  ]),
  folder('scenes', [file('scenes/level-01.json'), file('scenes/level-02.json')]),
  file('project.json'),
]

const paths = (rows: ReturnType<typeof assetRowsFor>): string[] => rows.map((row) => row.node.path)

describe('the rows on screen in the tree', () => {
  it('shows only open folders’ children, in reading order, with .meta folded into its file', () => {
    expect(paths(visibleTreeRows(TREE, new Set(['assets'])))).toEqual([
      'assets',
      'assets/audio',
      'assets/knight.png',
      'assets/slime.png',
      'scenes',
      'project.json',
    ])
    expect(paths(visibleTreeRows(TREE, new Set(['assets', 'assets/audio', 'scenes'])))).toEqual([
      'assets',
      'assets/audio',
      'assets/audio/jump.wav',
      'assets/knight.png',
      'assets/slime.png',
      'scenes',
      'scenes/level-01.json',
      'scenes/level-02.json',
      'project.json',
    ])
  })

  it('shows only the top when nothing is open', () => {
    expect(paths(visibleTreeRows(TREE, new Set()))).toEqual(['assets', 'scenes', 'project.json'])
  })
})

describe('the range a Shift-click selects', () => {
  const rows = visibleTreeRows(TREE, new Set(['assets', 'scenes']))

  it('is every file between the two, inclusive, in either direction', () => {
    expect(fileRangeBetween(rows, 'assets/knight.png', 'scenes/level-01.json')).toEqual([
      'assets/knight.png',
      'assets/slime.png',
      'scenes/level-01.json',
    ])
    expect(fileRangeBetween(rows, 'scenes/level-01.json', 'assets/knight.png')).toEqual([
      'assets/knight.png',
      'assets/slime.png',
      'scenes/level-01.json',
    ])
  })

  it('leaves folders out, and is one file when both ends are the same', () => {
    // `scenes` lies between and is not a file.
    expect(fileRangeBetween(rows, 'assets/slime.png', 'scenes/level-02.json')).toEqual([
      'assets/slime.png',
      'scenes/level-01.json',
      'scenes/level-02.json',
    ])
    expect(fileRangeBetween(rows, 'assets/slime.png', 'assets/slime.png')).toEqual(['assets/slime.png'])
  })

  it('is nothing when either end is not on screen', () => {
    // audio is closed, so jump.wav is not a row.
    expect(fileRangeBetween(rows, 'assets/audio/jump.wav', 'assets/slime.png')).toEqual([])
    expect(fileRangeBetween(rows, 'assets/knight.png', 'nowhere.png')).toEqual([])
  })
})
