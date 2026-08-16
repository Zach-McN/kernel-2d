import { z } from 'zod'

import type { AssetView } from './asset-browsing'

/**
 * Where the window remembers how it was arranged: the docking layout, and the
 * Assets panel's view and folder — per project, in this browser.
 *
 * **In the browser and not in the project folder, on purpose.** How the panels
 * are arranged is a fact about this editor window, not about the game: a
 * `.json` in the project would appear in the Assets panel as one of the
 * human's files, would need the AI-content marking every generated file needs,
 * and would follow the game into version control where two people's window
 * shapes would fight. It goes where a game's own remembered facts already go
 * (`runtime/web/story-store.ts`) — `localStorage`, one small object per key —
 * and clearing the browser's site data forgets it, exactly as it forgets those.
 *
 * **Keyed on the project's absolute path**, which is the one name the service
 * gives a project (`ProjectTree.projectPath`), so two projects opened in turn
 * each come back to their own arrangement. One more key points at the project
 * last opened, so a reload can put the layout back *before* the service has
 * answered which project it is looking at — without it the default appears for
 * a moment and then jumps, which reads as the feature not working. If the
 * service then names a different project, that one's record is loaded instead.
 *
 * The docking library's own JSON is carried opaquely inside a small versioned
 * envelope of ours (`text-formats` T1: every document says what it is), and
 * anything that does not parse — an old version, hand-damaged storage, a
 * layout the library can no longer load — is discarded for the default. **Never
 * an error**: a saved arrangement is a convenience, and refusing to open the
 * editor over one would be the wrong size of consequence.
 */

export const LAYOUT_FORMAT = 'kernel2d.layout'
export const LAYOUT_VERSION = 1

export interface SavedLayout {
  format: typeof LAYOUT_FORMAT
  version: typeof LAYOUT_VERSION
  /** Dockview's own serialized layout, kept as it gave it. Absent until the dock has saved once. */
  dock?: unknown
  assets?: { view: AssetView; folder: string } | undefined
}

const SavedLayoutSchema: z.ZodType<SavedLayout> = z.looseObject({
  format: z.literal(LAYOUT_FORMAT),
  version: z.literal(LAYOUT_VERSION),
  dock: z.unknown().optional(),
  assets: z
    .looseObject({
      view: z.enum(['list', 'icons', 'split']),
      folder: z.string(),
    })
    .optional(),
})

const PREFIX = 'kernel2d:layout:'
const LAST_PROJECT_KEY = `${PREFIX}last-project`

/** The storage, or null in a browser that has none or refuses it. */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** What this project's window remembered, or null when nothing usable is there. */
export function readLayout(projectPath: string): SavedLayout | null {
  const store = storage()
  if (store === null) return null
  try {
    const kept = store.getItem(PREFIX + projectPath)
    if (kept === null) return null
    const parsed = SavedLayoutSchema.safeParse(JSON.parse(kept))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Remembers part of this project's arrangement, keeping whatever else was
 * already remembered — the dock and the Assets panel each save their own half
 * without knowing about the other's.
 */
export function writeLayout(projectPath: string, patch: Partial<Pick<SavedLayout, 'dock' | 'assets'>>): void {
  const store = storage()
  if (store === null) return
  try {
    const current = readLayout(projectPath) ?? { format: LAYOUT_FORMAT, version: LAYOUT_VERSION }
    const next: SavedLayout = { ...current, ...patch }
    store.setItem(PREFIX + projectPath, JSON.stringify(next))
    store.setItem(LAST_PROJECT_KEY, projectPath)
  } catch {
    // Storage full or refused: the arrangement is simply not remembered.
  }
}

/** Forgets this project's arrangement — Reset layout. */
export function forgetLayout(projectPath: string): void {
  const store = storage()
  if (store === null) return
  try {
    store.removeItem(PREFIX + projectPath)
  } catch {
    // Nothing to do.
  }
}

/** The project this browser last saved a layout for, or null. */
export function lastProject(): string | null {
  const store = storage()
  if (store === null) return null
  try {
    return store.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

/** Remembers which project is open, so the next reload can start from its layout. */
export function rememberProject(projectPath: string): void {
  const store = storage()
  if (store === null) return
  try {
    store.setItem(LAST_PROJECT_KEY, projectPath)
  } catch {
    // Nothing to do.
  }
}
