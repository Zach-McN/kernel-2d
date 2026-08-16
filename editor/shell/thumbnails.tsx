import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'

import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import type { Slice } from '../../runtime/formats/meta-schema'
import { THUMBNAIL_BOX, thumbnailPlan } from './thumbnail'

/**
 * Every picture the Assets panel has drawn on a tile, for the life of the
 * window.
 *
 * **Above the docking layout** for `editor-ui` U9's structural reason rather
 * than for the usual one: dockview throws a panel's body away the first time
 * its tab is dragged, so a cache owned by the Assets panel would be emptied by
 * moving it — every picture in the folder read again for a gesture that has
 * nothing to do with the art.
 *
 * Four decisions, in the order they matter:
 *
 * **Only what is on screen is read.** A folder of two hundred sprites costs a
 * screenful — the tiles ask as they come into view (`AssetGrid.tsx` owns the
 * watching) and nothing at all is read for a folder merely being opened. Two
 * hundred decodes on entering a folder would be seconds of work and hundreds of
 * megabytes of transient decoded image, for thirty tiles somebody can see.
 *
 * **Nothing is written to disk.** `.thumbs` is reserved and stays empty. A
 * cache in the human's own project folder is a generated binary they now have to
 * think about — it needs the `generatedBy` marking, it wants a `.gitignore`
 * line, and it makes the editor something that writes into the art folder
 * unasked. It also buys real problems: stamping each copy with what it was made
 * from, sweeping orphans when art is renamed, deciding what two windows on one
 * project do. What it buys back is only a warm start after a reload, and a
 * screenful of small files is read again in well under the second the human is
 * already waiting. If a project ever turns up where that is visibly slow, the
 * key in `thumbnail.ts` is already the right thing to stamp a disk copy with.
 *
 * **What is kept is small.** The full-size image exists for as long as it takes
 * to cut a frame out of it and stand that down to the box, and is closed
 * immediately; only the small copy is held. So the cost of an entry is the same
 * whether it came from a 16-pixel sprite or a 4096-pixel tileset.
 *
 * **A refusal is remembered exactly like a picture.** Bytes that will not fetch,
 * a `.png` that is really a text file, a `.meta` that says this is not a texture
 * at all: all of them land here under the same key, so the tile keeps its glyph,
 * never asks again as it scrolls past, and never flickers. Fixing the file moves
 * its timestamp, which changes the key, which is the retry.
 */

export type Thumbnail =
  /** Never asked about. The tile shows its glyph. */
  | { state: 'unknown' }
  /** Asked about. The tile still shows its glyph — see the note on flicker below. */
  | { state: 'reading' }
  | {
      state: 'drawn'
      picture: ImageBitmap
      /** The frame that was cut, in image pixels — 16×16 out of a 96×16 strip. */
      frame: { width: number; height: number }
      /** The whole image it was cut from, in image pixels. */
      source: { width: number; height: number }
    }
  /** There is no picture to be had. One plain sentence, shown on the tile's tooltip. */
  | { state: 'refused'; problem: string }

const UNKNOWN: Thumbnail = { state: 'unknown' }
const READING: Thumbnail = { state: 'reading' }

/**
 * How many pictures are read at once.
 *
 * Small on purpose. A fast scroll can ask about a hundred tiles in a second, and
 * a hundred simultaneous fetches would serve every one of them slowly rather
 * than the visible ones quickly. Newest first, for the same reason: what is
 * under the eye now beats what was under it two seconds ago.
 */
const AT_ONCE = 4

/**
 * How many pictures are kept before the least recently wanted are dropped.
 *
 * **Only an entry nothing is watching may be dropped** — that is, one whose tile
 * is not in the folder on screen. Dropping a visible one would blank its tile,
 * which would ask for it again, which is a loop and a flicker at once. So the
 * real bound is "this folder, plus a thousand recently visited", and at roughly
 * sixteen kilobytes an entry a folder would have to hold tens of thousands of
 * pictures before that is worth a second thought.
 */
const KEEP = 1000

interface ThumbnailStore {
  /** The current answer, without asking for one. Safe to call while rendering. */
  peek: (key: string) => Thumbnail
  /**
   * Ask for a picture. Idempotent: a key already read, refused, or in the queue
   * is left alone, so a tile may say this every time it scrolls into view.
   */
  request: (key: string, path: string, version: number) => void
  subscribe: (key: string, listener: () => void) => () => void
}

