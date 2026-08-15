import { useRef, useState, type MouseEvent, type ReactElement } from 'react'

import { formatBytes } from '../../sidecar/bytes'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { showsGrid, showsTree, useAssetBrowsing } from '../shell/asset-browsing'
import { basename, findNode, folderPathsIn, parentOf } from '../shell/asset-kinds'
import { assetRowsFor, type AssetRow } from '../shell/asset-rows'
import { spotIn, type Spot } from '../shell/floating'
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
 * It is also the one panel that makes a file, and **making one is a menu with
 * two doors**: the `+` on the bar, and a right-click on the empty part of the
 * browser. Neither is a permanent row, because the panel's job is to show the
 * folder and a control used once an afternoon should not hold room that is
 * looked at all day. The menu itself is `NewDocument.tsx`; what is here is the
 * one anchor both doors open — one menu, never two, the same shape the entity
 * right-click window keeps (`editor-ui` U44).
 *
 * Only the *background* of the browser opens it. A right-click on a file or a
 * folder is left to the browser's own menu, because there is nothing built for
 * a file yet and a dead right-click is worse than the one the machine offers.
 *
 * Where a level goes is the human's decision, taken from what they have selected
 * — no folder name is written into the code, because `scenes/` is a convention
 * in the folder map and not a fact this editor is allowed to rely on. The menu
 * says the whole path before anything is committed, from either door.
 *
 * **There are three ways to look at the same folder**, chosen behind the cog and
 * held above the layout in `asset-browsing.tsx`: the tree, the icon grid, and
 * both at once. They are two components either side of one bar rather than three
 * panels or three components, because everything above the split — making a
 * file, renaming one, deleting one, where you are — is the same question
 * whichever half is on screen.
 *
 * The panel is a column that does not scroll: the bar keeps its place at the
 * top, each half of the split scrolls on its own, and the controls are a footer
 * under both. A single scroller would mean walking down the tree in the split
 * view carried the grid's first row off the top of the panel.
 *
 * **The controls hold a fixed share of the panel and scroll inside it, and that
 * is load-bearing rather than tidiness.** What they contain changes with the
 * selection: the rename row is not there until something is selected, and it
 * says a different number of things about a folder than about a file. If the
 * browser resized when they did, the first press of a double-click would bring
 * the rename row into existence, every tile would move, and the second press
 * would land on whatever slid into that spot — the folder never opens, nothing
 * reports an error, and the panel simply does not respond to a double-click.
 * That is how this was found.
 *
 * **So the footer keeps its share even when it holds nothing**, which is why
 * with nothing selected it says where the two doors to the new-file menu are
 * rather than sitting blank. The room is already spoken for; a sentence in it is
 * free, and it is the only place on screen that could teach a gesture that is
 * now behind a right-click.
 *
 * It is `editor-ui` UG8 in a panel with no canvas in it: **what a gesture is
 * aimed at must not be moved by the first half of that gesture.**
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

  // The make-a-file menu, and which door opened it. One piece of state for both,
  // so the `+` and the right-click can never both be showing one (`editor-ui`
  // U44); `at` is in the panel's own pixels and only the right-click has one.
  const [newDocument, setNewDocument] = useState<NewDocumentAnchor | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const dismissBrowserMenu = useMenuDismiss(newDocument?.from === 'browser', () => {
    setNewDocument(null)
  })

  const reveal = (path: string): void => {
    browsing.revealParents(path)
    selection.selectFile(path)
  }

  /** It exists: show it, select it, and put the menu away. */
  const created = (path: string): void => {
    setNewDocument(null)
    reveal(path)
  }

  /**
   * A right-click in the browser, which offers to make a file *here*.
   *
   * Only the background: a press that landed on a row or a tile is somebody
   * else's, and is left to the browser's own menu rather than being swallowed
   * into a menu that would say nothing about the file under the cursor.
   */
  const onBrowserContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof HTMLElement)) return
    if (event.target.closest('[data-asset-path]') !== null) return

    event.preventDefault()
    const box = panel.current?.getBoundingClientRect()
    setNewDocument({
      from: 'browser',
      at: spotIn(
        box,
        { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) },
        NEW_DOCUMENT_ROOM,
      ),
    })
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

  const tree = project.tree
  // One answer for both doors, so a file made from the bar and a file made from
  // a right-click land in the same place.
  const folder = folderFor(
    selection.selectedFilePath,
    tree,
    showsGrid(browsing.view) ? browsing.folder : null,
  )

  return (
    <div
      className="assets"
      data-testid="assets-panel"
      data-live={project.live}
      data-view={browsing.view}
      data-new-document={newDocument?.from ?? ''}
      ref={panel}
    >
      {!project.live && (
        <p className="assets__stale" data-testid="assets-stale">
          Not hearing about changes — this may be out of date.
        </p>
      )}

      <AssetBar
        projectName={tree.projectName}
        newDocument={{
          open: newDocument?.from === 'bar',
          toggle: () => {
            setNewDocument((was) => (was?.from === 'bar' ? null : { from: 'bar' }))
          },
          close: () => {
            setNewDocument(null)
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
              {assetRowsFor(tree.tree.children).map((row) => (
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

            {tree.tree.children.length === 0 && (
              <p className="assets__message">This project folder is empty.</p>
            )}
          </div>
        )}

        {browsing.view === 'split' && <SplitHandle body={body} />}

        {showsGrid(browsing.view) && (
          <div className="assets__pane assets__pane--grid" data-testid="assets-icons">
            <AssetGrid tree={tree} />
          </div>
        )}
      </div>

      {newDocument?.from === 'browser' && (
        <div
          className="assets__menu assets__menu--new assets__menu--at"
          role="menu"
          data-testid="assets-new-menu"
          style={newDocument.at}
          ref={dismissBrowserMenu.box}
          onKeyDown={dismissBrowserMenu.onKeyDown}
        >
          <NewDocument folder={folder} onCreated={created} />
        </div>
      )}

      <div className="assets__tools">
        {selection.selectedFilePath === null ? (
          // The footer's room is spoken for either way (see above), so the empty
          // case is where the gesture that is now behind a right-click gets
          // taught. There is nowhere else on screen that could say it.
          <p className="assets__hint" data-testid="assets-hint">
            Right-click the empty space above — or press <strong>+</strong> in the bar — to make a
            level or prefab. Select a file to rename, move or delete it.
          </p>
        ) : (
          // Keyed on the path, so selecting a different file starts the row over
          // rather than leaving somebody else's typed name, refusal or half-pressed
          // Delete sitting under it (`editor-ui` UG5, answered by remounting rather
          // than by comparing).
          <MoveOrDelete
            key={selection.selectedFilePath}
            path={selection.selectedFilePath}
            tree={tree}
            onMoved={reveal}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The make-a-file menu: which door opened it, and where it sits.
 *
 * The bar's door has no point — the menu hangs under the button by CSS, the way
 * the cog's does — and the browser's is placed where the press landed. Two cases
 * rather than an optional point, so neither door can be read as the other.
 */
type NewDocumentAnchor = { from: 'bar' } | { from: 'browser'; at: Spot }

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
