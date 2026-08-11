import type { Stats } from 'node:fs'

import { watch } from 'chokidar'

import type { FileEventKind } from './event-schema.js'
import { isIgnoredPath } from './ignore.js'
import { relativePosixPath } from './paths.js'

export type { FileEventKind }

export interface FileEvent {
  kind: FileEventKind
  /** Project-relative, forward-slashed. */
  path: string
  isDirectory: boolean
  /** Size in bytes when the operating system reported one, otherwise null. */
  size: number | null
  /** Milliseconds since the epoch, when the sidecar saw the change. */
  at: number
}

export interface WatcherHandle {
  /** Resolves once the initial sweep is done and live changes are being reported. */
  ready: Promise<void>
  close: () => Promise<void>
}

export interface WatcherOptions {
  onEvent: (event: FileEvent) => void
  onError?: (error: Error) => void
  /**
   * How long a file must stop growing before it is announced. Guards against
   * reporting a half-written PNG while Photoshop is still saving it.
   */
  stabilityThresholdMs?: number
}

/**
 * 200ms, not chokidar's 2000ms default. The default is far past the
 * "noticed within a second" bar this service exists to meet, while 200ms is
 * still comfortably longer than the gap between writes in a slow save.
 */
export const DEFAULT_STABILITY_THRESHOLD_MS = 200

/**
 * Watches the project folder and reports every change as a typed event.
 *
 * Note that no operating system reports a rename as a single event: renaming a
 * file surfaces as a `removed` for the old name and an `added` for the new one.
 */
export function startWatcher(projectPath: string, options: WatcherOptions): WatcherHandle {
  const stabilityThreshold = options.stabilityThresholdMs ?? DEFAULT_STABILITY_THRESHOLD_MS

  const watcher = watch(projectPath, {
    ignoreInitial: true,
    // Never follow a link out of the project folder.
    followSymlinks: false,
    ignored: (candidate: string) => isIgnoredPath(projectPath, candidate),
    awaitWriteFinish: {
      stabilityThreshold,
      pollInterval: Math.max(10, Math.min(50, Math.floor(stabilityThreshold / 4))),
    },
  })

  const report =
    (kind: FileEventKind, isDirectory: boolean) =>
    (absolutePath: string, stats?: Stats): void => {
      options.onEvent({
        kind,
        path: relativePosixPath(projectPath, absolutePath),
        isDirectory,
        size: stats?.size ?? null,
        at: Date.now(),
      })
    }

  watcher.on('add', report('added', false))
  watcher.on('change', report('changed', false))
  watcher.on('unlink', report('removed', false))
  watcher.on('addDir', report('added', true))
  watcher.on('unlinkDir', report('removed', true))
  watcher.on('error', (error: unknown) => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)))
  })

  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', () => {
      resolve()
    })
  })

  return {
    ready,
    close: () => watcher.close(),
  }
}
