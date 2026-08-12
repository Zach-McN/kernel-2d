import { toPosixPath } from '../sidecar/paths.js'
import { resolveExportConfig } from './export/config.js'
import { planExport } from './export/plan.js'
import { ExportRefused, writeExport } from './export/write.js'
import { SERVE_SCRIPT } from './serve-folder.js'

/**
 * `npm run export -- <path-to-project-folder>` — a folder that plays the game.
 *
 * The whole of this file is arguments in, sentences out. Deciding whether an export
 * should happen is `export/plan.ts`; doing it is `export/write.ts`; this is the only
 * part that prints anything or exits, which is what makes the other two testable
 * without a process (`editor-kernel` D9).
 *
 * It prints the folder it resolved, because "where did it actually go" is the first
 * question anybody asks, and it prints how to open it, because a web game has to be
 * served rather than double-clicked and being told that here beats finding out from a
 * blank page.
 */

const start = Date.now()

const result = resolveExportConfig(
  process.argv.slice(2),
  process.env,
  process.cwd(),
  new Date().toISOString().slice(0, 10),
)

if (!result.ok) {
  console.error(result.message)
  process.exit(1)
}

const config = result.config

const planned = await planExport(config.projectPath)

if (!planned.ok) {
  console.error(`Nothing was exported.\n\n${planned.problem}`)
  process.exit(1)
}

const plan = planned.plan

let report
try {
  report = await writeExport({
    plan,
    projectPath: config.projectPath,
    outPath: config.outPath,
    generatedAt: config.generatedAt,
  })
} catch (error) {
  console.error(error instanceof ExportRefused ? error.message : `The export failed: ${messageOf(error)}`)
  process.exit(1)
}

const seconds = ((Date.now() - start) / 1000).toFixed(1)

console.log('kernel-2d export')
console.log(`  project    ${config.projectDisplayPath}`)
console.log(`  folder     ${config.outDisplayPath}`)
console.log(`  starts on  ${plan.startupScene}`)
console.log(`  written    ${String(report.files.length)} files in ${seconds}s`)

for (const file of report.files) console.log(`               ${file}`)

if (report.removed.length > 0) {
  console.log(`  removed    ${String(report.removed.length)} files this game no longer needs:`)
  for (const file of report.removed) console.log(`               ${file}`)
}

if (plan.leftOut.length > 0) {
  const summary = plan.leftOut.map((one) => `${one.path} (${String(one.count)})`).join(', ')
  console.log(`  left out   ${summary} — nothing the starting level reaches`)
}

if (plan.warnings.length > 0) {
  console.log('')
  console.log('  Worth knowing:')
  for (const warning of plan.warnings) console.log(`    - ${warning}`)
}

console.log('')
console.log('  To look at it:')
console.log(`    npm run ${SERVE_SCRIPT} -- ${toPosixPath(config.outPath)}`)
console.log('')
console.log('  A browser will not let a page opened straight off the disk read the files beside it,')
console.log('  so the folder has to be served. Any static web host serves it as it is.')
console.log('')

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
