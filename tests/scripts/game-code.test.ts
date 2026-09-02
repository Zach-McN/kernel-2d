import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  GAME_SYSTEMS_ENTRY,
  gameSystemsEntry,
  gameSystemsSource,
} from '../../scripts/game-code.js'

/**
 * The module a game folder's code arrives through.
 *
 * Asserted on the **source it generates** rather than by running a build, and that
 * is the whole reason this test is worth having: the generated text is what both
 * surfaces compile, so checking it needs no bundler, no browser and no export —
 * and a change that would make the editor and a shipped game disagree shows up
 * here as a string that stopped matching.
 *
 * Folders are built on disk at test time rather than committed (`editor-verification`
 * V3): the plugin's whole job is answering a question about a real filesystem, and a
 * fixture that only claims a file exists would be testing the claim.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRATCH = path.join(HERE, '..', '.tmp', 'game-code')

/** A project whose `src/systems/index.ts` is there, and one whose is not. */
const WITH_SYSTEMS = path.join(SCRATCH, 'with-systems')
const WITHOUT_SYSTEMS = path.join(SCRATCH, 'without-systems')

beforeAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true })

  const entry = gameSystemsEntry(WITH_SYSTEMS)
  fs.mkdirSync(path.dirname(entry), { recursive: true })
  fs.writeFileSync(entry, 'export const systems = []\n')

  // A project folder that exists and simply has no code in it — the ordinary
  // state of a game before anybody has written a system, and the state
  // `games/tower-defense` was in an hour ago.
  fs.mkdirSync(WITHOUT_SYSTEMS, { recursive: true })
})

afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true })
})

describe('the fixtures are real', () => {
  it('has a project whose systems entry is on disk, and one whose is not', () => {
    // W9: every assertion below is about the presence or absence of that file, so
    // a fixture that silently failed to build would make them agree about nothing.
    expect(fs.existsSync(gameSystemsEntry(WITH_SYSTEMS))).toBe(true)
    expect(fs.existsSync(gameSystemsEntry(WITHOUT_SYSTEMS))).toBe(false)
  })
})

describe('a project that has systems', () => {
  it('imports them from the project, at the one path a project keeps them', () => {
    const source = gameSystemsSource(WITH_SYSTEMS)

    expect(source).toContain('import { systems as gameSystems } from')
    expect(source).toContain(GAME_SYSTEMS_ENTRY)
  })

  it('names the file with forward slashes, whatever the platform calls it', () => {
    const source = gameSystemsSource(WITH_SYSTEMS)
    const quoted = source.slice(source.indexOf('from ') + 5, source.indexOf('\n'))

    // A Windows path dropped into a module specifier raw is a string full of
    // escape sequences: `C:\Users\...\systems\index.ts` loses the `\U` and the
    // `\i` before anything gets as far as resolving it.
    expect(quoted).not.toContain('\\')
    expect(JSON.parse(quoted)).toBe(gameSystemsEntry(WITH_SYSTEMS).replaceAll('\\', '/'))
  })
})

describe('a project that has no systems', () => {
  it('runs nothing, rather than falling back to the engine', () => {
    const source = gameSystemsSource(WITHOUT_SYSTEMS)

    expect(source).toContain('const gameSystems = []')
    // No import *statement* — `import.meta.hot` still appears, and is not one.
    expect(source).not.toMatch(/^import\s/m)

    // The load-bearing absence. A kernel that quietly ran its own demo inside a
    // project with no code would be `genre-spinup` S1's anticipation, and would
    // make `spin` load-bearing at the moment it was meant to stop being.
    expect(source).not.toContain('spin')
    expect(source).not.toContain('BUILT_IN_SYSTEMS')
  })

  it('says the same for a folder that is not a project at all', () => {
    expect(gameSystemsSource(null)).toBe(gameSystemsSource(WITHOUT_SYSTEMS))
  })
})

describe('what both surfaces get', () => {
  it('publishes the list twice — as it was, and as it is now', () => {
    const source = gameSystemsSource(WITH_SYSTEMS)

    // `systems` is what a shipped folder uses: one build, nothing edits it while
    // somebody is playing. `currentSystems()` is what the editor calls when Play
    // starts, which is how an edit reaches the next run without a page reload.
    expect(source).toContain('export const systems = gameSystems')
    expect(source).toContain('export function currentSystems()')
  })

  it('counts its own evaluations, and says so on the window only where there is a dev server', () => {
    const source = gameSystemsSource(null)
    expect(source).toContain('export function gameCodeVersion()')
    expect(source).toContain("current.version = (current.version || 0) + 1")
    // Guarded like the accept: a built game has no `import.meta.hot`, and the
    // whole line goes with it.
    expect(source).toContain("if (import.meta.hot) window.dispatchEvent(new Event('kernel2d:game-code'))")
  })

  it('has a path for a built game that never touches the hot-reload machinery', () => {
    const source = gameSystemsSource(WITH_SYSTEMS)

    // Both branches, spelled out. Vite replaces `import.meta.hot` with `undefined`
    // in a build, so the first line below is the whole of what a shipped game
    // runs and the rest eliminates — which is why an export cannot end up
    // carrying development plumbing.
    expect(source).toContain('if (!import.meta.hot) return { systems: gameSystems }')
    expect(source).toContain('if (import.meta.hot) import.meta.hot.accept()')
  })
})
