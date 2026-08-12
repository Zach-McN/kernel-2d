import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { isIgnoredName } from './ignore.js'
import {
  AssetMetaSchema,
  annotatedPathFor,
  assetTypeForName,
  defaultMeta,
  isMetaFileName,
  metaPathFor,
  serializeMeta,
} from './meta-schema.js'
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
 * The sidecar's `.meta` files on disk — the only place in this service that
 * writes into a human's project folder.
 *
 * The write privilege is exactly this, and nothing here may widen it:
 *
 *   - creates a `.meta` when an asset file has none;
 *   - deletes a `.meta` at startup when no file sits beside it;
 *   - never modifies one that already exists, not even a broken one.
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

/** Thrown when the browser asked about a path it has no business asking about. */
export class BadPathError extends Error {}

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

/** One issue, said plainly. A wall of validator output helps nobody read a panel. */
function firstIssue(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0]
  if (issue === undefined) return 'it did not validate'
  const where = issue.path.map(String).join('.')
  return where === '' ? issue.message : `${where}: ${issue.message}`
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath)
    return true
  } catch {
    return false
  }
}

async function remove(absolutePath: string): Promise<void> {
  try {
    await fs.unlink(absolutePath)
  } catch (error) {
    // Already gone is the outcome that was wanted.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
