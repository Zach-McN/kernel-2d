import { describe, expect, it } from 'vitest'

import { searchRows } from '../../editor/shell/asset-rows'
import type { DirectoryNode, FileNode, TreeNode } from '../../sidecar/tree-schema'

/**
 * What the Assets panel's search box finds: rows anywhere in the project whose
 * *name* says every word typed, folded the way the panel folds them.
 *
 * The rule is asserted on a small tree rather than through the browser because
 * every question about it is a question about the list — what is in it, in
 * what order, once each — and none is about pixels.
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
    folder('assets/textures', [
      folder('assets/textures/characters', [
        file('assets/textures/characters/knight-idle.png'),
        file('assets/textures/characters/knight-idle.png.meta'),
        file('assets/textures/characters/knight-run-strip.png'),
        file('assets/textures/characters/knight-run-strip.png.meta'),
        file('assets/textures/characters/slime.png'),
        file('assets/textures/characters/deleted-hero.png.meta'),
      ]),
      folder('assets/textures/ui', [file('assets/textures/ui/icon-heart.png')]),
    ]),
  ]),
  folder('scenes', [file('scenes/level-01.json'), file('scenes/level-02.json')]),
  file('project.json'),
]

const paths = (query: string): string[] => searchRows(TREE, query).map((row) => row.node.path)

describe('what a search finds', () => {
  it('is every file anywhere whose name contains the word, whatever its case, in tree order', () => {
    expect(paths('KNIGHT')).toEqual([
      'assets/textures/characters/knight-idle.png',
      'assets/textures/characters/knight-run-strip.png',
    ])
    expect(paths('level')).toEqual(['scenes/level-01.json', 'scenes/level-02.json'])
  })

  it('matches on the name and never on the folder it is in', () => {
    // `textures` is the name of one folder, not of the twelve things under it.
    expect(paths('textures')).toEqual(['assets/textures'])
    expect(paths('characters')).toEqual(['assets/textures/characters'])
  })

  it('needs every word, in any order, so two words narrow rather than widen', () => {
    expect(paths('knight run')).toEqual(['assets/textures/characters/knight-run-strip.png'])
    expect(paths('strip knight')).toEqual(['assets/textures/characters/knight-run-strip.png'])
    expect(paths('knight slime')).toEqual([])
  })

  it('finds a picture once, with its settings folded in, and never its .meta by itself', () => {
    const rows = searchRows(TREE, 'idle')
    expect(rows.map((row) => row.node.path)).toEqual(['assets/textures/characters/knight-idle.png'])
    expect(rows[0]?.hasSettings).toBe(true)
    // Even asking for the sidecar by its own suffix finds the file it belongs to.
    expect(paths('idle.png.meta')).toEqual([])
  })

  it('finds stranded import settings by their own name, marked', () => {
    const rows = searchRows(TREE, 'deleted-hero')
    expect(rows.map((row) => row.node.path)).toEqual(['assets/textures/characters/deleted-hero.png.meta'])
    expect(rows[0]?.isOrphanedSettings).toBe(true)
  })

  it('finds folders as well as files', () => {
    expect(paths('.json')).toEqual(['scenes/level-01.json', 'scenes/level-02.json', 'project.json'])
    expect(paths('ui')).toEqual(['assets/textures/ui'])
  })

  it('finds nothing for nothing: blank is the folder view, not every file', () => {
    expect(paths('')).toEqual([])
    expect(paths('   ')).toEqual([])
  })
})
