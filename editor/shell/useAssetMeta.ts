import { useEffect, useState } from 'react'

import { MetaViewSchema, type MetaView } from '../../sidecar/meta-view-schema'

/**
 * What one file's `.meta` holds, for whichever file is selected.
 *
 * Re-asked whenever the folder changes as well as whenever the selection does,
 * so editing a `.meta` in a text editor shows up here without a reload. The
 * answer is validated rather than trusted, on the same grounds as the change
 * feed: a newer sidecar sending a shape this editor does not know should be
 * ignored, not half-read.
 */

export type AssetMetaState =
  /** Nothing is selected, so there is nothing to ask about. */
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; view: MetaView }
  /** The question could not be asked or the answer made no sense. */
  | { state: 'unavailable' }

export function useAssetMeta(path: string | null, refreshKey?: unknown): AssetMetaState {
  const [state, setState] = useState<AssetMetaState>({ state: 'idle' })

  useEffect(() => {
    if (path === null) {
      setState({ state: 'idle' })
      return
    }

    let stopped = false
    // Re-asking about the same file keeps what is on screen, so a folder change
    // elsewhere does not blink the panel. Asking about a different file clears
    // it, so the panel never shows one file's settings under another's name.
    setState((previous) =>
      previous.state === 'ready' && previous.view.path === path ? previous : { state: 'loading' },
    )

    const ask = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/meta?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const view = MetaViewSchema.parse(await response.json())
        if (!stopped) setState({ state: 'ready', view })
      } catch {
        if (!stopped) setState({ state: 'unavailable' })
      }
    }

    void ask()

    return () => {
      stopped = true
    }
  }, [path, refreshKey])

  return state
}
