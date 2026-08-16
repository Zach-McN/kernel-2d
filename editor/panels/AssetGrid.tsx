import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'

import { assetTypeForName } from '../../runtime/formats/meta-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { findNode } from '../shell/asset-kinds'
import { useAssetBrowsing } from '../shell/asset-browsing'
import { assetRowsFor, type AssetRow } from '../shell/asset-rows'
import { useSelection } from '../shell/selection'
import { THUMBNAIL_BOX, thumbnailKeyFor, thumbnailStepFor } from '../shell/thumbnail'
import { ThumbnailPicture, useThumbnail, useThumbnails } from '../shell/thumbnails'
import { NOT_DRAGGABLE, useAssetDrag, type AssetDragProps } from '../shell/useAssetDrag'

/**
 * One folder at a time, as tiles — the file-explorer way of looking at a project.
 *
 * It shows exactly the rows the tree shows for the same folder, because both ask
 * `asset-rows.ts` (`editor-kernel` D4): a `.meta` is folded into the tile of the
 * file it annotates, and a stranded one gets a tile of its own, marked. Two
 * rules for what a folder contains would disagree the first time either changed,
 * and the symptom would be a file that exists in one view and not the other.
 *
 * **A single press selects and a double press enters.** That is the file
 * explorer's own split and there is no room to improve on it: selecting is what
 * the Inspector answers about, and it has to be possible to select a folder
 * without walking into it. Entering also opens the way down to the folder in the
 * tree, so the two halves of the split view never disagree about where you are.
 *
 * **A picture file's tile shows the picture**, which is the whole point of this
 * view existing — a folder of sprites you can pick from without reading a single
 * name. Everything else keeps its glyph: a sound has no picture, and a level's
 * would be a different feature with different questions in it.
 *
 * Three things about how that is arranged, each of which is a decision rather
 * than a detail:
 *
 * 1. **Nothing is read because a folder was opened — only because a tile came
 *    into view.** One observer for the whole grid (not one per tile) watches the
 *    picture boxes, and a box coming near the view is what asks. So a folder of
 *    two hundred sprites costs the thirty that are on screen, and the rest arrive
 *    under the scrolling hand. The margin is a row's worth, so a tile is usually
 *    ready by the time it is looked at.
 * 2. **A tile's picture box is one fixed size, whatever is in it.** The grid
 *    cannot reflow as pictures arrive, which matters here more than it looks:
 *    the gesture on this view is a *double*-click, and anything that resizes
 *    between the two presses means the second one lands on a tile that has slid
 *    into the spot — no error, no `dblclick` event, the folder simply does not
 *    open (`editor-ui` UG13).
 * 3. **A tile that has no picture yet shows the same blank page it always
 *    showed.** No spinner and no shimmer: thirty spinners appearing and
 *    vanishing down a scroll is exactly the flicker worth avoiding, and a
 *    picture, once read, is kept for the life of the window — so the only
 *    transition a tile ever makes is glyph to picture, once. A file that turns
 *    out not to be readable art keeps the glyph for good and says why on its
 *    tooltip; the refusal is remembered like a picture, so scrolling past it
 *    again asks nothing.
 *
 * What is kept, and why none of it is written into the human's project folder,
 * is in `thumbnails.tsx`.
 */
