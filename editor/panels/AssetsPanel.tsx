import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'

import { formatBytes } from '../../sidecar/bytes'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { showsGrid, showsTree, useAssetBrowsing } from '../shell/asset-browsing'
import { basename, findNode, folderPathsIn, parentOf } from '../shell/asset-kinds'
import { assetRowsFor, type AssetRow } from '../shell/asset-rows'
import { spotIn, type Room, type Spot } from '../shell/floating'
import { useProject } from '../shell/project-context'
import { pointsAt } from '../shell/references'
import { useSelection } from '../shell/selection'
import { NOT_DRAGGABLE, useAssetDrag, type AssetDragProps } from '../shell/useAssetDrag'
import { useFileMoves, type Outcome, type UseReport } from '../shell/useFileMoves'
import { useFolderHistoryButtons } from '../shell/useFolderHistoryButtons'
import { useMenuDismiss } from '../shell/useMenuDismiss'
import { AssetBar } from './AssetBar'
import { AssetGrid } from './AssetGrid'
import { NewDocument, NEW_DOCUMENT_ROOM } from './NewDocument'
import { SplitHandle } from './SplitHandle'

/**
 * The project folder, mirrored. Selecting anything here is what the Inspector
 * answers about.
 *
 * Which rows a folder has — and why a `.meta` is folded into the row of the
 * file it annotates — is decided in `asset-rows.ts`, because the Inspector has
 * to count a folder's contents the same way this lists them.
 *
 * **Every verb this panel has is behind a right-click now, and the panel itself
 * is the folder and one sentence.** A right-click on a file or folder offers
 * rename, move, delete and make-one-here; a right-click on the background offers
 * make-one-here alone; the `+` on the bar is the same card again for a hand that
 * has not learned the press. Three doors, **one** menu state, so two can never be
 * on screen at once — the shape the entity right-click window keeps
 * (`editor-ui` U44).
 *
 * Which menu a press opens is decided by what it landed on, which is the reading
 * every file browser has trained every hand to expect: a file gets the things you
 * do *to* a file, the background gets the thing you do *in* a folder.
 *
 * Where a level goes is the human's decision, taken from what they have selected
 * — no folder name is written into the code, because `scenes/` is a convention
 * in the folder map and not a fact this editor is allowed to rely on. The card
 * says the whole path before anything is committed, from every door. "Make one
 * in *this* folder" needs no argument of its own for the same reason: the press
 * that opened the menu selected the folder.
 *
 * **There are three ways to look at the same folder**, chosen behind the cog and
 * held above the layout in `asset-browsing.tsx`: the tree, the icon grid, and
 * both at once. They are two components either side of one bar rather than three
 * panels or three components, because everything above the split — making a
 * file, renaming one, deleting one, where you are — is the same question
 * whichever half is on screen.
 *
 * The panel is a column that does not scroll: the bar keeps its place at the
 * top, each half of the split scrolls on its own, and one line of hint sits
 * under both. A single scroller would mean walking down the tree in the split
 * view carried the grid's first row off the top of the panel.
 *
 * **That hint line replaced a footer that had to be a fixed share of the panel,
 * and the reason it had to be is worth keeping.** The footer held the rename
 * controls, whose contents changed with the selection — so if it had sized
 * itself to them, the first press of a double-click would have brought the
 * rename row into existence, moved every tile, and left the second press landing
 * on whatever slid into that spot: the folder never opens, nothing reports an
 * error, and the panel simply does not respond to a double-click. That is how it
 * was found, and reserving a fixed share was the fix. Moving those controls into
 * a floating menu answers it the other way — nothing down there changes any more
 * — so the reservation is gone and the browser has the room. It is `editor-ui`
 * UG8 in a panel with no canvas in it: **what a gesture is aimed at must not be
 * moved by the first half of that gesture**, and a floating card moves nothing.
 *
 * The sentence stays because a gesture nobody is told about is a gesture nobody
 * uses, and there is nowhere else on screen that could name a right-click.
 */
