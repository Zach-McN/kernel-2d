import fs from 'node:fs/promises'
import path from 'node:path'

import { annotatedPathFor, isMetaFileName, metaPathFor } from '../runtime/formats/meta-schema.js'
import { FILE_CHANGE_FORMAT, FILE_CHANGE_VERSION, type FileChange } from './file-change-schema.js'
import { exists, remove } from './fs-helpers.js'
import { BadPathError, resolveInsideProject } from './meta-files.js'
import { relativePosixPath } from './paths.js'

/**
 * Moving one file, and deleting one file — the fourth and fifth lines of the
 * service's write privilege.
 *
 * The whole of that privilege, restated here because this file is where two
 * thirds of it now live (editor-kernel D17, D22):
 *
 *   - of its own accord, creates a `.meta` when an asset has none, and deletes a
 *     stranded one at startup;
 *   - creates one file the editor names, when there is nothing at that path and
 *     the document is valid in a format this editor knows;
 *   - replaces the whole contents of one file the editor names, when that file
 *     already exists and the document is valid and of the format already there;
 *   - moves one file or folder the editor names to one path the editor names,
 *     when there is nothing at the destination — taking a `.meta` with the file
 *     it annotates;
 *   - deletes one file the editor names, and the `.meta` beside it;
 *   - never modifies anything else, and never changes a file on its own
 *     initiative.
 *
 * Six lines, and the reason six is still holdable is that every one of them has
 * the same shape. **The editor names a path and one thing happens to it; the
 * service never picks a path itself, and never touches a second file except the
 * `.meta` belonging to the first.** That sentence is what a seventh line has to
 * be checkable against — if a widening cannot be phrased inside it, the privilege
 * has stopped being something a person can hold in their head, which is the point
 * at which it starts damaging work nobody authored.
 *
 * **Move and delete are separate requests, like create and replace, and for the
 * same reason** (D22): kept apart, neither can do the other's job however
 * confused the caller is. The question to ask of any further widening is not "is
 * this operation safe?" but "what does this operation do if the caller is
 * confused about which one it wanted?"
 *
 * Two things here are genuinely subtle and are the reason this file is longer
 * than the two `fs` calls at the bottom of it.
 *
 * ## The ordering of the file and its `.meta`
 *
 * A move renames **the `.meta` first and the file second**. A delete removes
 * **the file first and the `.meta` second**. They are opposite on purpose, and
 * both orders are chosen against the same hazard: this service watches the folder
 * it is writing into, and its own rule "an asset that appears with no settings
 * gets settings" is listening (`sidecar/start.ts`).
 *
 *   - Move the file first, and the `added` event for it can reach `ensureMetaFor`
 *     before the sidecar arrives. A **fresh id** is minted, the pivot and the
 *     slicing the human set are gone, and the reference that pointed at the old
 *     file is now witnessed by an id nothing recorded. That is the exact loss
 *     this feature exists to prevent.
 *   - Move the `.meta` first and the worst case is a stray sidecar at the old
 *     path, which the startup sweep already clears. Strictly smaller damage.
 *   - Delete the `.meta` first and `ensureMetaForDeletedSidecar` sees a file with
 *     no settings and writes new ones — a file that is about to be deleted, so
 *     the new sidecar is stranded. Delete the file first and that rule finds
 *     nothing to annotate, which is no race at all.
 *
 * The residual window in the move is closed rather than merely made small: every
 * path an operation is about is held in `inProgress` for the length of the
 * request, and the watcher handler skips those. **The service does not act on its
 * own writes**, which is the same instinct that terminates the loops in
 * editor-kernel G9 and G10, said as a rule rather than left to timing.
 *
 * ## The one check-then-act in the service, admitted rather than hidden
 *
 * Everywhere else, "is that path free?" is asked of the filesystem in the same
 * operation that takes it — `wx` on a create, which is what makes it exclusive.
 * **There is no such flag for a rename.** Node offers no no-overwrite rename
 * (`fs.rename` replaces silently on both platforms; the `RENAME_NOREPLACE` that
 * would fix this is not exposed), so the destination is checked and then used,
 * and there is a window between the two.
 *
 * What that costs, stated plainly so nobody has to rediscover it: two editors
 * open on one folder, where one creates a file in the microseconds after the
 * other has checked that path is free, and the move then writes over it. It is
 * the narrowest hazard in this file and it is not zero. Do not paper over it with
 * a re-check — that just makes the window shorter. If it ever matters, the fix is
 * a link-then-unlink for the file case, which does not generalise to folders.
 */

/**
 * Absolute paths this service is itself operating on right now.
 *
 * Consulted by the watcher handler so the service never treats its own file
 * operations as something the human did. Keyed on the absolute path because more
 * than one project can be open in one process — the test suite does exactly that
 * — and `assets/knight.png` is not a unique name across two of them.
 */
