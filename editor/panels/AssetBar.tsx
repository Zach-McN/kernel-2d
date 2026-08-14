import { Fragment, useEffect, useRef, useState, type ReactElement } from 'react'

import { useAssetBrowsing, showsGrid, type AssetView } from '../shell/asset-browsing'

/**
 * The strip across the top of the Assets panel: where you are on the left, and
 * the cog that decides how you are looking at it on the right.
 *
 * **The breadcrumb is only on screen when the grid is**, and that is the point
 * rather than an economy. A tree has no "current folder" — it can have six of
 * them open at once — so a breadcrumb over a tree would be a sentence about
 * somewhere the human is not, which is worse than no sentence at all
 * (`editor-ui` U10). The bar itself stays, because the cog is how you get back.
 *
 * The bar is a fixed height whatever is in it (`editor-ui` UG8): the two views
 * put different things in the left half, and a strip that grew a row when the
 * breadcrumb appeared would shorten the folder underneath it at the moment the
 * human changed view.
 */
export function AssetBar({ projectName }: { projectName: string }): ReactElement {
  const { view, setView, folder, openFolder } = useAssetBrowsing()

  return (
    <div className="assets__bar" data-testid="assets-bar">
      {showsGrid(view) ? (
        <Breadcrumb projectName={projectName} folder={folder} onOpen={openFolder} />
      ) : (
        <span className="assets__bar-filler" />
      )}
      <ViewSettings view={view} onPick={setView} />
    </div>
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
 * It closes on Escape and on a press anywhere else. The Escape is handled on the
 * menu's own subtree rather than on the window, and the press is stopped from
 * travelling any further, because the viewport already owns Escape for calling
 * off a grab (`editor-ui` U33) — one key, and whichever thing is open should be
 * the one that hears it.
 */
function ViewSettings({ view, onPick }: { view: AssetView; onPick: (view: AssetView) => void }): ReactElement {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const cog = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPressElsewhere = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && box.current?.contains(target) === true) return
      setOpen(false)
    }

    window.addEventListener('pointerdown', onPressElsewhere)
    return () => {
      window.removeEventListener('pointerdown', onPressElsewhere)
    }
  }, [open])

  return (
    <div
      className="assets__settings"
      ref={box}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.stopPropagation()
        setOpen(false)
        cog.current?.focus()
      }}
    >
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