export function AssetsPanel(): ReactElement {
  const project = useProject()
  const selection = useSelection()
  const browsing = useAssetBrowsing()
  const dragProps = useAssetDrag()
  const body = useRef<HTMLDivElement>(null)
  // The same element again, as state: the browsing area does not exist until
  // the folder has been read, and the side-button guard has to notice the
  // moment it appears — a ref read once in an effect would arm against null
  // and guard nothing (see the note in `useFolderHistoryButtons`). The ref
  // stays for the split handle, which only ever reads it mid-drag.
  const [browseSurface, setBrowseSurface] = useState<HTMLDivElement | null>(null)
  const adoptBody = (element: HTMLDivElement | null): void => {
    body.current = element
    setBrowseSurface(element)
  }

  // The mouse's side buttons, over the browsing area only. Off in the tree-only
  // view, where there is no folder to be inside of.
  useFolderHistoryButtons({ surface: browseSurface, enabled: showsGrid(browsing.view) })

  // **One menu, three doors.** The `+`, a right-click on the background, and a
  // right-click on a file are three ways into two cards, and only ever one of
  // them may be on screen (`editor-ui` U44) — so they share one piece of state
  // rather than one each. `at` is in the panel's own pixels, which is why the
  // bar's door has none: it hangs under its own button.
  const [menu, setMenu] = useState<AssetMenu | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const dismissMenu = useMenuDismiss(menu !== null && menu.kind !== 'bar', () => {
    setMenu(null)
  })

  /**
   * The two things that take the file menu's subject away: the file leaving the
   * project, and the selection moving off it.
   *
   * Both are the entity window's ways-out one panel over, and both have to be
   * here rather than derived at render, or the menu would come back the next
   * time that path happened to be selected again. A rename is *both* of them at
   * once — the old path stops existing and the selection follows the new one —
   * which is why a successful rename needs no closing code of its own.
   */
  const tree = project.state === 'ready' ? project.tree : null
  const selectedPath = selection.selectedFilePath
  useEffect(() => {
    setMenu((was) => {
      if (was?.kind !== 'file') return was
      if (was.path !== selectedPath) return null
      return tree === null || findNode(tree, was.path) === null ? null : was
    })
  }, [tree, selectedPath])

  const reveal = (path: string): void => {
    browsing.revealParents(path)
    selection.selectFile(path)
  }

  /** It exists: show it, select it, and put the menu away. */
  const created = (path: string): void => {
    setMenu(null)
    reveal(path)
  }

  /** Where a card opened by this press should sit, in the panel's own pixels. */
  const spotFor = (event: MouseEvent<HTMLElement>, room: Room): Spot => {
    const box = panel.current?.getBoundingClientRect()
    return spotIn(
      box,
      { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) },
      room,
    )
  }

  /**
   * A right-click in the browser, which asks about whatever it landed on.
   *
   * **Two menus, one press, and which one is decided by the target** — a file or
   * folder gets the three things you do *to* a file, the background gets the one
   * thing you do *in* a folder. That is the same reading a file browser has
   * trained every hand to expect, and it is why the row does not stop the press
   * itself (`editor-ui` U44's gotcha: React's `stopPropagation` stops the native
   * event too, and this one has to stay observable).
   */
  const onBrowserContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    const row = event.target instanceof HTMLElement ? event.target.closest('[data-asset-path]') : null
    const path = row instanceof HTMLElement ? row.getAttribute('data-asset-path') : null

    event.preventDefault()

    if (path === null) {
      setMenu({ kind: 'browser', at: spotFor(event, NEW_DOCUMENT_ROOM) })
      return
    }

    // Selected as well as asked about, so the row, the Inspector and this menu
    // all describe one file — what the entity window's right-click does.
    selection.selectFile(path)
    setMenu({ kind: 'file', path, at: spotFor(event, FILE_MENU_ROOM) })
  }

  if (project.state === 'loading') {
    return <p className="assets__message">Reading the project folder…</p>
  }

  if (project.state === 'unavailable') {
    return (
      <p className="assets__message assets__message--bad" data-testid="assets-unavailable">
        {project.reason} Is the editor command still running?
      </p>
    )
  }

  const shown = project.tree
  // One answer for every door, so a file made from the bar, from a right-click
  // on the background, and from a right-click on a folder all land in the same
  // place — the last of those being the whole of "make a level in this folder",
  // since the press selected the folder on its way in.
  const folder = folderFor(
    selection.selectedFilePath,
    shown,
    showsGrid(browsing.view) ? browsing.folder : null,
  )
  // The file the file-menu is about, or null. Null is also how it closes when
  // its file has gone: there is nothing to draw.
  const subject = menu?.kind === 'file' ? findNode(shown, menu.path) : null

  return (
    <div
      className="assets"
      data-testid="assets-panel"
      data-live={project.live}
      data-view={browsing.view}
      data-new-document={menu?.kind === 'bar' ? 'bar' : menu?.kind === 'browser' ? 'browser' : ''}
      data-file-menu={subject?.path ?? ''}
      ref={panel}
    >
      {!project.live && (
        <p className="assets__stale" data-testid="assets-stale">
          Not hearing about changes — this may be out of date.
        </p>
      )}

      <AssetBar
        projectName={shown.projectName}
        newDocument={{
          open: menu?.kind === 'bar',
          toggle: () => {
            setMenu((was) => (was?.kind === 'bar' ? null : { kind: 'bar' }))
          },
          close: () => {
            setMenu(null)
          },
          folder,
          onCreated: created,
        }}
      />

      <div className="assets__body" ref={adoptBody} onContextMenu={onBrowserContextMenu}>
        {showsTree(browsing.view) && (
          <div
            className="assets__pane assets__pane--tree"
            data-testid="assets-list"
            // Only in the split view does the tree have a width of its own to
            // be told; on its own it takes the whole panel.
            style={
              browsing.view === 'split'
                ? { flex: `0 0 ${(browsing.splitFraction * 100).toFixed(2)}%` }
                : undefined
            }
          >
            <ul className="assets__tree" role="tree" aria-label="Project folder">
              {assetRowsFor(shown.tree.children).map((row) => (
                <AssetNode
                  key={row.node.path}
                  row={row}
                  depth={0}
                  expanded={browsing.expanded}
                  selected={selection.selectedFilePath}
                  onToggle={browsing.toggleFolder}
                  onSelect={selection.selectFile}
                  // Picking a folder in the tree is what sends the grid into it,
                  // which is the whole of what the split view is for. Harmless
                  // in the tree-only view, where no grid is listening.
                  onOpenFolder={browsing.openFolder}
                  dragProps={dragProps}
                />
              ))}
            </ul>

            {shown.tree.children.length === 0 && (
              <p className="assets__message">This project folder is empty.</p>
            )}
          </div>
        )}

        {browsing.view === 'split' && <SplitHandle body={body} />}

        {showsGrid(browsing.view) && (
          <div className="assets__pane assets__pane--grid" data-testid="assets-icons">
            <AssetGrid tree={shown} />
          </div>
        )}
      </div>

      {menu?.kind === 'browser' && (
        <div
          className="assets__menu assets__menu--new assets__menu--at"
          role="menu"
          data-testid="assets-new-menu"
          style={menu.at}
          ref={dismissMenu.box}
          onKeyDown={dismissMenu.onKeyDown}
        >
          <NewDocument folder={folder} onCreated={created} />
        </div>
      )}

      {menu?.kind === 'file' && subject !== null && (
        <div
          className="assets__menu assets__menu--file assets__menu--at"
          role="menu"
          data-testid="assets-file-menu"
          data-file={subject.path}
          style={menu.at}
          ref={dismissMenu.box}
          onKeyDown={dismissMenu.onKeyDown}
        >
          <header className="entity-popover__bar">
            <span className="entity-popover__name" title={subject.path}>
              {subject.name}
            </span>
            <button
              type="button"
              className="entity-popover__close"
              data-testid="assets-file-menu-close"
              aria-label="Close"
              title="Close (Esc)"
              onClick={() => {
                setMenu(null)
              }}
            >
              ✕
            </button>
          </header>

          {/* Keyed on the path, so a menu opened on a different file starts the
              control over rather than leaving somebody else's typed name,
              refusal or half-pressed Delete under it (`editor-ui` UG5, answered
              by remounting rather than by comparing). */}
          <MoveOrDelete key={subject.path} path={subject.path} tree={shown} onMoved={reveal} />

          {/* The third thing a hand wants here, and it is the *other* menu: a
              press hands over to the make-a-file card at the same spot, which
              already puts the file in this folder because the press that opened
              this menu selected it. */}
          <div className="assets__menu-foot">
            <button
              type="button"
              className="control control--action"
              data-testid="assets-file-menu-new"
              title={`Make a level or prefab in ${folder === '' ? 'the top of the project' : folder}`}
              onClick={() => {
                setMenu({ kind: 'browser', at: menu.at })
              }}
            >
              New level or prefab here
            </button>
          </div>
        </div>
      )}

      {/* The footer is one unchanging sentence now, which is what lets it be as
          small as its own text: everything that used to live here is behind a
          right-click, so nothing in it grows or shrinks with the selection and
          the browser above can no longer be resized under a double-click
          (`editor-ui` UG8, finally answered by removal rather than by
          reservation). It stays because a gesture nobody is told about is a
          gesture nobody uses, and there is nowhere else on screen to say it. */}
      <p className="assets__hint" data-testid="assets-hint">
        Right-click a file to rename, move or delete it — or the empty space, or{' '}
        <strong>+</strong> in the bar, to make a level or prefab.
      </p>
    </div>
  )
}

