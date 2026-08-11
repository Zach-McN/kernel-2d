import fs from 'node:fs'
import path from 'node:path'

import { GENERATED_BY, sampleFiles, type SampleFile } from './content.js'

/**
 * Writes the sample project into a folder.
 *
 * The rule that matters: a file without a generated marker is treated as
 * human-authored and left alone. That check is what makes this safe to re-run
 * against a folder somebody has since started working in — the generator can
 * only ever overwrite its own output.
 */

export interface SampleProjectReport {
  written: string[]
  /** Files left alone because they were not written by this generator. */
  skipped: string[]
}

export interface WriteOptions {
  /** The date recorded in every marker. Fixed by the tests; today's date otherwise. */
  generatedAt?: string
}

export function writeSampleProject(projectPath: string, options: WriteOptions = {}): SampleProjectReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString().slice(0, 10)
  const report: SampleProjectReport = { written: [], skipped: [] }

  for (const file of sampleFiles(generatedAt)) {
    const absolute = path.join(projectPath, file.path)

    if (fs.existsSync(absolute) && !isOurs(absolute, file)) {
      report.skipped.push(file.path)
      continue
    }

    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, file.contents)
    report.written.push(file.path)

    if (file.marking === 'sidecar') {
      fs.writeFileSync(metaPathFor(absolute), meta(generatedAt))
    }
  }

  return report
}

/** The `.meta` sidecar carries the marking for anything that cannot hold it inside. */
export function metaPathFor(absolutePath: string): string {
  return `${absolutePath}.meta`
}

/**
 * Minimal on purpose. The real `.meta` format — slicing, pivot, filtering —
 * lands with the import-settings feature, and will be written to accept these
 * two fields rather than replace them.
 */
function meta(generatedAt: string): string {
  return `${JSON.stringify({ generatedBy: GENERATED_BY, generatedAt }, null, 2)}\n`
}

function isOurs(absolutePath: string, file: SampleFile): boolean {
  if (file.marking === 'inside') return hasMarker(absolutePath)
  return fs.existsSync(metaPathFor(absolutePath)) && hasMarker(metaPathFor(absolutePath))
}

function hasMarker(jsonPath: string): boolean {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && 'generatedBy' in parsed
  } catch {
    // Unreadable, or not JSON at all. Either way it is not something this
    // generator wrote, so it does not get overwritten.
    return false
  }
}