export function AssetGrid({ tree }: { tree: ProjectTree }): ReactElement {
  const selection = useSelection()
  const { folder, openFolder, expandFolder } = useAssetBrowsing()
  const dragProps = useAssetDrag()
  const thumbnails = useThumbnails()
  // As state rather than a ref: the list does not exist on the first render of
  // an empty or missing folder, and an effect that read a ref once would watch
  // nothing at all (`editor-ui` UG15).
  const [list, setList] = useState<HTMLUListElement | null>(null)

  // The top of the project is `''` here and `.` in the tree, so the root is
  // reached by name rather than looked up — see `asset-browsing.tsx`.
  const node = folder === '' ? tree.tree : findNode(tree, folder)
  const rows = node !== null && node.kind === 'directory' ? assetRowsFor(node.children) : []

  /**
   * Which tiles could have a picture, and what identifies each one.
   *
   * The extension is the cheap gate — it keeps this from asking the service
   * about every `.wav` in the folder — and it is deliberately not the last word:
   * what a file *is* is settled by its `.meta` when the picture is actually read
   * (`editor-ui` U11), which is where a `.png` that says it is not a texture is
   * turned down.
   */
  const keys = new Map<string, string>()
  for (const row of rows) {
    if (row.node.kind !== 'file') continue
    if (assetTypeForName(row.node.name) !== 'texture') continue
    const key = thumbnailKeyFor(row)
    if (key !== null) keys.set(row.node.path, key)
  }

  // What the observer has to be rebuilt for: a different set of pictures to
  // watch, which covers arriving, leaving, being renamed, and being re-saved.
  const watching = [...keys.values()].join('\n')

  useEffect(() => {
    if (list === null) return

    const seen = new IntersectionObserver(
      (boxes) => {
        for (const box of boxes) {
          if (!box.isIntersecting) continue
          const { thumbKey, thumbPath, thumbVersion } = (box.target as HTMLElement).dataset
          if (thumbKey === undefined || thumbPath === undefined) continue
          thumbnails.request(thumbKey, thumbPath, Number(thumbVersion ?? '0'))
        }
      },
      {
        // The pane is what scrolls, so it is what "on screen" is measured
        // against — the window's own viewport would call a tile visible while
        // it sits below the bottom of the panel.
        root: list.parentElement,
        rootMargin: `${THUMBNAIL_BOX * 2}px`,
      },
    )

    for (const box of list.querySelectorAll('[data-thumb-key]')) seen.observe(box)
    return () => {
      seen.disconnect()
    }
  }, [list, watching, thumbnails])

  // The folder went away underneath the human: renamed outside the editor,
  // deleted, or on a project that has just been swapped. Saying so and offering
  // the way back beats an empty grid that looks like an empty folder.
  if (node === null || node.kind !== 'directory') {
    return (
      <div className="assets__gone" data-testid="assets-grid-gone">
        <p className="assets__message">{folder} is not a folder in this project any more.</p>
        <button
          type="button"
          className="control control--action"
          onClick={() => {
            openFolder('')
          }}
        >
          Go to the top of the project
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="assets__message" data-testid="assets-grid-empty">
        This folder is empty.
      </p>
    )
  }

  return (
    <ul
      className="asset-grid"
      data-testid="assets-grid"
      aria-label="What is in this folder"
      ref={setList}
      // The stylesheet draws the picture box at whatever size the arithmetic
      // scales pictures against, rather than at a number of its own that would
      // drift from it.
      style={{ '--asset-tile-box': `${THUMBNAIL_BOX}px` } as CSSProperties}
    >
      {rows.map((row) => (
        <AssetTile
          key={row.node.path}
          row={row}
          thumbKey={keys.get(row.node.path) ?? null}
          selected={selection.selectedFilePath === row.node.path}
          onSelect={selection.selectFile}
          onEnter={(path) => {
            openFolder(path)
            expandFolder(path)
          }}
          // A folder is not something that can land in a level, so it is not
          // something that can be picked up (`useAssetDrag.ts`).
          drag={row.node.kind === 'file' ? dragProps(row.node.path) : NOT_DRAGGABLE}
        />
      ))}
    </ul>
  )
}

interface AssetTileProps {
  row: AssetRow
  /** What identifies this tile's picture, or null when it cannot have one. */
  thumbKey: string | null
  selected: boolean
  onSelect: (path: string) => void
  onEnter: (path: string) => void
  /** What makes this tile draggable — or the folder's refusal to be. */
  drag: AssetDragProps
}

