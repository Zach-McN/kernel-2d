import { formatBytes } from './bytes.js'
import type { SidecarConfig } from './config.js'
import type { FileEventKind } from './event-schema.js'
import type { SweepReport } from './meta-files.js'
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

export interface BannerExtras {
  /**
   * Present when the sidecar is running behind an editor window, absent when it
   * was started on its own.
   */
  editorUrl?: string | undefined
  /** What the startup sweep did to the folder's `.meta` files, if it ran. */
  metas?: SweepReport | undefined
}

/**
 * One banner either way, so there is a single place that answers "what is
 * running, which folder is it holding, and what did it change on the way in".
 *
 * That last part is why the sweep is reported here rather than left silent:
 * this is the only moment the service deletes anything, so every file it
 * removed is named where the human is already looking.
 */
export function formatBanner(
  config: SidecarConfig,
  tree: ProjectTree,
  url: string,
  extras: BannerExtras = {},
): string[] {
  const { editorUrl, metas } = extras

  return [
    editorUrl === undefined ? 'kernel-2d sidecar' : 'kernel-2d editor',
    `  project    ${config.displayPath}`,
    `  contents   ${plural(tree.fileCount, 'file')} in ${plural(tree.directoryCount, 'folder')}`,
    ...(metas === undefined ? [] : formatSweep(metas)),
    ...(editorUrl === undefined ? [] : [`  editor     ${editorUrl}`]),
    `  tree URL   ${url}/tree`,
    '  watching   changes appear below — a rename shows as one removal and one addition',
    '',
  ]
}

function formatSweep(metas: SweepReport): string[] {
  const lines = [
    `  settings   ${plural(metas.created.length, '.meta file')} created, ${metas.kept} already there`,
  ]

  if (metas.removedOrphans.length > 0) {
    lines.push(`  removed    ${plural(metas.removedOrphans.length, '.meta file')} with no file beside them:`)
    for (const orphan of metas.removedOrphans) lines.push(`               ${orphan}`)
  }

  return lines
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