/**
 * The one menu this panel has open, if any: which of the three doors opened it,
 * and — for the two that were opened by a press — where it sits.
 *
 * A union rather than a pair of flags and an optional point, for `selection.tsx`'s
 * reason: a pair can spell states that are not real (a bar menu with a point, a
 * file menu with no file) and every reader would then have to know which
 * combinations to ignore. The bar's case carries no point because that card
 * hangs under its own button by CSS, the way the cog's does.
 */
type AssetMenu =
  | { kind: 'bar' }
  | { kind: 'browser'; at: Spot }
  | { kind: 'file'; path: string; at: Spot }

/**
 * Roughly how much room the file menu needs, for deciding which side of the
 * press to open on (`../shell/floating.ts`).
 *
 * Bigger than the make-a-file card because it holds a name, a folder chooser,
 * two buttons and a line of destination — and it grows again when it has a
 * refusal or a list of what still uses the file to show, which is exactly why
 * the card is pinned by the edge nearest the press rather than by its top.
 */
const FILE_MENU_ROOM: Room = { width: 258, height: 212 }

// --- making a level --------------------------------------------------------

/**
 * Which folder a new file goes in: the selected folder, the selected file's
 * folder, the folder the grid is standing in, or the top of the project.
 *
 * Read from the tree rather than guessed from the path, because whether
 * `scenes` is a folder or a file called `scenes` is a fact about the project and
 * not about the string.
 *
 * The grid's folder is the fallback rather than the answer — a selection is
 * always the stronger signal, and `browsed` is null whenever no grid is on
 * screen, because a folder nobody can see is not a place the human chose.
 */
