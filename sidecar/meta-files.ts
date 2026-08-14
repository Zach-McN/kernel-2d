import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { firstIssue } from './first-issue.js'
import { exists, remove } from './fs-helpers.js'
import { isIgnoredName } from './ignore.js'
import {
  AssetMetaSchema,
  annotatedPathFor,
  assetTypeForName,
  defaultMeta,
  isMetaFileName,
  metaPathFor,
  serializeMeta,
} from '../runtime/formats/meta-schema.js'
import {
  MAX_SHOWN_TEXT_BYTES,
  META_VIEW_FORMAT,
  META_VIEW_VERSION,
  type MetaView,
} from './meta-view-schema.js'
import { relativePosixPath } from './paths.js'
import { scanProject } from './scan.js'
import type { ProjectTree, TreeNode } from './tree-schema.js'

/**
 * The sidecar's `.meta` files on disk — the one thing in this service that
 * writes into a human's project folder *of its own accord*, rather than because
 * the editor named a file.
 *
 * This file's share of the write privilege is exactly this, and nothing here may
 * widen it (the rest of the six lines is in `document-files.ts` and
 * `file-operations.ts`):
 *
 *   - of its own accord, creates a `.meta` when an asset file has none, and
 *     deletes a stranded one at startup;
 *   - replaces the whole contents of one `.meta`, and only when the editor
 *     names it and hands over a complete, valid document;
 *   - never modifies anything else, and never changes a `.meta` on its own
 *     initiative — including one it cannot read.
 *
 * The middle line is new, and the third is what keeps it from meaning more than
 * it says: the editor gaining a write is not this service gaining one. Nothing
 * here decides on its own that a `.meta` should be different from how it found
 * it. The only new thing it will do is carry out an instruction that names one
 * file and supplies every byte of its new contents.
 *
 * "Create when missing" is done with an exclusive-create flag rather than an
 * existence check followed by a write, so it is atomic: two sidecars opened on
 * the same folder race harmlessly, and a file that appeared in between is never
 * clobbered.
 */

/**
 * 16 lowercase hex characters — 64 bits, which is far past the point where two
 * assets in one project could collide, and still short enough to read out.
 * The sample-project generator mints its ids differently (derived from the path,
 * so re-runs produce identical bytes); ids are opaque, so both are fine.
 */
export function mintAssetId(): string {
  return randomBytes(8).toString('hex')
}

export type EnsureOutcome =
  /** A `.meta` was written. */
  | 'created'
  /** One was already there and was left exactly as it was. */
  | 'kept'
  /** The file is not something this editor imports, so it gets no settings. */
  | 'not-an-asset'

/**
 * Gives one file a `.meta` if it is an asset and has none.
 *
 * Never touches an existing sidecar, including an unreadable one: a file the
 * editor cannot parse is far more likely to be something a human is midway
 * through editing than something worth replacing.
 */
export async function ensureMetaFor(absoluteFilePath: string): Promise<EnsureOutcome> {
  const type = assetTypeForName(path.basename(absoluteFilePath))
  if (type === null) return 'not-an-asset'

  const meta = defaultMeta(type, mintAssetId())

  try {
    await fs.writeFile(metaPathFor(absoluteFilePath), serializeMeta(meta), { flag: 'wx' })
    return 'created'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'kept'
    throw error
  }
}

/**
 * Re-creates a `.meta` that was deleted while its file is still there.
 *
 * Deleting a sidecar by hand is how a human says "start these settings over",
 * and the invariant this service promises — every asset has a `.meta` — should
 * hold the same whether or not the editor happened to be running at the time.
 */
export async function ensureMetaForDeletedSidecar(absoluteMetaPath: string): Promise<EnsureOutcome> {
  const annotated = annotatedPathFor(absoluteMetaPath)
  if (annotated === null) return 'not-an-asset'

  // The file may be gone too — an ordinary deletion of an asset and its
  // sidecar together, or the removal half of a rename. Either way there is
  // nothing to annotate and nothing to do.
  if (!(await exists(annotated))) return 'not-an-asset'

  return ensureMetaFor(annotated)
}

