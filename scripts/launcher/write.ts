import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GENERATED_BY, marksItself } from '../marking.js'

/**
 * The file a human double-clicks to open their game.
 *
 * It is generated rather than hand-written for one reason: it has to say where
 * the kernel sits as seen from that particular game folder, and the kernel is
 * the only thing that knows. A hand-written one would be a guess maintained by
 * hand in every game repo, and wrong the first time a folder moved.
 *
 * A Windows command file, because that is what Explorer will run from a
 * double-click. The console window it opens is not incidental — it is where the
 * editor's own output goes, and closing it is how the editor is stopped.
 */

/** Spaces on purpose: this is a button, and it is read before it is typed. */
export const LAUNCHER_NAME = 'Open editor.cmd'

/** Where this kernel is, worked out from this file rather than from the caller's cwd. */
export const KERNEL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface LauncherReport {
  /** Project-relative, forward-slashed, so it prints the same everywhere. */
  path: string
  /** False means a file of that name was already there without the generated marker. */
  written: boolean
}

export interface LauncherOptions {
  /** The kernel folder the launcher will start. This one, unless a test says otherwise. */
  kernelPath?: string
  /** The date recorded in the marker. Fixed by the tests; today's date otherwise. */
  generatedAt?: string
}

/**
 * Writes the launcher into a project folder, unless something unmarked is
 * already sitting there under that name.
 */
export function writeLauncher(projectPath: string, options: LauncherOptions = {}): LauncherReport {
  const absolute = path.join(projectPath, LAUNCHER_NAME)

  if (fs.existsSync(absolute) && !marksItself(absolute)) {
    return { path: LAUNCHER_NAME, written: false }
  }

  fs.writeFileSync(absolute, launcherText(projectPath, options))
  return { path: LAUNCHER_NAME, written: true }
}

/**
 * The launcher's exact text.
 *
 * CRLF throughout: `cmd.exe` is the one reader this file has, and it is the one
 * reader still entitled to care. The repository's `.gitattributes` keeps them,
 * for the same reason.
 */
export function launcherText(projectPath: string, options: LauncherOptions = {}): string {
  const kernelPath = options.kernelPath ?? KERNEL_ROOT
  const generatedAt = options.generatedAt ?? new Date().toISOString().slice(0, 10)
  const projectName = path.basename(projectPath)

  return (
    [
      '@echo off',
      `rem generatedBy: ${GENERATED_BY}`,
      `rem generatedAt: ${generatedAt}`,
      'rem',
      'rem Opens this folder in the kernel-2d editor. Double-click it.',
      'rem',
      'rem Written by the editor, not by hand. If this folder or the kernel-2d folder',
      'rem moves, the location below is stale: ask Claude to refresh this launcher, or',
      'rem run this from the kernel-2d folder yourself:',
      'rem',
      'rem   npm run launcher -- <path-to-this-folder>',
      '',
      'setlocal',
      '',
      'rem This file, with the trailing slash cut off: the folder it is sitting in.',
      'set "GAME=%~dp0"',
      'set "GAME=%GAME:~0,-1%"',
      `set "KERNEL=${kernelReference(projectPath, kernelPath)}"`,
      '',
      'if not exist "%KERNEL%\\package.json" (',
      '  echo Could not find the editor. It should be here:',
      '  echo.',
      '  echo     %KERNEL%',
      '  echo.',
      '  echo This folder or the kernel-2d folder has moved, so this launcher is',
      '  echo pointing at the wrong place. Nothing is lost and nothing is broken.',
      '  echo.',
      '  echo   ASK CLAUDE TO REFRESH THIS LAUNCHER',
      '  echo.',
      '  echo and it will rewrite this file with the new location. Or do it yourself,',
      '  echo from the kernel-2d folder:',
      '  echo.',
      '  echo     npm run launcher -- "%GAME%"',
      '  echo.',
      '  pause',
      '  exit /b 1',
      ')',
      '',
      `title ${projectName} - kernel-2d editor`,
      `echo Starting the editor on ${projectName}.`,
      'echo Close this window to stop it.',
      'echo.',
      '',
      'cd /d "%KERNEL%"',
      'call npm run editor -- "%GAME%"',
      '',
      'rem A window that vanishes takes the reason with it, so anything that went',
      'rem wrong waits to be read.',
      'if errorlevel 1 (',
      '  echo.',
      '  echo The editor stopped without finishing. The message above says why.',
      '  pause',
      ')',
      '',
    ].join('\r\n')
  )
}

/**
 * How the launcher names the kernel: relative to the folder it sits in, so the
 * whole workspace can be moved or copied and every game still opens.
 *
 * A different drive has no relative path to give, and the absolute one is then
 * the only true answer — a launcher that has to be regenerated after a move is
 * better than one that is silently wrong.
 */
function kernelReference(projectPath: string, kernelPath: string): string {
  const relative = path.relative(projectPath, kernelPath)
  if (relative === '' || path.isAbsolute(relative)) return kernelPath
  return `%GAME%\\${relative.split(/[\\/]/).join('\\')}`
}
