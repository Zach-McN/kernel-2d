import { formatBytes } from './bytes.js'
import type { SidecarConfig } from './config.js'
import type { FileEventKind } from './event-schema.js'
import type { ProjectTree } from './tree-schema.js'
import type { FileEvent } from './watcher.js'

export { formatBytes }

/**
 * Terminal output, as pure functions. The formatting is the human-facing
 * surface of this service, so it is testable rather than inlined into
 * console.log calls.
 */

const SYMBOLS: Record<FileEventKind, string> = {
  added: '+',
  changed: '~',
  removed: '-',
}

const KIND_WIDTH = 7

/** e.g. `+ added   assets/textures/knight.png (12.4 KB)` */
export function formatEvent(event: FileEvent): string {
  const symbol = SYMBOLS[event.kind]
  const kind = event.kind.padEnd(KIND_WIDTH)
  const shownPath = event.isDirectory ? `${event.path}/` : event.path

  let suffix = ''
  if (event.isDirectory) suffix = ' (folder)'
  else if (event.size !== null) suffix = ` (${formatBytes(event.size)})`

  return `${symbol} ${kind} ${shownPath}${suffix}`
}

/** Local wall-clock `HH:MM:SS`, prefixed to each change line. */
export function formatTimestamp(at: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * `editorUrl` is present when the sidecar is running behind an editor window,
 * absent when it was started on its own. One banner either way, so there is a
 * single place that answers "what is running and which folder is it holding".
 */
export function formatBanner(
  config: SidecarConfig,
  tree: ProjectTree,
  url: string,
  editorUrl?: string,
): string[] {
  return [
    editorUrl === undefined ? 'kernel-2d sidecar' : 'kernel-2d editor',
    `  project    ${config.displayPath}`,
    `  contents   ${plural(tree.fileCount, 'file')} in ${plural(tree.directoryCount, 'folder')}`,
    ...(editorUrl === undefined ? [] : [`  editor     ${editorUrl}`]),
    `  tree URL   ${url}/tree`,
    '  watching   changes appear below — a rename shows as one removal and one addition',
    '',
  ]
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
