import fs from 'node:fs'
import path from 'node:path'

import { messageOf } from '../runtime/message-of.js'
import { toPosixPath } from '../sidecar/paths.js'
import { DEFAULT_SERVE_PORT, SERVE_SCRIPT, startStaticServer } from './serve-folder.js'

/**
 * `npm run serve -- <folder> [--port <number>]` — look at an exported game.
 *
 * Arguments in, sentences out, and nothing else: the server is next door so the
 * browser suite can start one without a process. Every refusal names the path or
 * value at fault in one line, the same rule the editor's own launcher keeps
 * (`editor-kernel` D9).
 */

const USAGE = `Usage: npm run ${SERVE_SCRIPT} -- <folder> [--port <number>]`

let folderArg: string | undefined
let portArg: string | undefined

const argv = process.argv.slice(2)

for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i] ?? ''

  if (token === '--port') {
    const next = argv[i + 1]
    if (next === undefined) {
      console.error(`--port needs a number.\n${USAGE}`)
      process.exit(1)
    }
    portArg = next
    i += 1
    continue
  }

  if (token.startsWith('--port=')) {
    portArg = token.slice('--port='.length)
    continue
  }

  if (token.startsWith('-')) {
    console.error(`Unknown option: ${token}\n${USAGE}`)
    process.exit(1)
  }

  if (folderArg !== undefined) {
    console.error(`One folder at a time.\n${USAGE}`)
    process.exit(1)
  }
  folderArg = token
}

if (folderArg === undefined || folderArg.trim() === '') {
  console.error(`No folder given.\n${USAGE}`)
  process.exit(1)
}

const absolute = path.resolve(process.cwd(), folderArg)

if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
  console.error(`Not a folder: ${toPosixPath(absolute)}`)
  process.exit(1)
}

let port = DEFAULT_SERVE_PORT
if (portArg !== undefined && portArg.trim() !== '') {
  if (!/^\d+$/.test(portArg.trim()) || Number(portArg.trim()) > 65535) {
    console.error(`Port must be a whole number between 0 and 65535, not "${portArg}".`)
    process.exit(1)
  }
  port = Number(portArg.trim())
}

const hasPage = fs.existsSync(path.join(absolute, 'index.html'))

try {
  const server = await startStaticServer({ root: absolute, port })

  console.log('kernel-2d serving a folder')
  console.log(`  folder     ${toPosixPath(absolute)}`)
  console.log(`  open       ${server.url}/`)
  if (!hasPage) {
    console.log('  note       there is no index.html in there, so that address will say so.')
  }
  console.log('')
  console.log('  Ctrl-C stops it.')
  console.log('')

  const shutdown = async (): Promise<void> => {
    console.log('\nkernel-2d stopped serving.')
    await server.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
} catch (error) {
  console.error(messageOf(error))
  process.exit(1)
}