const inProgress = new Set<string>()

/** Whether the service is mid-operation on this absolute path. */
export function isServiceHandling(absolutePath: string): boolean {
  return inProgress.has(path.resolve(absolutePath))
}

function hold(paths: readonly string[]): () => void {
  const held = paths.map((one) => path.resolve(one))
  for (const one of held) inProgress.add(one)
  return () => {
    for (const one of held) inProgress.delete(one)
  }
}

/**
 * Moves one file or folder to a path the editor names.
 *
 * Every refusal is one plain sentence meant for a human and leaves the folder
 * exactly as it was — nothing is renamed until every check has passed.
 */
export async function moveFile(
  projectPath: string,
  requestedFrom: string,
  requestedTo: string,
): Promise<FileChange> {
  const from = resolveInsideProject(projectPath, requestedFrom)
  if (!from.ok) throw new BadPathError(from.problem)

  const to = resolveInsideProject(projectPath, requestedTo)
  if (!to.ok) throw new BadPathError(to.problem)

  const shownFrom = relativePosixPath(projectPath, from.absolute)
  const shownTo = relativePosixPath(projectPath, to.absolute)

  // A sidecar is not a thing in its own right: it is addressed by the file it
  // annotates and it travels with it. Moving one alone would either strand it or
  // silently detach a file from its own id.
  if (isMetaFileName(from.absolute)) {
    throw new BadPathError('Import settings move with the file they annotate, so they are never moved on their own.')
  }

  // The other direction, which is easier to miss: a file renamed *to* a `.meta`
  // name becomes a sidecar for a file that does not exist, and the startup sweep
  // deletes stranded sidecars. It would quietly not survive the day.
  if (isMetaFileName(to.absolute)) {
    throw new BadPathError('A file cannot be renamed to end in .meta — that is how this editor names import settings.')
  }

  if (path.resolve(from.absolute) === path.resolve(to.absolute)) {
    throw new BadPathError(`${shownFrom} is already where you are asking to put it.`)
  }

  let source
  try {
    source = await fs.stat(from.absolute)
  } catch {
    throw new BadPathError(`There is nothing at ${shownFrom} to move.`)
  }

  const isDirectory = source.isDirectory()

  // A folder moved inside itself has nowhere to go: the operating system refuses
  // it with a code, and a code is not a sentence anybody can act on.
  if (isDirectory && isInside(from.absolute, to.absolute)) {
    throw new BadPathError(`${shownFrom} cannot be moved inside itself.`)
  }

  if (await exists(to.absolute)) {
    throw new BadPathError(`There is already something at ${shownTo}, and this editor never writes over it.`)
  }

  // Creating one is a privilege this service does not have and should not
  // acquire by accident — the same guard the create already carries (D22).
  const parent = path.dirname(to.absolute)
  try {
    const stats = await fs.stat(parent)
    if (!stats.isDirectory()) throw new BadPathError(`${shownTo} is inside something that is not a folder.`)
  } catch (error) {
    if (error instanceof BadPathError) throw error
    throw new BadPathError(
      `There is no folder at ${relativePosixPath(projectPath, parent)} to move it into, and this editor never creates one.`,
    )
  }

  // A folder's sidecars are inside it and travel as part of it; only a file has
  // one of its own to carry.
  const settingsFrom = isDirectory ? null : metaPathFor(from.absolute)
  const settingsTo = isDirectory ? null : metaPathFor(to.absolute)
  const carriesSettings = settingsFrom !== null && (await exists(settingsFrom))

  if (settingsTo !== null && (await exists(settingsTo))) {
    throw new BadPathError(
      `There are already import settings at ${relativePosixPath(projectPath, settingsTo)} with no file beside them. ` +
        'Delete those first.',
    )
  }

  const release = hold([
    from.absolute,
    to.absolute,
    ...(settingsFrom === null ? [] : [settingsFrom]),
    ...(settingsTo === null ? [] : [settingsTo]),
  ])

  try {
    // Settings first — see the ordering note at the top of this file.
    if (carriesSettings && settingsFrom !== null && settingsTo !== null) {
      await fs.rename(settingsFrom, settingsTo)

      try {
        await fs.rename(from.absolute, to.absolute)
      } catch (error) {
        // The file did not move, so its settings must not have either. Left as
        // it is, the sidecar would be stranded at the destination and the file
        // would have lost its id at the next startup.
        await fs.rename(settingsTo, settingsFrom).catch(() => undefined)
        throw error
      }
    } else {
      await fs.rename(from.absolute, to.absolute)
    }
  } finally {
    release()
  }

  return {
    format: FILE_CHANGE_FORMAT,
    version: FILE_CHANGE_VERSION,
    kind: 'moved',
    path: shownFrom,
    to: shownTo,
    isDirectory,
    settings: carriesSettings && settingsFrom !== null ? relativePosixPath(projectPath, settingsFrom) : null,
  }
}

