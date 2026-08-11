import { useEffect, useState } from 'react'

import { FileEventMessageSchema } from '../../sidecar/event-schema'
import { ProjectTreeSchema, type ProjectTree } from '../../sidecar/tree-schema'

/**
 * The project folder as the editor sees it, kept current.
 *
 * On any change the whole folder is read again rather than the local copy being
 * patched. That is deliberate: patching would mean a second piece of code that
 * decides what the folder contains, and the two would eventually disagree in a
 * way nothing reports. Re-reading is one reader, always, and a scan of a game
 * project is cheap next to the second the human is willing to wait.
 */

export type ProjectTreeState =
  | { state: 'loading' }
  /** `live` is false when the change feed has dropped: the tree may be out of date. */
  | { state: 'ready'; tree: ProjectTree; live: boolean }
  | { state: 'unavailable'; reason: string }

/**
 * How long to wait for changes to stop arriving before re-reading. Copying a
 * folder in produces a burst of events, and one read at the end of the burst
 * beats one read per file.
 */
const SETTLE_MS = 75

export function useProjectTree(): ProjectTreeState {
  const [state, setState] = useState<ProjectTreeState>({ state: 'loading' })

  useEffect(() => {
    let stopped = false
    let settle: ReturnType<typeof setTimeout> | undefined
    let live = false

    const markLive = (next: boolean): void => {
      live = next
      if (stopped) return
      setState((previous) => (previous.state === 'ready' ? { ...previous, live: next } : previous))
    }

    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch('/api/tree', { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const tree = ProjectTreeSchema.parse(await response.json())
        if (!stopped) setState({ state: 'ready', tree, live })
      } catch {
        if (stopped) return
        // A folder already on screen is more useful than an error page, as long
        // as it is labelled as possibly out of date.
        setState((previous) =>
          previous.state === 'ready'
            ? { ...previous, live: false }
            : { state: 'unavailable', reason: 'Could not read the project folder.' },
        )
      }
    }

    const refreshSoon = (): void => {
      if (settle !== undefined) clearTimeout(settle)
      settle = setTimeout(() => void refresh(), SETTLE_MS)
    }

    void refresh()

    const changes = new EventSource('/api/events')

    changes.onopen = (): void => {
      markLive(true)
      // Anything that happened while the feed was down is invisible, so the
      // folder is read again on every reconnect rather than trusted.
      void refresh()
    }

    changes.onmessage = (message: MessageEvent): void => {
      let payload: unknown
      try {
        payload = JSON.parse(String(message.data))
      } catch {
        return
      }
      // Validated rather than trusted, so a newer sidecar sending a shape this
      // editor does not know is ignored instead of half-read.
      if (FileEventMessageSchema.safeParse(payload).success) refreshSoon()
    }

    changes.onerror = (): void => {
      markLive(false)
    }

    return () => {
      stopped = true
      if (settle !== undefined) clearTimeout(settle)
      changes.close()
    }
  }, [])

  return state
}
