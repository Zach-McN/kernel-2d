import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIDECAR_HOST, type SidecarConfig } from '../../sidecar/config.js'
import { startSidecar, type SidecarHandle } from '../../sidecar/start.js'
import { toPosixPath } from '../../sidecar/paths.js'
import { delay, makeTempProject, waitFor, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The live half: what happens to a folder's `.meta` files while the editor is
 * actually running, driven through the real service against a real folder.
 *
 * Nothing here is stubbed, because the chain under test is watcher, write, and
 * watcher again — and the one property that matters most is that this chain
 * settles instead of feeding itself. A fake watcher cannot loop, so a fake
 * watcher cannot prove it does not.
 */

let project: TempProject
let sidecar: SidecarHandle | null = null
let printed: string[] = []

const SAMPLE = {
  'assets/textures/knight.png': 'pretend-png',
  'assets/audio/jump.wav': 'pretend-wav',
  'scenes/level-01.json': '{}',
}

beforeEach(async () => {
  project = await makeTempProject(SAMPLE)
  printed = []
  // The banner and the change lines are the human-facing surface, not test
  // output. Captured rather than silenced, because one test reads them.
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    printed.push(String(line))
  })
})

afterEach(async () => {
  // Ordered on purpose: a watcher still holding the folder open can block its
  // removal on Windows, and the failure then surfaces in cleanup rather than in
  // the test that caused it.
  await sidecar?.close()
  sidecar = null
  vi.restoreAllMocks()
  await project.cleanup()
})

async function start(): Promise<SidecarHandle> {
  const config: SidecarConfig = {
    projectPath: project.root,
    displayPath: toPosixPath(project.root),
    projectName: 'temp-project',
    host: SIDECAR_HOST,
    // 0 asks the operating system for a free port, so a run never collides
    // with an editor the human has open.
    port: 0,
  }
  sidecar = await startSidecar(config)
  return sidecar
}

/**
 * Synchronous on purpose: `waitFor` polls a plain function, and handing it an
 * async one would give it a promise on every tick — always defined, so the wait
 * would end immediately and the test would prove nothing.
 */
const exists = (relativePath: string): boolean => existsSync(project.file(relativePath))

const waitForFile = (relativePath: string, description: string): Promise<true> =>
  waitFor(() => (exists(relativePath) ? true : undefined), description, 1000)

describe('opening a folder that was authored while the editor was shut', () => {
  it('gives every asset its settings before it starts watching', async () => {
    await start()

    expect(exists('assets/textures/knight.png.meta')).toBe(true)
    expect(exists('assets/audio/jump.wav.meta')).toBe(true)
  })

  it('does not announce its own writes as changes the human made', async () => {
    await start()
    await delay(400)

    expect(printed.filter((line) => line.includes('added') && line.includes('.meta'))).toEqual([])
  })

  it('says in the banner what it created', async () => {
    await start()

    expect(printed.join('\n')).toContain('2 .meta files created')
  })
})

describe('saving a file into the folder while the editor is open', () => {
  it('gets its settings within a second, which is the whole promise', async () => {
    await start()

    const startedAt = Date.now()
    await fs.writeFile(project.file('assets/textures/slime.png'), 'pretend-png')

    await waitForFile('assets/textures/slime.png.meta', 'the new texture to be given its import settings')

    expect(Date.now() - startedAt).toBeLessThan(1000)
  })

  it('settles rather than feeding itself, because a .meta is not an asset', async () => {
    await start()
    await fs.writeFile(project.file('assets/textures/slime.png'), 'pretend-png')

    await waitForFile('assets/textures/slime.png.meta', 'the new texture to be given its import settings')

    const settled = await fs.readdir(project.file('assets/textures'))
    await delay(600)

    expect(await fs.readdir(project.file('assets/textures'))).toEqual(settled)
    expect(settled).not.toContain('slime.png.meta.meta')
  })

  it('leaves a file it does not import without settings', async () => {
    await start()
    await fs.writeFile(project.file('scenes/level-02.json'), '{}')
    await delay(600)

    expect(exists('scenes/level-02.json.meta')).toBe(false)
  })
})

describe('deleting things while the editor is open', () => {
  it('starts a file over when its settings are deleted but the file is still there', async () => {
    await start()
    await fs.rm(project.file('assets/textures/knight.png.meta'))

    await waitForFile('assets/textures/knight.png.meta', 'the deleted settings to be written again')
  })

  it('leaves settings whose file has gone exactly where they are, until the next start', async () => {
    await start()
    await fs.rm(project.file('assets/textures/knight.png'))
    await delay(600)

    // Deliberate: while the editor is running, an orphan is as likely to be the
    // removal half of a rename as it is to be rubbish, and deleting it there
    // would throw away the id and settings of every file the human renames.
    expect(exists('assets/textures/knight.png.meta')).toBe(true)
  })

  it('clears that orphan out on the next start, and names it', async () => {
    await start()
    await fs.rm(project.file('assets/textures/knight.png'))
    await delay(600)

    await sidecar?.close()
    sidecar = null
    printed = []
    await start()

    expect(exists('assets/textures/knight.png.meta')).toBe(false)
    expect(printed.join('\n')).toContain('assets/textures/knight.png.meta')
  })
})
