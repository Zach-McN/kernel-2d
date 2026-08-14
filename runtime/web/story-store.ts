/**
 * Where a game's story sleeps: the browser's local storage, behind the same
 * two verbs the runner asks for (`run-level.ts`'s `story` option).
 *
 * One small JSON object per key. The key carries the project's name, because
 * the editor serves every project from the same origin and two games'
 * memories must not share a bed; an exported folder is its own origin (or at
 * least its own key) and loses nothing by the same discipline.
 *
 * **Storage that refuses is a memory that forgets, never a crash.** Local
 * storage throws on `file://` pages, in some private windows, and when full;
 * a game whose memory cannot be kept should still run, exactly as a level
 * with no road still draws. So every touch is wrapped, and a store that
 * cannot keep falls back to remembering for the life of the page — the same
 * facts, one visit long.
 */

export interface StoryStore {
  recall: () => Record<string, unknown>
  remember: (facts: Record<string, unknown>) => void
}

export function storyStore(project: string): StoryStore {
  const key = `kernel2d:story:${project}`
  /** The page-lifetime fallback, which is also the cache the recall reads through. */
  let held: Record<string, unknown> | null = null

  return {
    recall: () => {
      if (held !== null) return { ...held }
      try {
        const kept = window.localStorage.getItem(key)
        const parsed: unknown = kept === null ? {} : JSON.parse(kept)
        held = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
      } catch {
        held = {}
      }
      return { ...held }
    },

    remember: (facts) => {
      held = { ...facts }
      try {
        window.localStorage.setItem(key, JSON.stringify(facts))
      } catch {
        // Kept for the page's life instead. Forgetting quietly beats throwing
        // from inside a frame.
      }
    },
  }
}
