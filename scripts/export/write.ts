import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

import { toPosixPath } from '../../sidecar/paths.js'
import { gameCode } from '../game-code.js'
import { isSearchableName, markersIn, type MarkerHit } from './editor-markers.js'
import {
  EXPORT_MANIFEST_FILE,
  EXPORT_MANIFEST_FORMAT,
  EXPORT_MANIFEST_VERSION,
  ExportManifestSchema,
  serializeExportManifest,
  type ExportManifest,
} from './manifest-schema.js'
import type { ExportPlan } from './plan.js'

/**
 * Writing the folder: the page, the game, the project's own files, and the record of
 * what was written.
 *
 * Everything that decides whether an export *should* happen is next door in
 * `plan.ts`, and by the time anything here runs the answer is yes. What is left is
 * four steps in a fixed order, and the order is the safety argument:
 *
 *   1. Work out what may be replaced, from the manifest of the last export. A folder
 *      holding anything this command did not write is refused **before the build**,
 *      so a mistyped `--out` cannot cost anybody a folder.
 *   2. Build the page and the game into it.
 *   3. Copy the project's files, byte for byte, at the paths they have in the project
 *      — so the game asks for `assets/textures/knight.png` and finds exactly the file
 *      the editor was showing.
 *   4. Read the folder back: no editor markers in what was generated, and no file
 *      that is not in the new manifest.
 *
 * Step 4 is not belt and braces. The import boundary is checked on the source, and
 * this is checked on the artefact, and the two fail in different ways — a bundler
 * reaching somewhere unexpected is invisible to the first and obvious to the second.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** The page's source: the only HTML the runtime owns. */
const PAGE_ROOT = path.join(REPO_ROOT, 'runtime', 'web')

/** What the export command calls itself in the manifest it leaves behind. */
export const EXPORT_GENERATED_BY = 'kernel-2d export'

export interface WriteOptions {
  plan: ExportPlan
  projectPath: string
  outPath: string
  generatedAt: string
}

export interface WriteReport {
  /** Every file now in the folder, relative and forward-slashed, sorted. */
  files: string[]
  /** Files a previous export left that this one no longer needs. */
  removed: string[]
  /** The page and the game — what the build produced, as opposed to what was copied. */
  generated: string[]
}

export class ExportRefused extends Error {}

export async function writeExport(options: WriteOptions): Promise<WriteReport> {
  const { plan, projectPath, outPath, generatedAt } = options

  const previous = readPreviousManifest(outPath)

  // Step 1, before anything is built or copied.
  const stranger = strangerIn(outPath, previous)
  if (stranger !== null) {
    throw new ExportRefused(
      `${toPosixPath(outPath)} already holds ${stranger}, which no export put there.\n` +
        'Exporting would replace what is in that folder, so it refuses rather than guess. ' +
        'Choose an empty folder, or one a previous export wrote.',
    )
  }

  fs.mkdirSync(outPath, { recursive: true })

  // Step 2. Anything a previous build emitted is cleared first, so a renamed chunk
  // cannot linger — but only within the folder we have just established is ours.
  const generated = await buildPage(outPath, previous, projectPath)

  // Step 3.
  for (const file of plan.files) copyInto(projectPath, outPath, file)

  const files = [...new Set([...generated, ...plan.files])].sort()

  // Whatever the last export wrote and this one did not. Removed rather than left,
  // so exporting the same project twice gives the same folder rather than one that
  // accumulates whatever the game used to need.
  const wanted = new Set(files)
  const removed = (previous?.files ?? []).filter((file) => !wanted.has(file)).sort()
  for (const file of removed) removeFrom(outPath, file)

  const manifest: ExportManifest = {
    format: EXPORT_MANIFEST_FORMAT,
    version: EXPORT_MANIFEST_VERSION,
    generatedBy: EXPORT_GENERATED_BY,
    generatedAt,
    startupScene: plan.startupScene,
    files,
  }

  fs.writeFileSync(path.join(outPath, EXPORT_MANIFEST_FILE), serializeExportManifest(manifest))

  // Step 4.
  verify(outPath, manifest, generated)

  return { files, removed, generated }
}

// --- building the page ------------------------------------------------------

/**
 * The page and the game, built into the folder.
 *
 * Four settings do real work here and none of them is a default worth inheriting:
 *
 *   - **`game.js` and `game.css`, at the root, with no content hash.** A hashed name
 *     would make the folder listing unreadable and would change whenever the bundle
 *     did, so a human could not tell one export from the next by looking. `assetsDir`
 *     is the folder root because the default is `assets/`, which is where the
 *     project's own art goes — two different things under one name.
 *   - **`minify: false`.** Making the folder small is not this session's business, and
 *     leaving identifiers readable is what makes the "no editor in here" search
 *     trustworthy rather than approximate. The cost is a large `game.js`.
 *   - **`emptyOutDir: false`.** The folder already holds the project's files by the
 *     time this runs on a re-export, and Vite would delete them. Previous build output
 *     is cleared by hand, from the manifest, which is the only list that knows what
 *     this command put there.
 *   - **`logLevel: 'warn'`.** The command prints its own report; Rollup's box in the
 *     middle of it is noise.
 */
