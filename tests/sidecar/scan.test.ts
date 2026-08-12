import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scanProject } from '../../sidecar/scan.js'
import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema.js'
import { delay, makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

const SAMPLE_PROJECT: Record<string, string> = {
  'README.md': '# sample',
  'assets/textures/knight.png': 'pretend-png-bytes',
  'assets/audio/jump.wav': 'pretend-wav',
  'scenes/level-01.json': '{}',
  'node_modules/some-package/index.js': 'ignored',
  '.git/config': 'ignored',
  'dist/bundle.js': 'ignored',
}

function flatten(node: TreeNode): TreeNode[] {
  return node.kind === 'file' ? [node] : [node, ...node.children.flatMap(flatten)]
}

function pathsIn(tree: ProjectTree): string[] {
  return flatten(tree.tree).map((node) => node.path)
}

describe('reading a project folder into the file tree', () => {
  let project: TempProject

  beforeEach(async () => {
    project = await makeTempProject(SAMPLE_PROJECT)
  })

  afterEach(async () => {
    await project.cleanup()
  })

  it('counts what the human actually put in the folder', async () => {
    const tree = await scanProject(project.root)

    expect(tree.fileCount).toBe(4)
    // assets, assets/audio, assets/textures, scenes
    expect(tree.directoryCount).toBe(4)
    expect(tree.projectName).toBe(path.basename(project.root))
  })

  it('leaves tooling folders out entirely', async () => {
    const paths = pathsIn(await scanProject(project.root))

    expect(paths).not.toContain('node_modules')
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false)
    expect(paths.some((p) => p.startsWith('.git'))).toBe(false)
    expect(paths.some((p) => p.startsWith('dist'))).toBe(false)
  })

  it('lists folders before files, alphabetically within each group', async () => {
    const tree = await scanProject(project.root)

    expect(tree.tree.children.map((child) => child.name)).toEqual(['assets', 'scenes', 'README.md'])

    const assets = tree.tree.children.find((child) => child.name === 'assets')
    expect(assets?.kind).toBe('directory')
    if (assets?.kind !== 'directory') return
    expect(assets.children.map((child) => child.name)).toEqual(['audio', 'textures'])
  })

  it('describes each file by where it sits, what it is, and how big it is', async () => {
    const tree = await scanProject(project.root)
    const knight = flatten(tree.tree).find((node) => node.name === 'knight.png')

    expect(knight).toBeDefined()
    if (knight?.kind !== 'file') return
    expect(knight.path).toBe('assets/textures/knight.png')
    expect(knight.ext).toBe('.png')
    expect(knight.size).toBe(SAMPLE_PROJECT['assets/textures/knight.png']?.length)
  })

  it('tells a file re-saved with the same number of bytes from the one it replaced', async () => {
    // This is the whole reason the tree carries a time as well as a size: an
    // export from Photoshop very often lands on the identical byte count, and
    // anything caching the file by size alone would keep showing the old
    // pixels with nothing on screen explaining why.
    const timeOf = (tree: ProjectTree): number => {
      const knight = flatten(tree.tree).find((node) => node.name === 'knight.png')
      return knight?.kind === 'file' ? knight.mtimeMs : 0
    }

    const before = timeOf(await scanProject(project.root))
    expect(before).toBeGreaterThan(0)

    const original = SAMPLE_PROJECT['assets/textures/knight.png'] ?? ''
    const repainted = original.replace(/./, 'P')
    expect(repainted).toHaveLength(original.length)
    expect(repainted).not.toBe(original)

    await delay(10)
    await fs.writeFile(path.join(project.root, 'assets/textures/knight.png'), repainted, 'utf8')

    const after = timeOf(await scanProject(project.root))
    expect(after).toBeGreaterThan(before)
  })

  it('uses forward slashes everywhere, whatever the operating system uses', async () => {
    const tree = await scanProject(project.root)

    for (const node of flatten(tree.tree)) expect(node.path).not.toContain('\\')
    expect(tree.projectPath).not.toContain('\\')
  })

  it('names the project folder itself as the root of the tree', async () => {
    const tree = await scanProject(project.root)

    expect(tree.tree.kind).toBe('directory')
    expect(tree.tree.path).toBe('.')
    expect(tree.tree.name).toBe(path.basename(project.root))
  })

  it('gives files no extension when they have none', async () => {
    const bare = await makeTempProject({ LICENSE: 'text' })
    try {
      const tree = await scanProject(bare.root)
      const licence = tree.tree.children[0]
      expect(licence?.kind).toBe('file')
      if (licence?.kind !== 'file') return
      expect(licence.ext).toBe('')
    } finally {
      await bare.cleanup()
    }
  })
})

describe('reading an empty project folder', () => {
  it('reports an empty tree rather than failing', async () => {
    const empty = await makeTempProject()
    try {
      const tree = await scanProject(empty.root)

      expect(tree.fileCount).toBe(0)
      expect(tree.directoryCount).toBe(0)
      expect(tree.tree.children).toEqual([])
    } finally {
      await empty.cleanup()
    }
  })

  it('reports the conventional empty project folders as folders', async () => {
    const skeleton = await makeTempProject({
      'assets/textures/': '',
      'scenes/': '',
      'prefabs/': '',
      'data/': '',
    })
    try {
      const tree = await scanProject(skeleton.root)

      expect(tree.fileCount).toBe(0)
      expect(tree.tree.children.map((child) => child.name)).toEqual(['assets', 'data', 'prefabs', 'scenes'])
    } finally {
      await skeleton.cleanup()
    }
  })
})
