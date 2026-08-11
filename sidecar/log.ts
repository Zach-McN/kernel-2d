import type { SidecarConfig } from './config.js'
import type { ProjectTree } from './tree-schema.js'
import type { FileEvent, FileEventKind } from './watcher.js'

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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

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

export function formatBanner(config: SidecarConfig, tree: ProjectTree, url: string): string[] {
  return [
    'kernel-2d sidecar',
    `  project    ${config.displayPath}`,
    `  contents   ${plural(tree.fileCount, 'file')} in ${plural(tree.directoryCount, 'folder')}`,
    `  tree URL   ${url}/tree`,
    '  watching   changes appear below — a rename shows as one removal and one addition',
    '',
  ]
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