async function buildPage(
  outPath: string,
  previous: ExportManifest | null,
  projectPath: string,
): Promise<string[]> {
  // Only what a build produced, and only inside a folder already established as
  // ours: a chunk that has been renamed since the last export would otherwise stay
  // for ever, listed by nothing and served to whoever opens the folder.
  for (const file of previous?.files ?? []) {
    if (isSearchableName(file)) removeFrom(outPath, file)
  }

  const result = await build({
    root: PAGE_ROOT,
    // No `base`, so every URL in the page is relative — which is the whole of why
    // the folder can be moved anywhere or served from a subfolder of a host.
    base: './',
    logLevel: 'warn',
    // The game's own systems, compiled in from the project folder by the same
    // plugin the editor's dev server uses. The source of what runs here and the
    // source of what runs behind the Play button are one file, which is the only
    // reason the two can be expected to behave the same.
    plugins: [gameCode({ projectPath })],
    build: {
      outDir: outPath,
      emptyOutDir: false,
      minify: false,
      assetsDir: '.',
      rollupOptions: {
        output: {
          entryFileNames: 'game.js',
          chunkFileNames: 'game-[name].js',
          assetFileNames: 'game.[ext]',
        },
      },
    },
  })

  // `build` answers with one output for a single build, and with an array only when
  // it has been asked for several. Neither shape is worth guessing at.
  const outputs = Array.isArray(result) ? result : [result]
  const written = new Set<string>()

  for (const one of outputs) {
    if (!('output' in one)) continue
    for (const chunk of one.output) written.add(chunk.fileName)
  }

  if (!written.has('index.html')) {
    throw new ExportRefused(
      'The build did not produce an index.html, so there would be no page to open. Nothing has been handed over.',
    )
  }

  return [...written].sort()
}

// --- reading the folder back ------------------------------------------------

/**
 * Whether the folder is safe to write into, and what is in the way if it is not.
 *
 * Answers the name of one offending file rather than all of them: the human has to
 * look at the folder either way, and one name is enough to recognise it by.
 */
function strangerIn(outPath: string, previous: ExportManifest | null): string | null {
  if (!fs.existsSync(outPath)) return null

  const present = filesUnder(outPath)
  if (present.length === 0) return null

  if (previous === null) {
    const first = present[0] ?? ''
    return present.length === 1 ? first : `${first} and ${String(present.length - 1)} other files`
  }

  const ours = new Set([...previous.files, EXPORT_MANIFEST_FILE])
  return present.find((file) => !ours.has(file)) ?? null
}

/**
 * The manifest a previous export left, or null.
 *
 * A manifest that will not parse is treated as absent rather than as a licence:
 * whatever else it is, it is not this command's record of what it wrote, and the
 * refusal that follows is the safe answer.
 */
function readPreviousManifest(outPath: string): ExportManifest | null {
  const manifestPath = path.join(outPath, EXPORT_MANIFEST_FILE)
  if (!fs.existsSync(manifestPath)) return null

  try {
    const parsed = ExportManifestSchema.safeParse(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The two things a finished folder has to be able to say about itself. */
function verify(outPath: string, manifest: ExportManifest, generated: readonly string[]): void {
  const hits: MarkerHit[] = []
  for (const file of generated) {
    if (!isSearchableName(file)) continue
    const absolute = path.join(outPath, file.replaceAll('/', path.sep))
    if (!fs.existsSync(absolute)) continue
    hits.push(...markersIn(file, fs.readFileSync(absolute, 'utf8')))
  }

  if (hits.length > 0) {
    throw new ExportRefused(
      [
        'This folder has editor code in it, so it is not a game anybody should be given:',
        ...hits.map((hit) => `  - ${hit.file} mentions ${hit.marker.text} — ${hit.marker.because}`),
        'The folder has been left as it is so it can be looked at. This is a bug in the export, not in your project.',
      ].join('\n'),
    )
  }

  const expected = new Set([...manifest.files, EXPORT_MANIFEST_FILE])
  const unexpected = filesUnder(outPath).filter((file) => !expected.has(file))

  if (unexpected.length > 0) {
    throw new ExportRefused(
      [
        'This folder holds files the export did not mean to write:',
        ...unexpected.map((file) => `  - ${file}`),
        'That is a bug in the export. The folder has been left as it is.',
      ].join('\n'),
    )
  }
}

// --- files ------------------------------------------------------------------

/** Every file under a folder, relative and forward-slashed, sorted. */
export function filesUnder(root: string, relative = ''): string[] {
  const absolute = relative === '' ? root : path.join(root, relative.replaceAll('/', path.sep))
  if (!fs.existsSync(absolute)) return []

  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`
      return entry.isDirectory() ? filesUnder(root, child) : [child]
    })
    .sort()
}

function copyInto(projectPath: string, outPath: string, relative: string): void {
  const from = path.join(projectPath, relative.replaceAll('/', path.sep))
  const to = path.join(outPath, relative.replaceAll('/', path.sep))
  fs.mkdirSync(path.dirname(to), { recursive: true })
  // Copied rather than read and rewritten: an export contains the human's files as
  // they are, so a document is byte-identical to the one in the project and a
  // texture is the same PNG. Nothing here reserialises anything.
  fs.copyFileSync(from, to)
}

/** Removes one file, and any folder it leaves empty behind it. */
function removeFrom(outPath: string, relative: string): void {
  const absolute = path.join(outPath, relative.replaceAll('/', path.sep))
  if (!fs.existsSync(absolute)) return
  fs.rmSync(absolute)

  let parent = path.dirname(absolute)
  while (parent !== outPath && parent.startsWith(outPath) && fs.readdirSync(parent).length === 0) {
    fs.rmdirSync(parent)
    parent = path.dirname(parent)
  }
}
