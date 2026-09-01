import { Fragment, useRef, useState, type ReactElement } from 'react'

import { useAssetBrowsing, showsGrid, type AssetView } from '../shell/asset-browsing'
import { useMenuDismiss } from '../shell/useMenuDismiss'
import { NewDocument } from './NewDocument'

/**
 * The strip across the top of the Assets panel: where you are on the left, and
 * on the right the `+` that makes a file and the cog that decides how you are
 * looking at the folder.
 *
 * **The breadcrumb is only on screen when the grid is**, and that is the point
 * rather than an economy. A tree has no "current folder" — it can have six of
 * them open at once — so a breadcrumb over a tree would be a sentence about
 * somewhere the human is not, which is worse than no sentence at all
 * (`editor-ui` U10). The bar itself stays, because the cog is how you get back.
 *
 * **The `+` is the second door on the make-a-file menu**, the first being a
 * right-click on the empty part of the browser. It is a button on the bar and
 * the cog is not made into one, because the two are different kinds of thing:
 * the cog is a setting, chosen once and lived with, and the `+` is an action,
 * reached for whenever there is a level to start. Neither belongs in the
 * other's menu.
 *
 * **The search box sits between where-you-are and the buttons**, and it is on
 * the bar in every view because a search is not a view: it is a question about
 * the whole project, asked from wherever you happen to be standing, and it
 * replaces the folder underneath with its answer for as long as it says
 * anything (`../shell/asset-browsing.tsx`). It gives way sideways before the
 * breadcrumb does — the crumb is read on every click, the box only while it is
 * being typed in — and `Esc` clears it, or hands the keys back if it is already
 * clear.
 *
 * The bar is a fixed height whatever is in it (`editor-ui` UG8): the two views
 * put different things in the left half, and a strip that grew a row when the
 * breadcrumb appeared would shorten the folder underneath it at the moment the
 * human changed view.
 */
export function AssetBar({
  projectName,
  newDocument,
}: {
  projectName: string
  newDocument: NewDocumentDoor
}): ReactElement {
  const { view, setView, folder, openFolder, search, setSearch } = useAssetBrowsing()

  return (
    <div className="assets__bar" data-testid="assets-bar">
      {showsGrid(view) ? (
        <Breadcrumb projectName={projectName} folder={folder} onOpen={openFolder} />
      ) : (
        <span className="assets__bar-filler" />
      )}
      <SearchBox value={search} onChange={setSearch} />
      <NewDocumentButton door={newDocument} />
      <ViewSettings view={view} onPick={setView} />
    </div>
  )
}

/**
 * The bar's half of the make-a-file menu.
 *
 * The panel owns whether it is open and where, because the other door — a
 * right-click in the browser — opens the same menu and only one of them may be
 * on screen at a time (`editor-ui` U44). This is a button and a place to hang
 * the card, and nothing else.
 */
export interface NewDocumentDoor {
  /** True while the menu is open *under this button*. */
  open: boolean
  toggle: () => void
  close: () => void
  /** Where a file made from here would go, and what to do once it exists. */
  folder: string
  onCreated: (path: string) => void
}

function NewDocumentButton({ door }: { door: NewDocumentDoor }): ReactElement {
  const plus = useRef<HTMLButtonElement | null>(null)
  const dismiss = useMenuDismiss(door.open, (how) => {
    door.close()
    if (how === 'escape') plus.current?.focus()
  })

  return (
    <div className="assets__settings" ref={dismiss.box} onKeyDown={dismiss.onKeyDown}>
      <button
        type="button"
        className="assets__cog"
        ref={plus}
        data-testid="assets-new-document"
        aria-label="Make a level or prefab"
        aria-haspopup="menu"
        aria-expanded={door.open}
        title="Make a level or prefab — or right-click the empty part of the browser"
        onClick={door.toggle}
      >
        <PlusIcon />
      </button>

      {door.open && (
        <div className="assets__menu assets__menu--new" role="menu" data-testid="assets-new-menu">
          <NewDocument folder={door.folder} onCreated={door.onCreated} />
        </div>
      )}
    </div>
  )
}

/**
 * The search box: type, and the folder view underneath becomes the list of
 * everything in the project called that.
 *
 * A native search field, so Chromium draws the little clear cross itself and
 * `Esc` empties it — and the handler does the same on `Esc` for every browser
 * that does not, then blurs on a second press so the panel's keys work again.
 * The press is stopped there: an `Esc` meant for this box must not go on to
 * close a menu or drop a selection somewhere else.
 */
function SearchBox({ value, onChange }: { value: string; onChange: (query: string) => void }): ReactElement {
  return (
    <input
      type="search"
      className="control control--text assets__search"
      data-testid="assets-search"
      aria-label="Search the project for a file by name"
      title="Find a file anywhere in the project by its name. Esc clears."
      placeholder="Search"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (value !== '') onChange('')
        else event.currentTarget.blur()
      }}
    />
  )
}

