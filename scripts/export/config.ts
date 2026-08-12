import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PROJECT_ENV_VAR } from '../../sidecar/config.js'
import { toPosixPath } from '../../sidecar/paths.js'

/**
 * Where the export reads from and where it writes to, or one sentence saying why it
 * will not run.
 *
 * A pure function returning a result, never throwing and never exiting, for the
 * reason the sidecar's own config is written this way (`editor-kernel` D9): the
 * refusals are the interesting half of a command that puts a folder on somebody's
 * disk, and they are only testable if deciding is separate from acting.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Where an export lands unless told otherwise. Beside the editor's own build output. */
const DEFAULT_OUT_ROOT = path.join(REPO_ROOT, 'dist')

export const USAGE =
  'Usage: npm run export -- <path-to-project-folder> [--out <folder>] [--date YYYY-MM-DD]\n' +
  `Or name the project folder once in ${PROJECT_ENV_VAR} and leave it off the command.`

export interface ExportConfig {
  /** Absolute, real (symlinks resolved), OS-native path to the project being exported. */
  projectPath: string
  /** Absolute, OS-native path to the folder the game is written into. May not exist yet. */
  outPath: string
  /** The same paths with forward slashes, for printing. */
  projectDisplayPath: string
  outDisplayPath: string
  /** Recorded in the export's own manifest. Pinned by the tests so runs are identical. */
  generatedAt: string
}

export type ExportConfigResult = { ok: true; config: ExportConfig } | { ok: false; message: string }

export function resolveExportConfig(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  today: string,
): ExportConfigResult {
  let projectArg: string | undefined
  let outArg: string | undefined
  let dateArg: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? ''

    const named = namedOption(token, argv[i + 1], '--out')
    if (named !== null) {
      if (named.missing) return { ok: false, message: `--out needs a folder.\n${USAGE}` }
      outArg = named.value
      i += named.consumed
      continue
    }

    const date = namedOption(token, argv[i + 1], '--date')
    if (date !== null) {
      if (date.missing) return { ok: false, message: `--date needs a date.\n${USAGE}` }
      dateArg = date.value
      i += date.consumed
      continue
    }

    if (token.startsWith('-')) return { ok: false, message: `Unknown option: ${token}\n${USAGE}` }

    if (projectArg !== undefined) {
      return { ok: false, message: `Only one project folder can be exported at a time.\n${USAGE}` }
    }
    projectArg = token
  }

  // Command line beats environment, the same way the editor's does — so a shell
  // profile or a test harness can name the folder once.
  const project = firstFilled(projectArg, env[PROJECT_ENV_VAR])
  if (project === undefined) return { ok: false, message: `No project folder given.\n${USAGE}` }

  const absolute = path.resolve(cwd, project)

  let projectPath: string
  try {
    projectPath = fs.realpathSync(absolute)
  } catch {
    return { ok: false, message: `Project folder not found: ${toPosixPath(absolute)}` }
  }

  if (!fs.statSync(projectPath).isDirectory()) {
    return { ok: false, message: `Not a folder: ${toPosixPath(projectPath)}` }
  }

  const generatedAt = dateArg ?? today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(generatedAt)) {
    return { ok: false, message: `--date has to be written YYYY-MM-DD, not "${generatedAt}".` }
  }

  const outPath =
    outArg === undefined
      ? path.join(DEFAULT_OUT_ROOT, path.basename(projectPath))
      : path.resolve(cwd, outArg)

  /*
   * An export inside the project folder is refused, and the reason is not tidiness.
   *
   * The filesystem service watches that folder and creates a `.meta` beside every
   * file with a recognised asset extension (`editor-kernel` D17) — so an export
   * living in there would grow a sidecar next to every copied PNG the next time the
   * editor was opened, which both litters somebody's project and means two exports
   * of the same game are no longer the same folder. It would also show up in the
   * asset browser as part of the game.
   */
  if (isInside(projectPath, outPath)) {
    return {
      ok: false,
      message:
        `That would put the export inside the project folder (${toPosixPath(outPath)}).\n` +
        'The editor watches that folder and writes import settings beside every asset in it, so an ' +
        'export kept there would be modified behind your back. Choose somewhere outside it.',
    }
  }

  if (isInside(outPath, projectPath)) {
    return {
      ok: false,
      message:
        `That would put the project folder inside the export (${toPosixPath(outPath)}).\n` +
        'The export replaces what it wrote last time, so this would eventually delete your game.',
    }
  }

  return {
    ok: true,
    config: {
      projectPath,
      outPath,
      projectDisplayPath: toPosixPath(projectPath),
      outDisplayPath: toPosixPath(outPath),
      generatedAt,
    },
  }
}

/** Whether `inner` is `outer` itself or anything under it, compared as real paths. */
function isInside(outer: string, inner: string): boolean {
  const relative = path.relative(resolveExisting(outer), resolveExisting(inner))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * The realpath of the nearest existing ancestor, with the rest appended.
 *
 * The out folder usually does not exist yet, so it cannot be `realpath`'d — but the
 * project folder has been, and on Windows and macOS a temp folder is commonly
 * reached through a link. Comparing a resolved path with an unresolved one is how
 * "is this inside that" quietly answers no (`editor-verification` V4).
 */
function resolveExisting(target: string): string {
  let head = path.resolve(target)
  const tail: string[] = []

  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...tail.reverse())
    } catch {
      const parent = path.dirname(head)
      if (parent === head) return path.resolve(target)
      tail.push(path.basename(head))
      head = parent
    }
  }
}

interface NamedOption {
  value: string
  /** 1 when the value was the next token, 0 when it was joined with `=`. */
  consumed: number
  missing: boolean
}

function namedOption(token: string, next: string | undefined, name: string): NamedOption | null {
  if (token === name) {
    if (next === undefined) return { value: '', consumed: 0, missing: true }
    return { value: next, consumed: 1, missing: false }
  }
  if (token.startsWith(`${name}=`)) {
    const value = token.slice(name.length + 1)
    return { value, consumed: 0, missing: value === '' }
  }
  return null
}

function firstFilled(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') return value
  }
  return undefined
}
