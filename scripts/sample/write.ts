import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  assetTypeForName,
  defaultImportSettings,
  defaultMeta,
  metaPathFor as appendMetaSuffix,
  serializeMeta,
} from '../../sidecar/meta-schema.js'
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
      fs.writeFileSync(metaPathFor(absolute), meta(file, generatedAt))
    }
  }

  return report
}

/** The `.meta` sidecar carries the marking for anything that cannot hold it inside. */
export function metaPathFor(absolutePath: string): string {
  return appendMetaSuffix(absolutePath)
}

/**
 * A real `AssetMeta`, built from the same defaults factory the sidecar uses,
 * that also carries the generated marking.
 *
 * Generated content is held to the same schema as anything a human authors —
 * a sample folder full of documents the editor cannot open would be testing
 * nothing. The marking rides along inside the settings file rather than in a
 * file of its own, because a PNG has nowhere to keep it.
 */
function meta(file: SampleFile, generatedAt: string): string {
  const type = assetTypeForName(path.basename(file.path)) ?? 'other'
  const importSettings = file.settings ?? defaultImportSettings(type)

  if (importSettings.type !== type) {
    throw new Error(
      `${file.path}: settings are for a ${importSettings.type}, but the file name says ${type}`,
    )
  }

  return serializeMeta({
    ...defaultMeta(type, sampleAssetId(file.path)),
    importSettings,
    generatedBy: GENERATED_BY,
    generatedAt,
  })
}

/**
 * Ids derived from the path rather than minted at random, so re-running this
 * generator produces byte-identical output. The sidecar mints random ones for
 * files a human drops in; ids are opaque, so the two ways of making them never
 * have to agree on anything but being unique.
 */
function sampleAssetId(projectRelativePath: string): string {
  return createHash('sha256').update(projectRelativePath).digest('hex').slice(0, 16)
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