/**
 * Deletes one file the editor names and the `.meta` beside it — or one folder
 * the editor names and everything under it.
 *
 * The folder half was refused for two days, and the reason it was refused is
 * worth keeping beside the reason it is not any more. "Delete this folder and
 * everything under it" is a blast radius, and the question the editor asks
 * before deleting — what still uses this? — seemed to stop having a short
 * answer at a hundred files. It has one now: the editor reads the project first
 * and says how many files are inside and how many of them something still
 * points at, and a human who has read that sentence and pressed again has
 * asked for exactly this. What made the widening safe is the guards, not the
 * count: a **link is refused** (looked at with `lstat`, because `stat` follows
 * a junction and calls it a folder — and this service does not look through
 * links, anywhere), and the **project folder itself is refused**. Both stay
 * inside the privilege's one sentence: the editor names a path and one thing
 * happens to it.
 *
 * Every path under the folder is held for the length of the request before the
 * removal starts, so the rule that writes fresh settings when a sidecar is
 * deleted out from under its file cannot fire mid-removal — the same guard the
 * single-file case has, over many. What is *not* done is anything to the
 * panel: the watcher's own events for the removal are what refresh it.
 */
export async function deleteFile(projectPath: string, requestedPath: string): Promise<FileChange> {
  const resolved = resolveInsideProject(projectPath, requestedPath)
  if (!resolved.ok) throw new BadPathError(resolved.problem)

  const shownPath = relativePosixPath(projectPath, resolved.absolute)

  let target
  try {
    // `lstat`, not `stat`: a junction is a folder to `stat` and a link to
    // `lstat`, and the difference is the whole of the refusal below.
    target = await fs.lstat(resolved.absolute)
  } catch {
    throw new BadPathError(`There is nothing at ${shownPath} to delete.`)
  }

  if (target.isSymbolicLink()) {
    throw new BadPathError(
      `${shownPath} is a link to somewhere else, and this editor does not look through links. Remove it in Explorer if it should go.`,
    )
  }

  if (target.isDirectory()) return deleteFolder(projectPath, resolved.absolute, shownPath)

  // Deleting a sidecar whose file is still there is how a human says "start
  // these settings over", and this service answers that by writing fresh ones
  // straight back (D17). Offering it as a delete would look like a control that
  // does nothing. A *stranded* sidecar has no file to belong to, and getting rid
  // of one is exactly what somebody looking at it wants.
  if (isMetaFileName(resolved.absolute)) {
    const annotated = annotatedPathFor(resolved.absolute)
    if (annotated !== null && (await exists(annotated))) {
      throw new BadPathError(
        `Those are the import settings for ${relativePosixPath(projectPath, annotated)}. ` +
          'Delete that file instead, or change the settings in the Inspector.',
      )
    }
  }

  const settings = metaPathFor(resolved.absolute)
  const hasSettings = !isMetaFileName(resolved.absolute) && (await exists(settings))

  const release = hold([resolved.absolute, settings])

  try {
    // The file first — see the ordering note at the top of this file.
    await fs.unlink(resolved.absolute)
    if (hasSettings) await remove(settings)
  } finally {
    release()
  }

  return {
    format: FILE_CHANGE_FORMAT,
    version: FILE_CHANGE_VERSION,
    kind: 'deleted',
    path: shownPath,
    to: null,
    isDirectory: false,
    settings: hasSettings ? relativePosixPath(projectPath, settings) : null,
  }
}

/**
 * The folder half of `deleteFile`. The root is refused; everything under the
 * folder is held, then the folder is removed in one call.
 */
async function deleteFolder(projectPath: string, absolute: string, shownPath: string): Promise<FileChange> {
  if (path.resolve(absolute) === path.resolve(projectPath)) {
    throw new BadPathError('The project folder itself cannot be deleted from inside the editor.')
  }

  const release = hold([absolute, ...(await everythingUnder(absolute))])
  try {
    await fs.rm(absolute, { recursive: true, force: false })
  } finally {
    release()
  }

  return {
    format: FILE_CHANGE_FORMAT,
    version: FILE_CHANGE_VERSION,
    kind: 'deleted',
    path: shownPath,
    to: null,
    isDirectory: true,
    settings: null,
  }
}

/** Every file and folder under a folder, absolute, at any depth. Links are listed but never entered. */
async function everythingUnder(folder: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      found.push(full)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(full)
    }
  }
  await walk(folder)
  return found
}

/** Whether `candidate` is the folder `parent` itself or anything under it. */
function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
