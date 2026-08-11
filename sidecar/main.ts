import { resolveConfig } from './config.js'
import { formatBanner, formatEvent, formatTimestamp } from './log.js'
import { scanProject } from './scan.js'
import { startServer } from './server.js'
import { startWatcher } from './watcher.js'

const result = resolveConfig(process.argv.slice(2), process.env, process.cwd())

if (!result.ok) {
  console.error(result.message)
  process.exit(1)
}

const config = result.config

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
  console.error(error instanceof Error ? error.message : String(error))
  await watcher.close()
  process.exit(1)
}

await watcher.ready

const tree = await scanProject(config.projectPath)
for (const line of formatBanner(config, tree, server.url)) console.log(line)

let shuttingDown = false
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\nkernel-2d sidecar stopped.')
  await Promise.allSettled([watcher.close(), server.close()])
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
