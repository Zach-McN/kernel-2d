import fs from 'node:fs'
import path from 'node:path'

import { toPosixPath } from './paths.js'

/** Loopback only. The tree endpoint lists the human's project folder; it has no business on the LAN. */
export const SIDECAR_HOST = '127.0.0.1'
export const DEFAULT_PORT = 7331
export const PORT_ENV_VAR = 'KERNEL_SIDECAR_PORT'
export const PROJECT_ENV_VAR = 'KERNEL_PROJECT'

export const USAGE =
  'Usage: npm run editor -- <path-to-project-folder> [--port <number>]\n' +
  `Or name the folder once in ${PROJECT_ENV_VAR} and leave it off the command.`

export interface SidecarConfig {
  /** Absolute, real (symlinks resolved), OS-native path to the watched project folder. */
  projectPath: string
  /** The same path with forward slashes, for printing and for JSON. */
  displayPath: string
  projectName: string
  host: string
  port: number
}

export type ConfigResult = { ok: true; config: SidecarConfig } | { ok: false; message: string }

/**
 * Turns command line and environment into a validated config, or into one clear
 * sentence explaining why the sidecar will not start. Never throws and never
 * exits — the caller decides what to do with a refusal, which is what makes
 * this testable.
 */
export function resolveConfig(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): ConfigResult {
  let projectArg: string | undefined
  let portArg: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? ''

    if (token === '--port') {
      const next = argv[i + 1]
      if (next === undefined) return { ok: false, message: `--port needs a number.\n${USAGE}` }
      portArg = next
      i += 1
      continue
    }

    if (token.startsWith('--port=')) {
      portArg = token.slice('--port='.length)
      continue
    }

    if (token.startsWith('-')) {
      return { ok: false, message: `Unknown option: ${token}\n${USAGE}` }
    }

    if (projectArg !== undefined) {
      return { ok: false, message: `The sidecar watches one project folder at a time.\n${USAGE}` }
    }
    projectArg = token
  }

  // Command line beats environment, the same way the port does. The
  // environment is what lets a test harness or a shell profile point the
  // sidecar at a folder without putting it on every command.
  const project = firstFilled(projectArg, env[PROJECT_ENV_VAR])
  if (project === undefined) {
    return { ok: false, message: `No project folder given.\n${USAGE}` }
  }

  const port = resolvePort(portArg, env[PORT_ENV_VAR])
  if (port === null) {
    const raw = portArg ?? env[PORT_ENV_VAR] ?? ''
    return { ok: false, message: `Port must be a whole number between 0 and 65535, not "${raw}".` }
  }

  const absolute = path.resolve(cwd, project)

  let realPath: string
  try {
    realPath = fs.realpathSync(absolute)
  } catch {
    return { ok: false, message: `Project folder not found: ${toPosixPath(absolute)}` }
  }

  if (!fs.statSync(realPath).isDirectory()) {
    return { ok: false, message: `Not a folder: ${toPosixPath(realPath)}` }
  }

  return {
    ok: true,
    config: {
      projectPath: realPath,
      displayPath: toPosixPath(realPath),
      projectName: path.basename(realPath),
      host: SIDECAR_HOST,
      port,
    },
  }
}

/** The first value that is present and not just whitespace. */
function firstFilled(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') return value
  }
  return undefined
}

/** Command line beats environment beats default. `null` means the value given was not a usable port. */
function resolvePort(fromArgv: string | undefined, fromEnv: string | undefined): number | null {
  const raw = fromArgv ?? fromEnv
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT
  if (!/^\d+$/.test(raw.trim())) return null
  const port = Number(raw.trim())
  if (port > 65535) return null
  return port
}
