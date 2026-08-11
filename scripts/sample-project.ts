import fs from 'node:fs'
import path from 'node:path'

import { PROJECT_ENV_VAR } from '../sidecar/config.js'
import { toPosixPath } from '../sidecar/paths.js'
import { writeSampleProject } from './sample/write.js'

/**
 * `npm run sample-project -- <path-to-project-folder>`
 *
 * Fills a project folder with sample content to open the editor against.
 * Re-running is safe: anything without a generated marker is left alone.
 */

const USAGE = 'Usage: npm run sample-project -- <path-to-project-folder>'

const target = process.argv.slice(2).find((token) => !token.startsWith('-')) ?? process.env[PROJECT_ENV_VAR]

if (target === undefined || target.trim() === '') {
  console.error(`No project folder given.\n${USAGE}`)
  process.exit(1)
}

let projectPath: string
try {
  projectPath = fs.realpathSync(path.resolve(process.cwd(), target))
} catch {
  console.error(`Project folder not found: ${toPosixPath(path.resolve(process.cwd(), target))}`)
  process.exit(1)
}

if (!fs.statSync(projectPath).isDirectory()) {
  console.error(`Not a folder: ${toPosixPath(projectPath)}`)
  process.exit(1)
}

const report = writeSampleProject(projectPath)

console.log('kernel-2d sample project')
console.log(`  project    ${toPosixPath(projectPath)}`)
console.log(`  written    ${report.written.length} files`)

if (report.skipped.length > 0) {
  console.log(`  left alone ${report.skipped.length} files, because nothing marks them as generated:`)
  for (const skipped of report.skipped) console.log(`               ${skipped}`)
}

console.log('')