function folderFor(selectedPath: string | null, tree: ProjectTree, browsed: string | null): string {
  const standingIn = browsed ?? ''
  if (selectedPath === null) return standingIn

  const node = findNode(tree, selectedPath)
  if (node === null) return standingIn
  if (node.kind === 'directory') return node.path

  return node.path.split('/').slice(0, -1).join('/')
}

// --- renaming, moving and deleting -----------------------------------------

/**
 * The other three verbs, for whatever is selected.
 *
 * **Renaming and moving are one control, because they are one operation.** To
 * the filesystem and to the reference fixup there is no difference between them:
 * a file that was at one path is now at another. Two rows would imply the answers
 * differ — that renaming asks something moving does not — and the human would
 * have to learn a distinction the editor does not have. So there is one name
 * field, one folder, one destination on screen, and a button whose *word* changes
 * to say which of the two this will be.
 *
 * The path preview is U22's rule applied to a file that already exists, and it
 * matters more here than it did there: making a file in the wrong place leaves
 * you with a file in the wrong place, where moving one in the wrong place leaves
 * you looking for something that used to be findable.
 *
 * **Delete takes two presses, and the first one is the sentence.** Refusing to
 * delete a file something still uses would break the reason a human most often
 * deletes one — they are about to put a better version in its place — and would
 * send them back to Explorer, where nothing gets fixed up at all. Deleting
 * silently ignores that they asked to be told. So the first press reads every
 * document in the project and says what points at this file; the second does it.
 *
 * Every refusal is the service's own sentence where it has one, because it knows
 * things this panel does not (`editor-ui` U22): whether the name is taken,
 * whether the folder is there, whether those import settings have a file beside
 * them.
 */
