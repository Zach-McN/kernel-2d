import { createServer, type ViteDevServer } from 'vite'

import { PORT_ENV_VAR, resolveConfig } from '../sidecar/config.js'
import { startSidecar } from '../sidecar/start.js'
import { shouldOpenBrowser } from './editor-server.js'

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
 * Vite comes up first so its address can go in the sidecar's banner. The
 * browser window it opens takes far longer to paint than the sidecar takes to
 * start, and the editor shows its own connecting state regardless.
 */

const result = resolveConfig(process.argv.slice(2), process.env, process.cwd())

if (!result.ok) {
  console.error(result.message)
  process.exit(1)
}

const config = result.config

// The editor talks to the sidecar through Vite's proxy, so the browser never
// needs to know this port. Vite does, and this is how it is told.
process.env[PORT_ENV_VAR] = String(config.port)

let editor: ViteDevServer
try {
  editor = await createServer({
    // Vite's own startup box is replaced by the sidecar banner below, so
    // starting the editor prints one thing rather than two.
    logLevel: 'warn',
    server: { open: shouldOpenBrowser(process.env) },
  })
  await editor.listen()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const editorUrl = editor.resolvedUrls?.local[0] ?? `http://localhost:${editor.config.server.port ?? ''}`

try {
  const sidecar = await startSidecar(config, { editorUrl })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\nkernel-2d editor stopped.')
    await Promise.allSettled([editor.close(), sidecar.close()])
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  await editor.close()
  process.exit(1)
}