export interface SweepReport {
  /** Project-relative paths of the `.meta` files written. */
  created: string[]
  /** How many assets already had one. */
  kept: number
  /** Project-relative paths of the `.meta` files removed for having no file. */
  removedOrphans: string[]
}

/**
 * Brings the whole folder into line, once, at startup.
 *
 * This is the only moment an orphaned `.meta` — one whose file is gone — is
 * deleted. It never happens while the editor is running, because the operating
 * system reports a rename as a removal followed by an addition (editor-kernel
 * G7): deleting on the removal half would throw away the settings of every file
 * the human renames, mid-gesture. Doing it at startup keeps that window shut.
 *
 * **That reasoning now covers less ground than it did, and the part it no longer
 * covers is the part that used to hurt.** A rename made *inside the editor* is
 * one request that moves the file and its sidecar together
 * (`file-operations.ts`), so it never produces an orphan and never loses an id —
 * this rule is not what saves it, and the watcher does not have to guess. What is
 * left here is renames made in Explorer, where the two events genuinely are all
 * the operating system offers, and where a settings file is still lost at the
 * next start. That cost is now paid only by people working outside the tool.
 *
 * Running before the watcher starts is deliberate too. Creating a few hundred
 * sidecars with the watcher already listening would produce a few hundred
 * change events describing this service's own writes.
 */
export async function sweepProjectMetas(projectPath: string, tree?: ProjectTree): Promise<SweepReport> {
  const scanned = tree ?? (await scanProject(projectPath))
  const files = new Set<string>()
  collectFilePaths(scanned.tree, files)

  const report: SweepReport = { created: [], kept: 0, removedOrphans: [] }

  for (const filePath of files) {
    const absolute = path.join(projectPath, filePath)

    if (isMetaFileName(filePath)) {
      const annotated = annotatedPathFor(filePath)
      if (annotated !== null && !files.has(annotated)) {
        await remove(absolute)
        report.removedOrphans.push(filePath)
      }
      continue
    }

    if (assetTypeForName(path.basename(filePath)) === null) continue

    if (files.has(metaPathFor(filePath))) {
      report.kept += 1
      continue
    }

    if ((await ensureMetaFor(absolute)) === 'created') report.created.push(metaPathFor(filePath))
    else report.kept += 1
  }

  report.created.sort()
  report.removedOrphans.sort()
  return report
}

function collectFilePaths(node: TreeNode, into: Set<string>): void {
  if (node.kind === 'file') {
    into.add(node.path)
    return
  }
  for (const child of node.children) collectFilePaths(child, into)
}

// --- reading, for the editor ----------------------------------------------

export type ResolvedPath = { ok: true; absolute: string } | { ok: false; problem: string }

/**
 * Turns a path the browser asked about into an absolute one, or refuses.
 *
 * Everything crossing this boundary is treated as hostile: only project-
 * relative paths get through, `..` never does, and the result is checked to be
 * inside the project folder even after resolution.
 */
export function resolveInsideProject(projectPath: string, requested: string): ResolvedPath {
  if (requested.trim() === '') return { ok: false, problem: 'No path was given.' }

  if (path.isAbsolute(requested) || /^[a-zA-Z]:/.test(requested)) {
    return { ok: false, problem: 'Paths must be relative to the project folder.' }
  }

  const segments = requested.split(/[\\/]/).filter((segment) => segment !== '')

  if (segments.length === 0) return { ok: false, problem: 'No path was given.' }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return { ok: false, problem: 'Paths may not step outside the project folder.' }
  }
  if (segments.some(isIgnoredName)) {
    return { ok: false, problem: 'That path is inside a folder the editor does not read.' }
  }

  const absolute = path.resolve(projectPath, ...segments)
  const inside = path.relative(projectPath, absolute)
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    return { ok: false, problem: 'Paths may not step outside the project folder.' }
  }

  return { ok: true, absolute }
}

/**
 * Answers "what does this file's `.meta` hold?" for the Inspector.
 *
 * Takes either the file's own path or its sidecar's, so an orphaned `.meta`
 * showing on its own row in the Assets panel can be inspected like anything
 * else. A `.meta` it cannot parse comes back with the reason and the file's
 * text, because "there is something here I cannot read" is far more useful to
 * a human than a blank panel — and the file itself is left alone regardless.
 */
