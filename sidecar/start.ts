import type { SidecarConfig } from './config.js'
import { formatBanner, formatEvent, formatTimestamp } from './log.js'
import { scanProject } from './scan.js'
import { startServer } from './server.js'
import { startWatcher } from './watcher.js'

/**
 * Brings the sidecar up: the watcher, the HTTP surface, and the banner that
 * tells the human which folder was actually resolved.
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
  const watcher = startWatcher(config.projectPath, {
    onEvent: (event) => {
      console.log(`${formatTimestamp(event.at)} ${formatEvent(event)}`)
    },
    onError: (error) => {
      console.error(`${formatTimestamp(Date.now())} ! watcher  ${error.message}`)
    },
  })

  let server
  try {
    server = await startServer({ projectPath: config.projectPath, host: config.host, port: config.port })
  } catch (error) {
    // The watcher is already running by this point; leaving it behind would
    // hold the folder open for a process that is about to give up.
    await watcher.close()
    throw error
  }

  await watcher.ready

  const tree = await scanProject(config.projectPath)
  for (const line of formatBanner(config, tree, server.url, options.editorUrl)) console.log(line)

  return {
    url: server.url,
    close: async () => {
      await Promise.allSettled([watcher.close(), server.close()])
    },
  }
}
