import { messageOf } from '../runtime/message-of.js'
import { resolveConfig } from './config.js'
import { startSidecar } from './start.js'

/**
 * The sidecar on its own, without the editor. Useful for poking the tree URL
 * with a browser or curl; `npm run editor` starts the same service alongside
 * the editor window.
 */

const result = resolveConfig(process.argv.slice(2), process.env, process.cwd())

if (!result.ok) {
  console.error(result.message)
  process.exit(1)
}

let sidecar
try {
  sidecar = await startSidecar(result.config)
} catch (error) {
  console.error(messageOf(error))
  process.exit(1)
}

let shuttingDown = false
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\nkernel-2d sidecar stopped.')
  await sidecar.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
