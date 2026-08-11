import { useEffect, useState } from 'react'

import { SidecarStatusSchema, type SidecarStatus } from '../../sidecar/status-schema'

/**
 * Whether the sidecar is answering, and which folder it is holding open.
 *
 * The editor asks its own origin — Vite proxies `/api` through to the sidecar —
 * so the sidecar's port never appears in browser code. Asking repeatedly rather
 * than once means stopping or restarting the sidecar shows up in the window
 * instead of leaving a stale name on screen.
 */

export type SidecarConnection =
  | { state: 'connecting' }
  | { state: 'connected'; status: SidecarStatus }
  | { state: 'unavailable'; reason: string }

/** Slow while all is well, brisk while it is not — a restart should be noticed. */
const ASK_AGAIN_WHEN_CONNECTED_MS = 5000
const ASK_AGAIN_WHEN_NOT_MS = 2000

export function useSidecarStatus(): SidecarConnection {
  const [connection, setConnection] = useState<SidecarConnection>({ state: 'connecting' })

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = async (): Promise<void> => {
      const next = await askSidecar()
      if (stopped) return
      setConnection(next)
      timer = setTimeout(
        () => void check(),
        next.state === 'connected' ? ASK_AGAIN_WHEN_CONNECTED_MS : ASK_AGAIN_WHEN_NOT_MS,
      )
    }

    void check()

    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  return connection
}

async function askSidecar(): Promise<SidecarConnection> {
  let payload: unknown
  try {
    const response = await fetch('/api/', { cache: 'no-store' })
    if (!response.ok) {
      return { state: 'unavailable', reason: `The sidecar answered with ${response.status}.` }
    }
    payload = await response.json()
  } catch {
    return { state: 'unavailable', reason: 'No sidecar answering — is the editor command still running?' }
  }

  const parsed = SidecarStatusSchema.safeParse(payload)
  if (!parsed.success) {
    return { state: 'unavailable', reason: 'The sidecar answered with something this editor does not recognise.' }
  }

  return { state: 'connected', status: parsed.data }
}
