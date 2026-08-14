import { resolveConfig } from '../sidecar/config.js'
import { shouldOpenBrowser } from './editor-server.js'
import { startEditor, type RunningEditor } from './editor/start.js'

/**
 * `npm run editor -- <path-to-project-folder>` — the one command.
 *
 * Both halves run inside this single process: the sidecar that owns the disk
 * and the Vite dev server that serves the editor window. Two reasons it is one
 * process rather than two: Ctrl-C reaches everything without the launcher
 * having to hunt down a process tree, which is where this goes wrong on
 * Windows; and a refusal to start — a folder that does not exist, a port
 * already taken — happens before anything is running, so there is never a
 * half-started editor pointed at nothing.
 *
 * The starting itself is `editor/start.ts`, shared with the screenshot tool.
 * What is left here is the command: reading the arguments, and stopping.
 */

const result = resolveConfig(process.argv.slice(2), process.env, process.cwd())

if (!result.ok) {
  console.error(result.message)
  process.exit(1)
}

let editor: RunningEditor
try {
  editor = await startEditor(result.config, { open: shouldOpenBrowser(process.env) })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

let shuttingDown = false
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\nkernel-2d editor stopped.')
  await editor.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
