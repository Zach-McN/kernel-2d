import type { FileEvent } from './watcher.js'

/**
 * The hand-off between the watcher and whoever is listening — today the
 * terminal and the editor's change feed, tomorrow anything else that needs to
 * know the folder moved.
 *
 * Deliberately tiny and synchronous. The watcher already decides what counts as
 * a change and when a write has settled; this only carries the result, so there
 * is no second place where events could be filtered, coalesced, or reordered.
 */

export type FeedListener = (event: FileEvent) => void

export interface EventFeed {
  /** Returns the function that stops the subscription. */
  subscribe: (listener: FeedListener) => () => void
  publish: (event: FileEvent) => void
  /** How many listeners are attached — the connected-editor count, in practice. */
  readonly size: number
}

export function createEventFeed(): EventFeed {
  const listeners = new Set<FeedListener>()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    publish(event) {
      // Copied first: a listener that unsubscribes while being notified must
      // not change the set out from under this loop.
      for (const listener of [...listeners]) listener(event)
    },

    get size() {
      return listeners.size
    },
  }
}
