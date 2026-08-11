import type { ReactElement } from 'react'

import type { SidecarConnection } from './useSidecarStatus'

/**
 * The one line that answers "what am I connected to?" — the project's short
 * name, the full folder it resolved to, and whether the sidecar is answering.
 * The full path is spelled out rather than abbreviated because two projects
 * with the same folder name is an ordinary situation.
 */
export function StatusStrip({ connection }: { connection: SidecarConnection }): ReactElement {
  const connected = connection.state === 'connected' ? connection.status : null

  return (
    <header className="status-strip" data-testid="status-strip" data-connection={connection.state}>
      <span className="status-strip__brand">kernel-2d</span>

      <span className="status-strip__project" data-testid="status-project">
        {connected?.projectName ?? 'no project'}
      </span>

      <span className="status-strip__path" data-testid="status-path" title={connected?.projectPath ?? ''}>
        {connected?.projectPath ?? ''}
      </span>

      <span className="status-strip__connection">
        <span className="status-strip__dot" aria-hidden="true" />
        <span data-testid="status-connection">{describe(connection)}</span>
      </span>
    </header>
  )
}

function describe(connection: SidecarConnection): string {
  switch (connection.state) {
    case 'connecting':
      return 'Looking for the sidecar…'
    case 'connected':
      return 'Connected'
    case 'unavailable':
      return connection.reason
  }
}
