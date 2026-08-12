import path from 'node:path'

import type { SidecarConfig } from './config.js'
import { createEventFeed } from './feed.js'
import { formatBanner, formatEvent, formatTimestamp } from './log.js'
import { ensureMetaFor, ensureMetaForDeletedSidecar, sweepProjectMetas } from './meta-files.js'
import { isMetaFileName } from './meta-schema.js'
import { scanProject } from './scan.js'
import { startServer } from './server.js'
import { startWatcher, type FileEvent } from './watcher.js'

/**
 * Brings the sidecar up: the `.meta` sweep, the watcher, the HTTP surface, and
 * the banner that tells the human which folder was actually resolved.
 *
 * This lives apart from the command-line entry point because the editor
 * launcher starts the sidecar inside its own process rather than as a child.
 * One process means one Ctrl-C and no orphaned server holding the port —
 * a real hazard on Windows, where killing a parent does not kill its children.
 */

export interface SidecarHandle {
  /** e.g. `http://127.0.0.1:7331` */
  url: string
  close: () => Promise<void>
}

export interface StartSidecarOptions {
  /** Named in the banner when the sidecar is running behind an editor window. */
  editorUrl?: string
}

export async function startSidecar(
  config: SidecarConfig,
  options: StartSidecarOptions = {},
): Promise<SidecarHandle> {
  // Before the watcher, deliberately. Giving a few hundred assets their
  // sidecars with the watcher already listening would announce every one of
  // them as a change, and none of them are changes the human made.
  const metas = await sweepProjectMetas(config.projectPath)

  // One feed, two audiences: the terminal the human is looking at, and every
  // editor window listening on the change stream.
  const feed = createEventFeed()

  const watcher = startWatcher(config.projectPath, {
    onEvent: (event) => {
      console.log(`${formatTimestamp(event.at)} ${formatEvent(event)}`)
      feed.publish(event)
      void keepMetasInStep(config.projectPath, event)
    },
    onError: (error) => {
      console.error(`${formatTimestamp(Date.now())} ! watcher  ${error.message}`)
    },
  })

  let server
  try {
    server = await startServer({
      projectPath: config.projectPath,
      host: config.host,
      port: config.port,
      feed,
    })
  } catch (error) {
    // The watcher is already running by this point; leaving it behind would
    // hold the folder open for a process that is about to give up.
    await watcher.close()
    throw error
  }

  await watcher.ready

  const tree = await scanProject(config.projectPath)
  for (const line of formatBanner(config, tree, server.url, { editorUrl: options.editorUrl, metas })) {
    console.log(line)
  }

  return {
    url: server.url,
    close: async () => {
      await Promise.allSettled([watcher.close(), server.close()])
    },
  }
}

/**
 * The live half of the promise that every asset has a `.meta`.
 *
 * Two triggers, both of which only ever *create* a file: an asset arriving
 * without settings, and a sidecar being deleted out from under a file that is
 * still there. Nothing here deletes anything — an orphaned `.meta` is left
 * alone until the next start, because while the editor is running an orphan is
 * as likely to be the removal half of a rename as it is to be rubbish.
 *
 * This does not loop, and the reason is worth stating: writing a `.meta`
 * produces an `added` event for a `.meta`, and a `.meta` is not an asset, so
 * the second pass through here does nothing.
 */
async function keepMetasInStep(projectPath: string, event: FileEvent): Promise<void> {
  if (event.isDirectory) return

  const absolute = path.join(projectPath, event.path)

  try {
    if (event.kind === 'added') {
      await ensureMetaFor(absolute)
    } else if (event.kind === 'removed' && isMetaFileName(event.path)) {
      await ensureMetaForDeletedSidecar(absolute)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${formatTimestamp(Date.now())} ! settings ${event.path}: ${message}`)
  }
}
