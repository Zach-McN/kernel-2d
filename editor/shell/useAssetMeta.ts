import { useEffect, useState } from 'react'

import { MetaViewSchema, type MetaView } from '../../sidecar/meta-view-schema'
import { adoptFromDisk, beginRead } from '../store/open-documents'

/**
 * What one file's `.meta` holds, for whichever file is selected.
 *
 * Re-asked whenever the folder changes as well as whenever the selection does,
 * so editing a `.meta` in a text editor shows up here without a reload. The
 * answer is validated rather than trusted, on the same grounds as the change
 * feed: a newer sidecar sending a shape this editor does not know should be
 * ignored, not half-read.
 *
 * Settings that parsed are handed to the document store, which is what decides
 * whether to take them: disk wins over what the editor is holding, except while
 * the editor has a change of its own that the folder has not seen yet. That
 * rule, and why the resulting write/re-read cycle stops rather than going round
 * for ever, lives in `editor/store/documents.ts` beside the handler.
 */

export type AssetMetaState =
  /** Nothing is selected, so there is nothing to ask about. */
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; view: MetaView }
  /** The question could not be asked or the answer made no sense. */
  | { state: 'unavailable' }

/** An answer, and the file it is an answer about. The pair is the whole point. */
interface Answer {
  forPath: string | null
  state: AssetMetaState
}

export function useAssetMeta(path: string | null, refreshKey?: unknown): AssetMetaState {
  const [answer, setAnswer] = useState<Answer>({ forPath: null, state: { state: 'idle' } })

  useEffect(() => {
    if (path === null) {
      setAnswer({ forPath: null, state: { state: 'idle' } })
      return
    }

    let stopped = false
    const setState = (state: AssetMetaState): void => setAnswer({ forPath: path, state })

    // Re-asking about the same file keeps what is on screen, so a folder change
    // elsewhere does not blink the panel.
    setAnswer((previous) =>
      previous.forPath === path && previous.state.state === 'ready'
        ? previous
        : { forPath: path, state: { state: 'loading' } },
    )

    const ask = async (): Promise<void> => {
      // Taken before the question is asked, not after the answer arrives: an
      // answer that arrives late is indistinguishable from a fresh one, and the
      // store needs to know which of the two it is looking at.
      const readStartedAt = beginRead()
      try {
        const response = await fetch(`/api/meta?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const view = MetaViewSchema.parse(await response.json())
        // Offered to the store even if this hook has since been torn down: the
        // folder said something true about a file, and which panel happened to
        // ask has nothing to do with whether it is worth knowing.
        if (view.status === 'ok' && view.meta !== null) adoptFromDisk(view.path, view.meta, readStartedAt)
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

  /*
   * The state is cleared by an effect, and effects run *after* the render that
   * changed the selection — so for exactly one render this hook would otherwise
   * answer with the file that was selected a moment ago. One render is long
   * enough to matter: it is a render in which the panel shows one file's
   * settings under another file's name, and a control clicked in it belongs to
   * neither. Comparing here rather than trusting the effect is what makes that
   * render impossible instead of merely brief.
   */
  if (answer.forPath !== path) return { state: path === null ? 'idle' : 'loading' }
  return answer.state
}
