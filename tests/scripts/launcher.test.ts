import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LAUNCHER_NAME, launcherText, writeLauncher } from '../../scripts/launcher/write.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

const GENERATED_AT = '2026-08-13'

/**
 * The launcher is the one file the human is expected to double-click, and it is
 * the only piece of this project that is read by `cmd.exe` rather than by a
 * browser or by Node. What is asserted here is what a double-click depends on:
 * the name, the line endings, where it says the editor is, and the rule that it
 * never overwrites something it did not write.
 */
describe('the launcher a game folder is opened with', () => {
  let project: TempProject

  beforeEach(async () => {
    project = await makeTempProject()
  })

  afterEach(async () => {
    await project.cleanup()
  })

  const kernel = (): string => path.join(project.root, 'kernel-2d')
  const game = (): string => path.join(project.root, 'games', 'tower-defense')

  const write = (): ReturnType<typeof writeLauncher> => {
    fs.mkdirSync(game(), { recursive: true })
    return writeLauncher(game(), { kernelPath: kernel(), generatedAt: GENERATED_AT })
  }

  const written = (): string => fs.readFileSync(path.join(game(), LAUNCHER_NAME), 'utf8')

  it('writes a file Windows will run from a double-click', () => {
    const report = write()

    expect(report).toEqual({ path: 'Open editor.cmd', written: true })
    expect(fs.existsSync(path.join(game(), 'Open editor.cmd'))).toBe(true)
  })

  it('opens the editor on the folder it is sitting in', () => {
    write()

    // `%~dp0` is the folder holding the file, so the game folder is never
    // written down and moving the whole workspace cannot break it.
    expect(written()).toContain('set "GAME=%~dp0"')
    expect(written()).toContain('call npm run editor -- "%GAME%"')
    expect(written()).toContain('cd /d "%KERNEL%"')
  })

  it('finds the editor by a path relative to itself', () => {
    write()

    expect(written()).toContain('set "KERNEL=%GAME%\\..\\..\\kernel-2d"')
  })

  // Only Windows has two folders with no relative path between them, which is
  // also the only place this file is ever run.
  it.runIf(process.platform === 'win32')('falls back to the whole path when there is no relative one', () => {
    // Written out in full, this launcher is right until something moves and
    // obviously wrong after — which beats a relative path that quietly is not.
    fs.mkdirSync(game(), { recursive: true })

    const text = launcherText(game(), { kernelPath: 'Z:\\kernel-2d', generatedAt: GENERATED_AT })

    expect(text).toContain('set "KERNEL=Z:\\kernel-2d"')
  })

  it('ends every line the way cmd.exe expects', () => {
    write()

    const text = written()

    expect(text.split('\n').length).toBeGreaterThan(1)
    expect(text.replaceAll('\r\n', '')).not.toContain('\n')
  })

  it('says an AI wrote it, in the only place a command file can', () => {
    write()

    expect(written()).toContain('rem generatedBy: claude-opus-5')
    expect(written()).toContain(`rem generatedAt: ${GENERATED_AT}`)
  })

  it('waits instead of vanishing when it cannot find the editor', () => {
    write()

    const text = written()

    // A console window that closes itself takes the reason with it, which is
    // the whole failure mode of a double-clicked script.
    expect(text).toContain('if not exist "%KERNEL%\\package.json" (')
    expect(text.match(/^\s*pause$/gm)?.length).toBe(2)
  })

  it('tells the human to ask for a refresh rather than to run something', () => {
    write()

    // The person who sees this message is the one who never opens a terminal.
    // A message whose only remedy is a command is a message with no remedy.
    expect(written()).toContain('ASK CLAUDE TO REFRESH THIS LAUNCHER')
  })

  it('sticks to characters a console window can print', () => {
    write()

    // The console reads this in the OEM codepage, not UTF-8: a dash out of a
    // word processor arrives as mojibake in the middle of an error message.
    const strange = [...written()].filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code > 126 || (code < 32 && character !== '\r' && character !== '\n')
    })

    expect(strange).toEqual([])
  })

  it('produces the same bytes every time, so re-running does not churn the folder', () => {
    write()
    const first = written()

    write()

    expect(written()).toBe(first)
  })

  it('leaves a file of that name alone when nothing marks it as generated', () => {
    fs.mkdirSync(game(), { recursive: true })
    fs.writeFileSync(path.join(game(), LAUNCHER_NAME), 'echo my own launcher')

    const report = write()

    expect(report.written).toBe(false)
    expect(written()).toBe('echo my own launcher')
  })

  it('does overwrite what it wrote itself', () => {
    write()
    fs.writeFileSync(path.join(game(), LAUNCHER_NAME), 'rem generatedBy: claude-opus-5\r\necho stale\r\n')

    const report = write()

    expect(report.written).toBe(true)
    expect(written()).toContain('npm run editor')
  })

  it('names the game in the window it opens', () => {
    write()

    expect(written()).toContain('title tower-defense - kernel-2d editor')
  })
})