function AssetTile({ row, thumbKey, selected, onSelect, onEnter, drag }: AssetTileProps): ReactElement {
  const { node } = row
  const isFolder = node.kind === 'directory'
  const thumbnail = useThumbnail(thumbKey)

  return (
    <li className="asset-tile">
      <button
        type="button"
        className="asset-tile__button"
        {...drag}
        data-asset-path={node.path}
        data-kind={node.kind}
        data-selected={selected}
        data-has-settings={row.hasSettings}
        data-orphaned-settings={row.isOrphanedSettings}
        // Which of the four states this tile's picture is in, and — when there
        // is one — the frame that was cut and the image it came from. That pair
        // is how "the sixteen-frame strip shows one frame" is asserted without
        // comparing pixels: 16×16 out of 96×16.
        data-thumbnail={thumbKey === null ? 'none' : thumbnail.state}
        data-thumb-frame={
          thumbnail.state === 'drawn' ? `${thumbnail.frame.width}x${thumbnail.frame.height}` : undefined
        }
        data-thumb-source={
          thumbnail.state === 'drawn' ? `${thumbnail.source.width}x${thumbnail.source.height}` : undefined
        }
        // The name is the one thing a tile cannot always show in full, so it is
        // always available in full — and it is where a picture that could not be
        // read says so, quietly, rather than by wearing a broken-image badge.
        title={thumbnail.state === 'refused' ? `${node.name} — ${thumbnail.problem}` : node.name}
        onClick={() => {
          onSelect(node.path)
        }}
        onDoubleClick={() => {
          if (isFolder) onEnter(node.path)
        }}
      >
        <span
          className="asset-tile__icon"
          aria-hidden="true"
          // What the observer above reads off the box when it comes into view.
          // On the element rather than in a closure, so the grid keeps exactly
          // one observer however many tiles there are.
          data-thumb-key={thumbKey ?? undefined}
          data-thumb-path={thumbKey === null ? undefined : node.path}
          data-thumb-version={
            thumbKey === null || node.kind !== 'file' ? undefined : String(node.mtimeMs)
          }
        >
          {isFolder ? (
            <FolderIcon />
          ) : thumbnail.state === 'drawn' ? (
            <ThumbnailPicture
              picture={thumbnail.picture}
              step={thumbnailStepFor(thumbnail.picture.width, thumbnail.picture.height, THUMBNAIL_BOX)}
            />
          ) : (
            <FileIcon />
          )}
        </span>
        <span className="asset-tile__name">{node.name}</span>
        {row.hasSettings && (
          <span className="asset-row__badge" title="Has import settings beside it">
            meta
          </span>
        )}
        {row.isOrphanedSettings && (
          <span
            className="asset-row__badge asset-row__badge--orphan"
            title="Import settings with no file beside them"
          >
            orphaned
          </span>
        )}
      </button>
    </li>
  )
}

function FolderIcon(): ReactElement {
  return (
    <svg viewBox="0 0 40 32" width="40" height="32" focusable="false">
      <path
        fill="currentColor"
        d="M2 5a3 3 0 0 1 3-3h9.2c.8 0 1.6.3 2.1.9L18.6 5H35a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"
        opacity="0.35"
      />
      <path
        fill="currentColor"
        d="M2 11h36v16a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"
        opacity="0.75"
      />
    </svg>
  )
}

function FileIcon(): ReactElement {
  return (
    <svg viewBox="0 0 40 32" width="40" height="32" focusable="false">
      <path
        fill="currentColor"
        d="M11 1h13.5L32 8.5V31H11Z"
        opacity="0.28"
      />
      <path fill="currentColor" d="M24.5 1 32 8.5h-7.5Z" opacity="0.6" />
      <g fill="currentColor" opacity="0.55">
        <rect x="15" y="14" width="13" height="1.6" rx="0.8" />
        <rect x="15" y="18" width="13" height="1.6" rx="0.8" />
        <rect x="15" y="22" width="9" height="1.6" rx="0.8" />
      </g>
    </svg>
  )
}
