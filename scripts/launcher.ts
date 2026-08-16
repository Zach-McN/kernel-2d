import { PROJECT_ENV_VAR, resolveProjectFolder } from '../sidecar/config.js'
import { toPosixPath } from '../sidecar/paths.js'
import { LAUNCHER_NAME, writeLauncher } from './launcher/write.js'

/**
 * `npm run launcher -- <path-to-project-folder>`
 *
 * Puts a double-clickable launcher in a game folder, so opening that game stops
 * being a command typed into a terminal in this folder. Run once per game, and
 * again if either folder moves.
 *
 * Safe to re-run: it will not overwrite a file of that name that does not carry
 * the generated marker.
 */

const USAGE = 'Usage: npm run launcher -- <path-to-project-folder>'

const target = process.argv.slice(2).find((token) => !token.startsWith('-')) ?? process.env[PROJECT_ENV_VAR]

if (target === undefined || target.trim() === '') {
  console.error(`No project folder given.\n${USAGE}`)
  process.exit(1)
}

const folder = resolveProjectFolder(target, process.cwd())
if (!folder.ok) {
  console.error(folder.message)
  process.exit(1)
}
const { projectPath } = folder

const report = writeLauncher(projectPath)

console.log('kernel-2d launcher')
console.log(`  project    ${toPosixPath(projectPath)}`)

if (report.written) {
  console.log(`  written    ${report.path}`)
  console.log('')
  console.log(`Double-click "${LAUNCHER_NAME}" in that folder to open the editor on it.`)
} else {
  console.log(`  left alone ${report.path}, because nothing marks it as generated`)
  console.log('')
  console.log('Delete or rename that file and run this again to replace it.')
}

console.log('')