/**
 * Which folder the grid is inside, spelled out from the project down, with every
 * step on the way back up a button.
 *
 * The first crumb is the project's own name rather than the word "project",
 * because two projects with the same shape of folder is ordinary and the name is
 * the only thing that tells them apart (`editor-ui` U3, one panel down).
 */
function Breadcrumb({
  projectName,
  folder,
  onOpen,
}: {
  projectName: string
  folder: string
  onOpen: (path: string) => void
}): ReactElement {
  const parts = folder === '' ? [] : folder.split('/')
  const crumbs = [
    { name: projectName, path: '' },
    ...parts.map((part, index) => ({ name: part, path: parts.slice(0, index + 1).join('/') })),
  ]

  return (
    <nav className="breadcrumb" data-testid="assets-breadcrumb" aria-label="The folder you are in">
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1
        return (
          <Fragment key={crumb.path}>
            {index > 0 && (
              <span className="breadcrumb__step" aria-hidden="true">
                ›
              </span>
            )}
            <button
              type="button"
              className="breadcrumb__crumb"
              data-crumb-path={crumb.path}
              data-current={current}
              aria-current={current ? 'true' : undefined}
              title={crumb.path === '' ? projectName : crumb.path}
              onClick={() => {
                onOpen(crumb.path)
              }}
            >
              {crumb.name}
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}

const VIEWS: readonly { id: AssetView; label: string; blurb: string }[] = [
  { id: 'icons', label: 'Icon view', blurb: 'One folder at a time, as tiles.' },
  { id: 'list', label: 'Folder view', blurb: 'The whole project as a tree.' },
  { id: 'split', label: 'Split view', blurb: 'The tree, with that folder beside it.' },
]

/**
 * The cog, and the three ways of looking at a folder behind it.
 *
 * A menu rather than three buttons on the strip: the choice is made once and
 * then lived with for an afternoon, so it does not deserve permanent room next
 * to the breadcrumb, which is read on every click.
 *
 * It closes on Escape and on a press anywhere else — the shared behaviour every
 * menu in the editor keeps (`../shell/useMenuDismiss.ts`), which this one was
 * the first to spell out.
 */
function ViewSettings({ view, onPick }: { view: AssetView; onPick: (view: AssetView) => void }): ReactElement {
  const [open, setOpen] = useState(false)
  const cog = useRef<HTMLButtonElement | null>(null)
  const dismiss = useMenuDismiss(open, (how) => {
    setOpen(false)
    if (how === 'escape') cog.current?.focus()
  })

  return (
    <div className="assets__settings" ref={dismiss.box} onKeyDown={dismiss.onKeyDown}>
      <button
        type="button"
        className="assets__cog"
        ref={cog}
        data-testid="assets-settings"
        aria-label="How to show this folder"
        aria-haspopup="menu"
        aria-expanded={open}
        title="How to show this folder"
        onClick={() => {
          setOpen((was) => !was)
        }}
      >
        <CogIcon />
      </button>

      {open && (
        <div className="assets__menu" role="menu" data-testid="assets-settings-menu">
          {VIEWS.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="assets__menu-item"
              role="menuitemradio"
              aria-checked={choice.id === view}
              data-testid={`assets-view-${choice.id}`}
              onClick={() => {
                onPick(choice.id)
                setOpen(false)
              }}
            >
              <span className="assets__menu-tick" aria-hidden="true">
                {choice.id === view ? '✓' : ''}
              </span>
              <span className="assets__menu-words">
                <span className="assets__menu-label">{choice.label}</span>
                <span className="assets__menu-blurb">{choice.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A plus, drawn rather than typed, so it sits on the bar the way the cog does. */
function PlusIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M7.3 2.6h1.4v4.7h4.7v1.4H8.7v4.7H7.3V8.7H2.6V7.3h4.7Z"
      />
    </svg>
  )
}

function CogIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 5.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2Zm0 1.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z"
      />
      <path
        fill="currentColor"
        d="m6.9 1 -.2 1.6a5.4 5.4 0 0 0-1.2.7L4 2.7 2.7 4l.6 1.5a5.4 5.4 0 0 0-.7 1.2L1 6.9v2.2l1.6.2c.2.4.4.8.7 1.2L2.7 12 4 13.3l1.5-.6c.4.3.8.5 1.2.7l.2 1.6h2.2l.2-1.6c.4-.2.8-.4 1.2-.7l1.5.6L13.3 12l-.6-1.5c.3-.4.5-.8.7-1.2l1.6-.2V6.9l-1.6-.2a5.4 5.4 0 0 0-.7-1.2l.6-1.5L12 2.7l-1.5.6a5.4 5.4 0 0 0-1.2-.7L9.1 1Z"
        opacity="0.55"
      />
    </svg>
  )
}
