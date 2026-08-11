import fs from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startWatcher, type FileEvent, type WatcherHandle } from '../../sidecar/watcher.js'
import { delay, makeTempProject, waitFor, type TempProject } from '../fixtures/project-fixture.js'

/**
 * These run against a real folder and real operating-system file events — no
 * fakes. A mocked watcher would prove nothing about the behaviour the human
 * actually depends on.
 */
describe('noticing what happens in the project folder', () => {
  let project: TempProject
  let watcher: WatcherHandle
  let events: FileEvent[]

  beforeEach(async () => {
    project = await makeTempProject({ 'assets/textures/': '', 'scenes/': '' })
    events = []
    watcher = startWatcher(project.root, { onEvent: (event) => events.push(event) })
    await watcher.ready
  })

  afterEach(async () => {
    // Always release the folder before deleting it, or Windows refuses.
    await watcher.close()
    await project.cleanup()
  })

  const find =
    (kind: FileEvent['kind'], path: string) =>
    (): FileEvent | undefined =>
      events.find((event) => event.kind === kind && event.path === path)

  it('notices a new file within a second of it landing', async () => {
    const startedAt = Date.now()

    await fs.writeFile(project.file('assets/textures/knight.png'), 'pretend-png-bytes')

    const event = await waitFor(find('added', 'assets/textures/knight.png'), 'the new file to be noticed')
    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(event.isDirectory).toBe(false)
    expect(event.size).toBe('pretend-png-bytes'.length)
  })

  it('notices a file being changed', async () => {
    await fs.writeFile(project.file('scenes/level-01.json'), '{}')
    await waitFor(find('added', 'scenes/level-01.json'), 'the new scene to be noticed')

    await fs.writeFile(project.file('scenes/level-01.json'), '{"entities":[]}')

    const event = await waitFor(find('changed', 'scenes/level-01.json'), 'the edit to be noticed')
    expect(event.isDirectory).toBe(false)
  })

  it('reports a rename as the old name going and the new name arriving', async () => {
    await fs.writeFile(project.file('assets/textures/knight.png'), 'pretend-png-bytes')
    await waitFor(find('added', 'assets/textures/knight.png'), 'the new file to be noticed')

    await fs.rename(project.file('assets/textures/knight.png'), project.file('assets/textures/hero.png'))

    await waitFor(find('removed', 'assets/textures/knight.png'), 'the old name to be reported gone')
    await waitFor(find('added', 'assets/textures/hero.png'), 'the new name to be reported')
  })

  it('notices a file being deleted', async () => {
    await fs.writeFile(project.file('assets/textures/knight.png'), 'pretend-png-bytes')
    await waitFor(find('added', 'assets/textures/knight.png'), 'the new file to be noticed')

    await fs.rm(project.file('assets/textures/knight.png'))

    const event = await waitFor(find('removed', 'assets/textures/knight.png'), 'the deletion to be noticed')
    expect(event.isDirectory).toBe(false)
  })

  it('notices a new folder, and says it is a folder', async () => {
    await fs.mkdir(project.file('assets/models'))

    const event = await waitFor(find('added', 'assets/models'), 'the new folder to be noticed')
    expect(event.isDirectory).toBe(true)
  })

  it('reports every change with a forward-slashed project-relative path', async () => {
    await fs.writeFile(project.file('assets/textures/knight.png'), 'pretend-png-bytes')
    const event = await waitFor(find('added', 'assets/textures/knight.png'), 'the new file to be noticed')

    expect(event.path).not.toContain('\\')
    expect(event.path.startsWith('assets/')).toBe(true)
  })

  it('says nothing about tooling folders', async () => {
    await fs.mkdir(project.file('node_modules'), { recursive: true })
    await fs.writeFile(project.file('node_modules/index.js'), 'ignored')
    // A watched file written after the ignored one: its arrival proves the
    // watcher had time to report the ignored one, had it wanted to.
    await fs.writeFile(project.file('scenes/level-01.json'), '{}')

    await waitFor(find('added', 'scenes/level-01.json'), 'the watched file to be noticed')
    await delay(100)

    expect(events.some((event) => event.path.startsWith('node_modules'))).toBe(false)
  })
})

describe('waiting for a slow save to finish', () => {
  it('says nothing until a growing file has stopped growing', async () => {
    const project = await makeTempProject()
    const events: FileEvent[] = []
    const watcher = startWatcher(project.root, {
      onEvent: (event) => events.push(event),
      stabilityThresholdMs: 400,
    })
    await watcher.ready

    try {
      const handle = await fs.open(project.file('slow-save.png'), 'w')
      try {
        await handle.write('first-chunk')
        await delay(200)
        expect(events).toHaveLength(0)
        await handle.write('second-chunk')
      } finally {
        await handle.close()
      }

      const event = await waitFor(
        () => events.find((candidate) => candidate.path === 'slow-save.png'),
        'the finished save to be announced',
      )
      expect(event.kind).toBe('added')
      expect(event.size).toBe('first-chunksecond-chunk'.length)
    } finally {
      await watcher.close()
      await project.cleanup()
    }
  })
})