function MoveOrDelete({
  path,
  tree,
  onMoved,
}: {
  path: string
  tree: ProjectTree
  onMoved: (path: string) => void
}): ReactElement | null {
  const { findUses, move, remove } = useFileMoves()

  const node = findNode(tree, path)
  const isFolder = node !== null && node.kind === 'directory'

  const [name, setName] = useState(basename(path))
  const [folder, setFolder] = useState(parentOf(path))
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [uses, setUses] = useState<UseReport | null>(null)
  const [busy, setBusy] = useState(false)

  if (node === null) return null

  const typed = name.trim()
  const destination = typed === '' ? '' : folder === '' ? typed : `${folder}/${typed}`
  const unchanged = destination === path
  const verb = folder === parentOf(path) ? 'Rename' : 'Move'

  // A folder cannot be moved inside itself, and offering the choice would be
  // offering a mistake. The service refuses it too — this is so the human never
  // has to be refused for something they could not have wanted.
  const folders = folderPathsIn(tree).filter((candidate) => !isFolder || !pointsAt(candidate, path))

  const settle = (outcome: Outcome, then: () => void): void => {
    if (outcome.ok) {
      setProblem(null)
      setNote(outcome.note)
      then()
      return
    }
    setProblem(outcome.problem)
    setNote(null)
  }

  const onMove = (): void => {
    if (typed === '' || unchanged || busy) return
    setBusy(true)
    setProblem(null)
    setNote(null)
    void move(path, destination)
      .then((outcome) => {
        settle(outcome, () => {
          onMoved(destination)
        })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const onDelete = (): void => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    setNote(null)

    // The first press asks the question. The second one, which is the only one
    // that can reach the service, is the answer.
    const step =
      uses === null
        ? findUses(path).then((report) => {
            setUses(report)
          })
        : remove(path).then((outcome) => {
            settle(outcome, () => {
              setUses(null)
            })
          })

    void step.finally(() => {
      setBusy(false)
    })
  }

  return (
    <div className="assets__move" data-testid="move-file">
      <div className="assets__new-row">
        <input
          type="text"
          className="control control--text"
          data-testid="move-file-name"
          aria-label={`New name for ${basename(path)}`}
          // The cursor lands here when the menu opens, which is both the
          // ordinary thing to want and the thing that makes `Esc` work: the
          // menu's Escape is handled on its own subtree rather than on the
          // window (`../shell/useMenuDismiss.ts`), so with the focus still out
          // on the row that opened it, the key would never reach the menu.
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setProblem(null)
            setUses(null)
          }}
        />
        <select
          className="control control--choice"
          data-testid="move-file-folder"
          aria-label={`Folder for ${basename(path)}`}
          value={folder}
          onChange={(event) => {
            setFolder(event.target.value)
            setProblem(null)
            setUses(null)
          }}
        >
          <option value="">the top of the project</option>
          {folders.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="control control--action"
          data-testid="move-file-apply"
          disabled={typed === '' || unchanged || busy}
          onClick={onMove}
        >
          {verb}
        </button>
        {!isFolder && (
          <button
            type="button"
            className="control control--action"
            data-testid="move-file-delete"
            disabled={busy}
            onClick={onDelete}
          >
            {uses === null ? 'Delete' : 'Delete anyway'}
          </button>
        )}
      </div>

      <p className="assets__new-path" data-testid="move-file-destination">
        {unchanged ? (
          <>
            <strong>{path}</strong> — type a new name or pick another folder
          </>
        ) : (
          <>
            Will {verb.toLowerCase()} to <strong>{destination}</strong>
          </>
        )}
      </p>

      {isFolder && (
        <p className="assets__new-path" data-testid="move-file-folder-note">
          A folder can be renamed or moved here. Deleting one is still a job for the folder itself.
        </p>
      )}

      {uses !== null && (
        <p className="assets__move-uses" data-testid="move-file-uses">
          {describeUses(uses, basename(path))}
        </p>
      )}

      {note !== null && (
        <p className="assets__move-uses" data-testid="move-file-note">
          {note}
        </p>
      )}

      {problem !== null && (
        <p className="assets__new-problem" data-testid="move-file-problem">
          {problem}
        </p>
      )}
    </div>
  )
}

/** What a delete is about to cost, as the sentence shown before it happens. */
function describeUses(report: UseReport, name: string): string {
  const incomplete =
    report.unreadable.length === 0
      ? ''
      : ` ${report.unreadable.join(', ')} could not be read, so there may be more.`

  if (report.files.length === 0) {
    return `Nothing else in the project uses ${name}. Press Delete again to remove it.${incomplete}`
  }

  const places = report.count === 1 ? 'once' : `${report.count} times`
  return (
    `${name} is still used ${places}, in ${report.files.join(', ')}. ` +
    `Deleting it leaves those pointing at nothing. Press Delete again to do it anyway.${incomplete}`
  )
}

interface AssetNodeProps {
  row: AssetRow
  depth: number
  expanded: ReadonlySet<string>
  selected: string | null
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  onOpenFolder: (path: string) => void
  /** What makes a file draggable. Asked per row, and never for a folder. */
  dragProps: (path: string) => AssetDragProps
}

function AssetNode({
  row,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
  onOpenFolder,
  dragProps,
}: AssetNodeProps): ReactElement {
  const { node } = row
  const isFolder = node.kind === 'directory'
  const isOpen = isFolder && expanded.has(node.path)

  return (
    <li className="asset-row" role="treeitem" aria-expanded={isFolder ? isOpen : undefined}>
      <button
        type="button"
        className="asset-row__button"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        {...(isFolder ? NOT_DRAGGABLE : dragProps(node.path))}
        data-asset-path={node.path}
        data-kind={node.kind}
        data-selected={selected === node.path}
        data-has-settings={row.hasSettings}
        data-orphaned-settings={row.isOrphanedSettings}
        onClick={() => {
          onSelect(node.path)
          if (!isFolder) return
          onToggle(node.path)
          onOpenFolder(node.path)
        }}
      >
        <span className="asset-row__chevron" aria-hidden="true">
          {isFolder ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="asset-row__name">{node.name}</span>
        {row.hasSettings && (
          <span className="asset-row__badge" title="Has import settings beside it">
            meta
          </span>
        )}
        {row.isOrphanedSettings && (
          <span className="asset-row__badge asset-row__badge--orphan" title="Import settings with no file beside them">
            orphaned
          </span>
        )}
        {!isFolder && <span className="asset-row__size">{formatBytes(node.size)}</span>}
      </button>

      {isFolder && isOpen && (
        <ul className="assets__tree" role="group">
          {assetRowsFor(node.children).map((child) => (
            <AssetNode
              key={child.node.path}
              row={child}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpenFolder={onOpenFolder}
              dragProps={dragProps}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
