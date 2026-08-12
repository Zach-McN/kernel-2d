import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scanProject } from '../../sidecar/scan.js'
import { ProjectTreeSchema } from '../../sidecar/tree-schema.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The standing tripwire against serialization drift (editor-kernel G1): writing
 * a document out and reading it back must produce exactly what went in. Every
 * format the kernel gains carries a test like this one, in place before a
 * second piece of code learns to write that format.
 */
describe('the file-tree format survives a round trip', () => {
  let project: TempProject

  beforeEach(async () => {
    project = await makeTempProject({
      'README.md': '# sample',
      'assets/textures/knight.png': 'pretend-png-bytes',
      'assets/audio/': '',
      'scenes/level-01.json': '{}',
    })
  })

  afterEach(async () => {
    await project.cleanup()
  })

  it('reads back identical to what was written', async () => {
    const tree = await scanProject(project.root)

    const roundTripped = ProjectTreeSchema.parse(JSON.parse(JSON.stringify(tree)))

    expect(roundTripped).toEqual(tree)
  })

  it('a freshly scanned tree already satisfies the format', async () => {
    const tree = await scanProject(project.root)

    expect(() => ProjectTreeSchema.parse(tree)).not.toThrow()
  })
})

describe('the file-tree format rejects what it should', () => {
  const validTree = {
    format: 'kernel2d.file-tree',
    version: 1,
    projectPath: 'C:/games/my-game',
    projectName: 'my-game',
    fileCount: 1,
    directoryCount: 1,
    tree: {
      kind: 'directory',
      name: 'my-game',
      path: '.',
      children: [
        {
          kind: 'directory',
          name: 'scenes',
          path: 'scenes',
          children: [
            {
              kind: 'file',
              name: 'level-01.json',
              path: 'scenes/level-01.json',
              ext: '.json',
              size: 2,
              mtimeMs: 1_754_870_000_000,
            },
          ],
        },
      ],
    },
  }

  it('accepts a well-formed tree written by hand', () => {
    expect(() => ProjectTreeSchema.parse(validTree)).not.toThrow()
  })

  it('rejects a node that is neither a file nor a folder', () => {
    const broken = structuredClone(validTree)
    broken.tree.children[0]!.kind = 'sideways'

    expect(() => ProjectTreeSchema.parse(broken)).toThrow()
  })

  it('rejects a file with a negative size', () => {
    const broken = structuredClone(validTree)
    const nested = broken.tree.children[0]!.children[0] as { size: number }
    nested.size = -1

    expect(() => ProjectTreeSchema.parse(broken)).toThrow()
  })

  it('rejects a tree from a format version it does not know', () => {
    const broken = { ...validTree, version: 2 }

    expect(() => ProjectTreeSchema.parse(broken)).toThrow()
  })
})
