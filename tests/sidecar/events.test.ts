import fs from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import { SIDECAR_HOST } from '../../sidecar/config.js'
import { FileEventMessageSchema, type FileEventMessage } from '../../sidecar/event-schema.js'
import { createEventFeed } from '../../sidecar/feed.js'
import { startServer, type ServerHandle } from '../../sidecar/server.js'
import { startWatcher, type WatcherHandle } from '../../sidecar/watcher.js'
import { makeTempProject, waitFor, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The change feed end to end: a real folder, a real watcher, a real HTTP
 * connection. A mocked stream would only prove the mock works — the properties
 * worth knowing here (does the browser hear about a saved file, and how fast)
 * belong to the operating system and the socket.
 */

interface Running {
  project: TempProject
  watcher: WatcherHandle
  server: ServerHandle
  stream: EventStream
}

let running: Running | undefined

afterEach(async () => {
  if (running === undefined) return
  // Ordered teardown: the stream holds the connection, the connection holds the
  // server, and a live watcher holds the folder open on Windows.
  running.stream.close()
  await running.watcher.close()
  await running.server.close()
  await running.project.cleanup()
  running = undefined
})

async function start(files: Readonly<Record<string, string>> = {}): Promise<Running> {
  const project = await makeTempProject(files)
  const feed = createEventFeed()

  const watcher = startWatcher(project.root, {
    onEvent: (event) => feed.publish(event),
  })

  const server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0, feed })
  await watcher.ready

  const stream = await openEventStream(`${server.url}/events`)
  running = { project, watcher, server, stream }
  return running
}

describe('watching the project folder from a browser', () => {
  it('announces a new file within a second of it being saved', async () => {
    const { project, stream } = await start({ 'assets/textures/': '' })

    const savedAt = Date.now()
    await fs.writeFile(project.file('assets/textures/knight.png'), 'pretend-png-bytes')

    const event = await waitFor(
      () => stream.received.find((message) => message.path === 'assets/textures/knight.png'),
      'the saved file to be announced on the change feed',
    )

    expect(event.kind).toBe('added')
    expect(event.isDirectory).toBe(false)
    expect(Date.now() - savedAt).toBeLessThan(1000)
  })

  it('announces an edit and a deletion, not only an arrival', async () => {
    const { project, stream } = await start({ 'scenes/level-01.json': '{}' })

    await fs.writeFile(project.file('scenes/level-01.json'), '{"changed":true}')
    await waitFor(
      () => stream.received.find((message) => message.kind === 'changed'),
      'the edit to be announced',
    )

    await fs.rm(project.file('scenes/level-01.json'))
    const removal = await waitFor(
      () => stream.received.find((message) => message.kind === 'removed'),
      'the deletion to be announced',
    )

    expect(removal.path).toBe('scenes/level-01.json')
    expect(removal.size).toBeNull()
  })

  it('says nothing about the folders it never watches', async () => {
    const { project, stream } = await start({ 'node_modules/': '', 'scenes/': '' })

    await fs.writeFile(project.file('node_modules/package.json'), '{}')
    await fs.writeFile(project.file('scenes/level-01.json'), '{}')

    // The watched file's event is what proves the feed had the opportunity to
    // report the ignored one and did not.
    await waitFor(
      () => stream.received.find((message) => message.path === 'scenes/level-01.json'),
      'the watched file to be announced',
    )

    expect(stream.received.some((message) => message.path.includes('node_modules'))).toBe(false)
  })

  it('sends every listener the same change', async () => {
    const { project, server, stream } = await start({ 'scenes/': '' })
    const second = await openEventStream(`${server.url}/events`)

    try {
      await fs.writeFile(project.file('scenes/level-01.json'), '{}')

      for (const listener of [stream, second]) {
        await waitFor(
          () => listener.received.find((message) => message.path === 'scenes/level-01.json'),
          'both listeners to hear about the new file',
        )
      }
    } finally {
      second.close()
    }
  })

  it('lets go of an open stream when the sidecar shuts down', async () => {
    const { server, stream } = await start()

    // Closing must not wait on a connection that, by design, never ends.
    await server.close()
    await waitFor(() => (stream.ended ? true : undefined), 'the open stream to be ended by the server')
  })
})

// --- reading a server-sent event stream -----------------------------------

interface EventStream {
  received: FileEventMessage[]
  ended: boolean
  close: () => void
}

async function openEventStream(url: string): Promise<EventStream> {
  const controller = new AbortController()
  const response = await fetch(url, { signal: controller.signal })

  expect(response.headers.get('content-type')).toContain('text/event-stream')
  if (response.body === null) throw new Error('The change feed sent no body.')

  const stream: EventStream = {
    received: [],
    ended: false,
    close: () => controller.abort(),
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Frames are separated by a blank line; comments (`: keep-alive`) carry
        // no data and are skipped.
        let split = buffer.indexOf('\n\n')
        while (split !== -1) {
          const frame = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          const data = frame.split('\n').find((line) => line.startsWith('data: '))
          if (data !== undefined) {
            const parsed = FileEventMessageSchema.safeParse(JSON.parse(data.slice('data: '.length)))
            if (parsed.success) stream.received.push(parsed.data)
          }
          split = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // Aborting the connection is how this loop is meant to end.
    } finally {
      stream.ended = true
    }
  })()

  return stream
}
