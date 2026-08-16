import { useCallback } from 'react'

import { messageOf } from '../../runtime/message-of'
import type { EditorDocument } from '../../sidecar/document-view-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { readDocumentFromDisk, writeDocumentToDisk } from '../store/document-disk'
import { deleteFileOnDisk, moveFileOnDisk } from '../store/file-disk'
import { adoptFromDisk, beginRead, currentSaveFailures, flushSaves } from '../store/open-documents'
import { useAssetBrowsing } from './asset-browsing'
import { useComponentTypes } from './component-types'
import { useProject } from './project-context'
import { usePlacing } from './placing'
import { documentPathsIn, movedPath, pointsAt, rewriteReferences, usesOf, type Described } from './references'
import { useSceneCameraMoved } from './scene-view-context'
import { useSelection } from './selection'

/**
 * Moving a file and deleting one, references and all.
 *
 * **The whole reason these verbs belong in the editor rather than in Explorer is
 * that the editor knows both the old path and the new one.** A rename made
 * outside arrives as a disappearance and an appearance, and nothing can pair
 * them; a rename made here is one gesture that ends with every level still
 * drawing what it drew.
 *
 * ## The order, which is the design
 *
 * 1. **Write everything outstanding first, and refuse if anything failed to
 *    save.** Every step after this reads documents off disk, so the disk has to
 *    be the truth before any of it starts. A file the editor is holding an
 *    unaccepted change for would otherwise be read in its old state, rewritten,
 *    and put back — losing the change and looking like the rename did it.
 *
 * 2. **Plan before anything moves.** Every `.json` in the project is read and
 *    the ones referring to the file are collected. **If any of them cannot be
 *    read, the whole operation is refused and nothing is renamed.** That is the
 *    answer to "what happens when the fixup can only half succeed": a level
 *    somebody broke by hand in a text editor is found while the file is still
 *    where every reference expects it, rather than after.
 *
 * 3. **Rename, then rewrite — in that order.** A rename that fails has broken
 *    nothing; rewriting first and then failing to rename would break every
 *    reference on the way to failing.
 *
 * 4. **Each document is re-read immediately before it is rewritten**, so what
 *    goes back is what was on disk a moment ago plus one path, rather than the
 *    copy taken during the plan. The cost is one extra read per affected file on
 *    a button press; what it buys is that a change made in a text editor during
 *    the operation is not silently written over.
 *
 * 5. **The rewrite is told to the store rather than left to the watcher.** The
 *    file is written and then handed to `adoptFromDisk`, which is exactly what
 *    happened — the file changed underneath the editor. Waiting for the watcher
 *    instead leaves a window of a few hundred milliseconds in which the open
 *    level in the store still holds the old path, and one keystroke in it would
 *    schedule a save that puts the old path straight back.
 *
 * ## Why none of this is undoable
 *
 * **Nothing here goes through `edit`, and that is deliberate rather than
 * unfinished.** A rewrite is a change to documents, and changes to documents
 * land on the undo stack by default — so the obvious implementation gives you a
 * Ctrl-Z that puts every path back to the old name and leaves the file at the
 * new one, which is precisely the broken state this feature exists to remove.
 *
 * The stack could be taught to carry the file operation too, and then a single
 * press would be the first undo step in this editor that can *fail* when it is
 * pressed: the old name may be taken again, the file may be gone. One key that
 * usually reverses a change and occasionally reports an error is a different key
 * (`editor-kernel` D7). Deleting is the easier half of the same answer — its
 * inverse is creating a file, which was never on this stack either.
 */

/** What a document that points at the file being moved turned out to be. */
interface Planned {
  path: string
  uses: number
}

export interface UseReport {
  /** The documents that point at it, in the order the folder lists them. */
  files: string[]
  /** How many references altogether, across all of them. */
  count: number
  /** Documents that could not be read, so this report is incomplete. */
  unreadable: string[]
}

export type Outcome =
  /** It happened. `note` names anything that could not be finished, or is null. */
  | { ok: true; note: string | null }
  /** Nothing was touched. One plain sentence saying why. */
  | { ok: false; problem: string }