const ThumbnailContext = createContext<ThumbnailStore | null>(null)

export function ThumbnailProvider({ children }: { children: ReactNode }): ReactElement {
  const store = useRef<ThumbnailStore | null>(null)
  store.current ??= createThumbnailStore()

  return <ThumbnailContext.Provider value={store.current}>{children}</ThumbnailContext.Provider>
}

export function useThumbnails(): ThumbnailStore {
  const store = useContext(ThumbnailContext)
  if (store === null) throw new Error('useThumbnails was called outside the editor shell')
  return store
}

/**
 * One tile's picture, redrawn when — and only when — that one key's answer
 * changes.
 *
 * Subscribed per key rather than by re-rendering the panel on every arrival: a
 * folder of two hundred tiles filling in one at a time would otherwise be two
 * hundred renders of two hundred tiles.
 */
export function useThumbnail(key: string | null): Thumbnail {
  const store = useThumbnails()

  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => (key === null ? () => undefined : store.subscribe(key, listener)),
      [store, key],
    ),
    useCallback(() => (key === null ? UNKNOWN : store.peek(key)), [store, key]),
  )
}

function createThumbnailStore(): ThumbnailStore {
  /** Insertion order is "least recently wanted first", which is what eviction walks. */
  const entries = new Map<string, Thumbnail>()
  const listeners = new Map<string, Set<() => void>>()
  const queue: { key: string; path: string; version: number }[] = []
  let running = 0

  const publish = (key: string): void => {
    for (const listener of listeners.get(key) ?? []) listener()
  }

  const settle = (key: string, thumbnail: Thumbnail): void => {
    // Only if it is still wanted: an entry evicted while its picture was being
    // read must not come back, or eviction would not be a bound at all.
    if (!entries.has(key)) {
      if (thumbnail.state === 'drawn') thumbnail.picture.close()
      return
    }
    entries.set(key, thumbnail)
    publish(key)
  }

  const forgetOldest = (): void => {
    for (const [key, entry] of [...entries]) {
      if (entries.size <= KEEP) return
      // Watched means on screen. See the note on KEEP.
      if ((listeners.get(key)?.size ?? 0) > 0) continue
      if (entry.state === 'reading') continue
      entries.delete(key)
      if (entry.state === 'drawn') entry.picture.close()
    }
  }

  const pump = (): void => {
    while (running < AT_ONCE) {
      const job = queue.pop()
      if (job === undefined) return
      running += 1
      void read(job.path, job.version)
        .then((thumbnail) => settle(job.key, thumbnail))
        .catch((error: unknown) => settle(job.key, refusal(error)))
        .finally(() => {
          running -= 1
          pump()
        })
    }
  }

  return {
    peek: (key) => entries.get(key) ?? UNKNOWN,

    request: (key, path, version) => {
      const known = entries.get(key)
      if (known !== undefined) {
        // Re-inserted so the eviction order is "least recently wanted", and
        // wanting is exactly what a tile coming into view means.
        entries.delete(key)
        entries.set(key, known)
        return
      }

      entries.set(key, READING)
      forgetOldest()
      queue.push({ key, path, version })
      pump()
    },

    subscribe: (key, listener) => {
      const forKey = listeners.get(key) ?? new Set()
      forKey.add(listener)
      listeners.set(key, forKey)

      return () => {
        forKey.delete(listener)
        if (forKey.size === 0) listeners.delete(key)
      }
    },
  }
}

/** Whatever went wrong, said in one sentence a human can act on. */
function refusal(error: unknown): Thumbnail {
  const detail = error instanceof Error ? error.message : String(error)
  return { state: 'refused', problem: detail === '' ? 'It could not be read as a picture.' : detail }
}

/**
 * One picture, from the bytes on disk.
 *
 * Two round trips, and the first one is what makes a sheet show its first frame
 * rather than all sixteen at once. The settings are read but **not offered to
 * the document store** — that is the selected file's business
 * (`useAssetMeta.ts`), and adopting thirty documents nobody is editing because
 * thirty tiles happened to scroll past would fill the store with things no
 * inspector will ever open.
 */