export async function readMetaView(projectPath: string, requestedPath: string): Promise<MetaView> {
  const resolved = resolveInsideProject(projectPath, requestedPath)
  if (!resolved.ok) throw new BadPathError(resolved.problem)

  const absoluteMeta = isMetaFileName(resolved.absolute)
    ? resolved.absolute
    : metaPathFor(resolved.absolute)
  const shownPath = relativePosixPath(projectPath, resolved.absolute)
  const shownMetaPath = relativePosixPath(projectPath, absoluteMeta)

  let raw: string
  try {
    raw = await fs.readFile(absoluteMeta, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return view(shownPath, { metaPath: null, status: 'none' })
    }
    throw error
  }

  const unreadable = (problem: string): MetaView =>
    view(shownPath, {
      metaPath: shownMetaPath,
      status: 'unreadable',
      problem,
      text: Buffer.byteLength(raw, 'utf8') <= MAX_SHOWN_TEXT_BYTES ? raw : null,
    })

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return unreadable(`This .meta is not valid JSON: ${(error as Error).message}.`)
  }

  const result = AssetMetaSchema.safeParse(parsed)
  if (!result.success) {
    return unreadable(`This .meta is not in a format this editor knows — ${firstIssue(result.error)}.`)
  }

  return view(shownPath, { metaPath: shownMetaPath, status: 'ok', meta: result.data })
}

/**
 * Replaces one `.meta` with a document the editor supplied in full.
 *
 * Three refusals, each one plain sentence, and each leaving the file exactly as
 * it was:
 *
 *   - a path that is not inside the project folder;
 *   - a document that is not a valid `.meta`, so a half-formed edit can never
 *     land on disk as the file of record;
 *   - a sidecar with no file beside it, because writing one would strand it,
 *     and a stranded sidecar is deleted at the next startup — the write would
 *     quietly not survive the day.
 *
 * What it deliberately does *not* refuse is a document whose type disagrees
 * with the file's extension. What a file says it is beats what its name
 * suggests (editor-ui U11), so overriding that is an authoring decision rather
 * than a mistake to be corrected.
 *
 * Answers with the resulting view, read back from disk rather than assumed, so
 * one round trip tells the editor what is actually there.
 */
export async function writeMetaFor(
  projectPath: string,
  requestedPath: string,
  document: unknown,
): Promise<MetaView> {
  const resolved = resolveInsideProject(projectPath, requestedPath)
  if (!resolved.ok) throw new BadPathError(resolved.problem)

  const absoluteMeta = isMetaFileName(resolved.absolute)
    ? resolved.absolute
    : metaPathFor(resolved.absolute)
  const annotated = annotatedPathFor(absoluteMeta)

  if (annotated === null || !(await exists(annotated))) {
    throw new BadPathError(
      'There is no file beside those import settings, so writing them would leave them stranded.',
    )
  }

  const parsed = AssetMetaSchema.safeParse(document)
  if (!parsed.success) {
    throw new BadDocumentError(`Those are not import settings this editor can write — ${firstIssue(parsed.error)}.`)
  }

  await fs.writeFile(absoluteMeta, serializeMeta(parsed.data), 'utf8')

  return readMetaView(projectPath, requestedPath)
}

/** Refused, with a sentence worth showing a human. Answered as 400, never 500. */
export class RefusedError extends Error {}

/** Thrown when the browser asked about a path it has no business asking about. */
export class BadPathError extends RefusedError {}

/** Thrown when the browser sent something that is not a `.meta`. */
export class BadDocumentError extends RefusedError {}

function view(
  shownPath: string,
  parts: Partial<Omit<MetaView, 'format' | 'version' | 'path'>> & Pick<MetaView, 'status' | 'metaPath'>,
): MetaView {
  return {
    format: META_VIEW_FORMAT,
    version: META_VIEW_VERSION,
    path: shownPath,
    metaPath: parts.metaPath,
    status: parts.status,
    meta: parts.meta ?? null,
    problem: parts.problem ?? null,
    text: parts.text ?? null,
  }
}