export interface FileMoves {
  /** Which documents still point at this path. Asked before a delete. */
  findUses: (target: string) => Promise<UseReport>
  move: (from: string, to: string) => Promise<Outcome>
  remove: (path: string) => Promise<Outcome>
}

/**
 * The one file the export reads by name (`scripts/export/plan.ts`).
 *
 * Everywhere else the editor refuses to know where a file lives — `scenes/` is a
 * convention in the folder map and a document says what it is from the inside
 * (`editor-ui` U11/U22). This is the exception, and it is one because it is not a
 * convention: the export command looks this name up, so a project whose settings
 * have been renamed has no settings at all, and nothing in the editor can make a
 * new one. Refusing here is telling the truth about a constraint that exists
 * rather than inventing one.
 */
const PROJECT_FILE = 'project.json'

export function useFileMoves(): FileMoves {
  const project = useProject()
  const selection = useSelection()
  const placing = usePlacing()
  const cameraMoved = useSceneCameraMoved()
  const { pathMoved } = useAssetBrowsing()
  // The game's own descriptions say where a described component's references
  // are, so a rename can follow a door's level or a picture a game's component
  // picked, the same as it follows a sprite's texture (`./references.ts`).
  const described = useComponentTypes().byType

  const tree = project.state === 'ready' ? project.tree : null

  const { selectedFilePath, openScene, selectFile, selectNothing, setOpenScene } = selection
  const { stamping, startStamping, stopStamping } = placing

  const findUses = useCallback(
    async (target: string): Promise<UseReport> => plan(tree, target, described),
    [tree, described],
  )

  const move = useCallback(
    async (from: string, to: string): Promise<Outcome> => {
      if (from === PROJECT_FILE) {
        return { ok: false, problem: `${PROJECT_FILE} is the name an export looks for, so it cannot be moved or renamed.` }
      }

      const settled = await settle()
      if (settled !== null) return settled

      const found = await plan(tree, from, described)
      if (found.unreadable.length > 0) {
        return {
          ok: false,
          problem: `${found.unreadable[0] ?? ''} could not be read, so its references could not be followed. Nothing has been moved.`,
        }
      }

      try {
        await moveFileOnDisk(from, to)
      } catch (error) {
        return { ok: false, problem: messageOf(error) }
      }

      const failed = await rewriteAll(found.files, from, to, described)

      // Follow it with whatever was looking at it. Not part of the document and
      // never undoable (`editor-ui` U8) — this is where the human's eye is, not
      // what they changed.
      if (selectedFilePath !== null) {
        const moved = movedPath(selectedFilePath, from, to)
        if (moved !== null) selectFile(moved)
      }
      if (openScene !== null) {
        const moved = movedPath(openScene, from, to)
        if (moved !== null) {
          cameraMoved(openScene, moved)
          setOpenScene(moved)
        }
      }
      // Repeat-placing is keyed on a path too, so it needs the same treatment
      // as the camera (`editor-ui` U30). Without it, renaming the prefab you
      // are half way through drawing a board with leaves every further click
      // silently placing nothing.
      if (stamping !== null) {
        const moved = movedPath(stamping, from, to)
        if (moved !== null) startStamping(moved)
      }
      // And so is where the Assets panel is *browsing*: rename the folder you
      // are standing in and the icon view would otherwise be looking at a path
      // that no longer exists (`editor-ui` U30 again).
      pathMoved(from, to)

      return { ok: true, note: noteFor(failed, to) }
    },
    [
      tree,
      described,
      selectedFilePath,
      openScene,
      selectFile,
      setOpenScene,
      cameraMoved,
      stamping,
      startStamping,
      pathMoved,
    ],
  )

  const remove = useCallback(
    async (path: string): Promise<Outcome> => {
      if (path === PROJECT_FILE) {
        return { ok: false, problem: `${PROJECT_FILE} is the name an export looks for, and nothing in this editor can make another one.` }
      }

      const settled = await settle()
      if (settled !== null) return settled

      try {
        await deleteFileOnDisk(path)
      } catch (error) {
        return { ok: false, problem: messageOf(error) }
      }

      if (selectedFilePath !== null && pointsAt(selectedFilePath, path)) selectNothing()
      if (openScene !== null && pointsAt(openScene, path)) setOpenScene(null)
      // A mode whose subject has been deleted is over. Left on, every click
      // would go on meaning "place one" and place nothing.
      if (stamping !== null && pointsAt(stamping, path)) stopStamping()

      return { ok: true, note: null }
    },
    [selectedFilePath, openScene, selectNothing, setOpenScene, stamping, stopStamping],
  )

  return { findUses, move, remove }
}

