import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The one line that keeps an exported game clean.
 *
 * The runtime ships inside the game; the editor and the filesystem service
 * never do (`editor-kernel` D1). The editor imports the runtime and embeds it
 * as its viewport (D2), so the arrow points one way — and an arrow that points
 * one way is a promise until something checks it.
 *
 * Written as a test rather than left to review because the failure is
 * invisible: an import from `editor/` into `runtime/` compiles, passes every
 * behaviour test, runs perfectly in the editor, and shows up as a shipped game
 * carrying a React panel and a Node service's schemas. By then it is a week of
 * unpicking rather than a one-line correction.
 *
 * It lives in `tests/architecture/` rather than `tests/runtime/` because it is
 * a test *about* the runtime rather than a test *of* it: it reads files off
 * disk, so it belongs to the Node half of the two TypeScript projects
 * (`editor-ui` U4), where `node:fs` exists.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME = path.join(REPO_ROOT, 'runtime')

/** Folders the runtime may not reach into, and why each one must not ship. */
const FORBIDDEN = [
  { folder: 'editor', because: 'the editor never ships inside a game' },
  { folder: 'sidecar', because: 'the filesystem service is development-only' },
  { folder: 'scripts', because: 'development entry points never ship' },
  { folder: 'tests', because: 'tests never ship' },
]

function runtimeFiles(directory = RUNTIME): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry)
    if (statSync(absolute).isDirectory()) return runtimeFiles(absolute)
    return absolute.endsWith('.ts') ? [absolute] : []
  })
}

/** Every module specifier in a file, from static imports, re-exports and `import(...)`. */
function importsIn(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier !== undefined) specifiers.push(specifier)
    }
  }

  return specifiers
}

describe('the runtime stands on its own', () => {
  const files = runtimeFiles()

  it('has files to check, so a green result means something', () => {
    // Without this, deleting or moving `runtime/` would make every assertion
    // below vacuously true and the suite would go quiet rather than red.
    expect(files.length).toBeGreaterThan(2)
  })

  for (const { folder, because } of FORBIDDEN) {
    it(`never imports from ${folder}/, because ${because}`, () => {
      const offenders: string[] = []

      for (const file of files) {
        for (const specifier of importsIn(readFileSync(file, 'utf8'))) {
          const resolved = specifier.startsWith('.')
            ? path.resolve(path.dirname(file), specifier)
            : path.join(REPO_ROOT, specifier)
          const target = path.relative(REPO_ROOT, resolved).split(/[\\/]/)[0]

          if (target === folder) {
            offenders.push(`${path.relative(REPO_ROOT, file)} imports ${specifier}`)
          }
        }
      }

      expect(offenders).toEqual([])
    })
  }

  it('reaches outside itself only for packages a game would ship with', () => {
    // Not a blanket ban on dependencies — the runtime is allowed to have them —
    // but a list short enough that adding to it is a decision somebody makes on
    // purpose rather than a line that slips in.
    const allowed = new Set(['phaser', 'zod'])
    const external = new Set<string>()

    for (const file of files) {
      for (const specifier of importsIn(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.')) continue
        external.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : (specifier.split('/')[0] ?? specifier))
      }
    }

    expect([...external].filter((name) => !allowed.has(name))).toEqual([])
  })
})
