import { messageOf } from '../runtime/message-of.js'
import { resolveConfig } from './config.js'
import { startSidecar } from './start.js'
import { stopOnSignal } from './stop-on-signal.js'

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

stopOnSignal(() => sidecar.close(), 'kernel-2d sidecar stopped.')
