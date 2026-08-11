import { describe, expect, it } from 'vitest'

import { createEventFeed } from '../../sidecar/feed.js'
import type { FileEvent } from '../../sidecar/watcher.js'

const change = (path: string): FileEvent => ({
  kind: 'added',
  path,
  isDirectory: false,
  size: 1,
  at: 0,
})

describe('handing changes to everyone listening', () => {
  it('gives every listener every change', () => {
    const feed = createEventFeed()
    const terminal: string[] = []
    const editor: string[] = []

    feed.subscribe((event) => terminal.push(event.path))
    feed.subscribe((event) => editor.push(event.path))
    feed.publish(change('scenes/level-01.json'))

    expect(terminal).toEqual(['scenes/level-01.json'])
    expect(editor).toEqual(['scenes/level-01.json'])
  })

  it('stops sending to a listener that has gone away', () => {
    const feed = createEventFeed()
    const heard: string[] = []

    const stop = feed.subscribe((event) => heard.push(event.path))
    feed.publish(change('one.json'))
    stop()
    feed.publish(change('two.json'))

    expect(heard).toEqual(['one.json'])
    expect(feed.size).toBe(0)
  })

  it('survives a listener leaving while it is being told something', () => {
    const feed = createEventFeed()
    const heard: string[] = []

    const stop = feed.subscribe(() => stop())
    feed.subscribe((event) => heard.push(event.path))
    feed.publish(change('one.json'))

    expect(heard).toEqual(['one.json'])
    expect(feed.size).toBe(1)
  })

  it('publishing with nobody listening is not an event lost, it is an event nobody wanted', () => {
    const feed = createEventFeed()

    expect(() => feed.publish(change('one.json'))).not.toThrow()
    expect(feed.size).toBe(0)
  })
})