async function read(path: string, version: number): Promise<Thumbnail> {
  const settings = await sliceFor(path)
  if (settings.kind === 'not-a-texture') {
    return { state: 'refused', problem: settings.problem }
  }

  const response = await fetch(assetUrl(path, version), { cache: 'no-store' })
  if (!response.ok) throw new Error(`Its bytes could not be read (${response.status}).`)

  const full = await createImageBitmap(await response.blob())
  try {
    const plan = thumbnailPlan(settings.slice, full.width, full.height, THUMBNAIL_BOX)
    if (plan === null) throw new Error('It is an image with no size.')

    // Cut and stood down in one step, from the bitmap rather than the bytes, so
    // nothing is decoded twice. `high` because the interesting case is a large
    // tileset coming down to 64 pixels, where nearest sampling would throw away
    // whichever pixels it happened to land between.
    const picture = await createImageBitmap(
      full,
      plan.crop.x,
      plan.crop.y,
      plan.crop.width,
      plan.crop.height,
      { resizeWidth: plan.width, resizeHeight: plan.height, resizeQuality: 'high' },
    )

    return {
      state: 'drawn',
      picture,
      frame: { width: plan.crop.width, height: plan.crop.height },
      source: { width: full.width, height: full.height },
    }
  } finally {
    // The whole image is the expensive thing here — tens of megabytes for a
    // large sheet — and it is of no further use the moment the small copy
    // exists. Released on the failing path too, which is why this is a `finally`
    // rather than a line at the end.
    full.close()
  }
}

type SliceAnswer =
  | { kind: 'texture'; slice: Slice | null }
  | { kind: 'not-a-texture'; problem: string }

/**
 * How this file is sliced, or the reason there is no picture to draw.
 *
 * **What the `.meta` says beats what the name suggests** (`editor-ui` U11): a
 * `.png` whose settings call it something other than a texture keeps its glyph,
 * the same way the Viewport refuses to draw it. A file with no `.meta` at all is
 * a texture by its name and is drawn whole, which is what a PNG dropped in a
 * second ago is until the sidecar has written one beside it.
 *
 * A `.meta` that cannot be fetched or parsed is treated as absent rather than as
 * a refusal. The art is on disk and readable; being unable to read the settings
 * is a reason to draw the whole picture, not a reason to draw nothing.
 */
async function sliceFor(path: string): Promise<SliceAnswer> {
  try {
    const response = await fetch(`/api/meta?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
    if (!response.ok) return { kind: 'texture', slice: null }

    const view = MetaViewSchema.parse(await response.json())
    if (view.status !== 'ok' || view.meta === null) return { kind: 'texture', slice: null }
    if (view.meta.importSettings.type !== 'texture') {
      return {
        kind: 'not-a-texture',
        problem: `Its import settings say it is ${view.meta.type}, not a texture.`,
      }
    }

    return { kind: 'texture', slice: view.meta.importSettings.slice }
  } catch {
    return { kind: 'texture', slice: null }
  }
}

/**
 * The same shape both renderers use, and the version is what keeps a re-exported
 * texture from being served out of the browser's own cache.
 */
function assetUrl(path: string, version: number): string {
  return `/api/asset?path=${encodeURIComponent(path)}&v=${encodeURIComponent(String(version))}`
}

/**
 * Draws a kept picture into a canvas, and redraws it when a different one
 * arrives for the same tile.
 *
 * A canvas rather than an `<img>` because what is held is an `ImageBitmap`:
 * turning it into an image would mean a blob URL per tile, and a blob URL that
 * has to be revoked exactly when the cache drops the picture it came from — a
 * second lifetime to keep in step with the first, for no gain.
 */
export function ThumbnailPicture({
  picture,
  step,
}: {
  picture: ImageBitmap
  /** How many screen pixels per image pixel. Whole numbers only, per U17. */
  step: number
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    element.width = picture.width
    element.height = picture.height
    element.getContext('2d')?.drawImage(picture, 0, 0)
  }, [picture])

  return (
    <canvas
      ref={canvas}
      className="asset-tile__picture"
      width={picture.width}
      height={picture.height}
      // The drawn size is stated rather than left to the box, because "as large
      // as fits" and "a whole number of screen pixels per image pixel" disagree
      // for most sprites, and this kernel is for pixel art.
      style={{ width: `${picture.width * step}px`, height: `${picture.height * step}px` }}
    />
  )
}