/**
 * Everything the editor is holding, on disk, before anything is read off it.
 *
 * Answers with a refusal when a file has a change the folder never accepted —
 * the same guard Play makes before it hands a level to the runtime, and for the
 * same reason: what is about to be read has to be what is on screen.
 */
async function settle(): Promise<Outcome | null> {
  await flushSaves()

  const failed = Object.keys(currentSaveFailures())
  const first = failed[0]
  if (first === undefined) return null

  return {
    ok: false,
    problem: `${first} is holding a change this editor could not save, so nothing has been moved. Fix that first.`,
  }
}

/** Reads every document in the project and reports which of them point at a path. */
async function plan(tree: ProjectTree | null, target: string, described: Described): Promise<UseReport> {
  if (tree === null) return { files: [], count: 0, unreadable: [] }

  const found: Planned[] = []
  const unreadable: string[] = []

  for (const path of documentPathsIn(tree)) {
    const read = await readDocumentFromDisk(path)
    if (!read.ok) {
      // **Only a file that might have been this editor's counts.** A project is
      // full of `.json` that is none of the editor's business — the data tables
      // whose formats do not exist yet, anything a genre layer or a newer editor
      // wrote — and none of it can hold a reference this editor understands.
      // Refusing over those would mean the feature never works in a real
      // project. Refusing over a *level* that will not parse is the entire
      // point: that is the file whose reference would be left behind.
      if (!read.foreign) unreadable.push(path)
      continue
    }

    const uses = usesOf(read.document, target, described)
    if (uses > 0) found.push({ path, uses })
  }

  return {
    files: found.map((one) => one.path),
    count: found.reduce((total, one) => total + one.uses, 0),
    unreadable,
  }
}

/**
 * Rewrites each affected document and answers with the ones that would not take
 * it.
 *
 * A write that fails here leaves that one document pointing at the old path, and
 * the level then says a picture is missing through the machinery that already
 * exists. Named rather than swallowed, and named rather than rolled back: the
 * file has moved, and putting the other rewrites back would break the documents
 * that are currently correct.
 */
async function rewriteAll(
  paths: readonly string[],
  from: string,
  to: string,
  described: Described,
): Promise<string[]> {
  const failed: string[] = []

  for (const planned of paths) {
    // The document may itself have moved: renaming a folder moves the levels
    // inside it *and* whatever those levels point at. The plan was made against
    // the folder as it was, so every path in it is addressed as it was.
    const path = movedPath(planned, from, to) ?? planned

    try {
      // Re-read rather than reuse the copy taken during the plan, so a change
      // made in a text editor a moment ago is not written over.
      const read = await readDocumentFromDisk(path)
      if (!read.ok) {
        failed.push(path)
        continue
      }

      const rewritten: EditorDocument | null = rewriteReferences(read.document, from, to, described)
      // It stopped referring to the file between the plan and now. Writing an
      // identical document would churn a file nobody changed.
      if (rewritten === null) continue

      await writeDocumentToDisk(path, rewritten)

      // Told rather than left to the watcher: the file changed underneath the
      // editor, which is exactly what `adoptFromDisk` is for. The token is taken
      // after the write so it can never look older than one of the store's own,
      // and the watcher's echo that follows is then identity (`editor-kernel`
      // G10).
      adoptFromDisk(path, rewritten, beginRead())
    } catch {
      failed.push(path)
    }
  }

  return failed
}

function noteFor(failed: readonly string[], to: string): string | null {
  if (failed.length === 0) return null
  return `${to} moved, but ${failed.join(', ')} could not be updated and still points at where it was.`
}
