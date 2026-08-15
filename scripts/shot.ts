import fs from 'node:fs'
import path from 'node:path'

import { chromium, type Page } from '@playwright/test'

import { resolveConfig } from '../sidecar/config.js'
import { toPosixPath } from '../sidecar/paths.js'
import { startEditor } from './editor/start.js'

/**
 * `npm run shot -- <path-to-project-folder> [state...]`
 *
 * Pictures of the editor, taken by the editor. Starts it, drives it to a few
 * named states, saves a PNG of each, and stops.
 *
 * **Why this is a committed tool and not a snippet.** Every session that changes
 * how the editor looks has to look at it, and the way that was done before was a
 * throwaway script written from scratch each time — slightly different every
 * time, and half a minute of scaffolding before anything could be seen. The
 * definition of done says visual changes are screenshot-verified; this is the
 * thing that verifies them.
 *
 * It only ever *looks*: every state selects, opens and zooms, and none of them
 * moves, places or renames anything, so it is safe to point at the human's own
 * game folder. The editor's `.meta` sweep still runs, exactly as it does when
 * the human opens that folder themselves.
 */

/**
 * Never the default ports. A shot run must not collide with — or quietly attach
 * to — an editor the human already has open, which is the same reasoning as
 * `playwright.config.ts` and the same trap it avoids: a picture of the wrong
 * project.
 */
const EDITOR_PORT = 5473
const SIDECAR_PORT = 7531

const USAGE =
  'Usage: npm run shot -- <path-to-project-folder> [state...] [--out <folder>] [--width <n>] [--height <n>] [--scale <n>]\n' +
  'States: editor, level, texture, tabs. All of them, if none is named.'

interface Options {
  project: string
  states: string[]
  out: string
  width: number
  height: number
  /** Pixels per pixel. Above 1 for looking closely at chrome — a corner, a hairline. */
  scale: number
}

type Clip = { x: number; y: number; width: number; height: number } | undefined
type Shot = (page: Page, projectPath: string) => Promise<Clip>

// --- the states ------------------------------------------------------------

const SHOTS: Record<string, Shot> = {
  /** As it opens: nothing selected, every panel saying what it is for. */
  editor: async () => undefined,

  /** A level open with an entity selected — Outliner, Viewport and Inspector all full. */
  level: async (page, projectPath) => {
    await openLevel(page, projectPath)
    await page.locator('[data-entity-id]').nth(1).click()
    await settle(page)
    return undefined
  },

  /** A texture, its import settings, and the frame guides drawn over it. */
  texture: async (page, projectPath) => {
    const texture = firstFile(projectPath, '.png')
    if (texture === null) return undefined

    await select(page, texture)
    await page.locator('.dv-default-tab-content', { hasText: 'Texture' }).click()
    await settle(page)
    return undefined
  },

  /** Close in on the tab bar, where a pixel of chrome is the whole subject. */
  tabs: async (page, projectPath) => {
    await openLevel(page, projectPath)
    await settle(page)
    return { x: 0, y: 24, width: 620, height: 130 }
  },
}

// --- driving it ------------------------------------------------------------

/** Opens the project's startup level, or the first level it can find. */
async function openLevel(page: Page, projectPath: string): Promise<void> {
  const level = startupScene(projectPath) ?? firstFile(projectPath, '.json', 'scenes')
  if (level === null) return
  await select(page, level)
  await settle(page)
}

/**
 * Clicks a file in the Assets panel, opening each folder above it first.
 *
 * Opening is checked rather than clicked blindly: a click on a folder is a
 * toggle, so a helper that always clicked would close a folder an earlier step
 * had left open (`editor-verification` W6).
 */
async function select(page: Page, assetPath: string): Promise<void> {
  await showTree(page)
  const segments = assetPath.split('/')
  for (let depth = 1; depth < segments.length; depth += 1) {
    const folder = segments.slice(0, depth).join('/')
    const item = page.locator(`li.asset-row:has(> button[data-asset-path="${folder}"])`)
    if ((await item.getAttribute('aria-expanded')) === 'true') continue
    await page.locator(`[data-asset-path="${folder}"]`).click()
    await page.waitForTimeout(120)
  }
  await page.locator(`[data-asset-path="${assetPath}"]`).click()
}

/**
 * The panel opens on the icon view and `select` walks the tree, so the first
 * walk switches the view through the cog, exactly as a hand would.
 */
async function showTree(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="assets-panel"]')
  if ((await panel.getAttribute('data-view')) !== 'icons') return
  await page.locator('[data-testid="assets-settings"]').click()
  await page.locator('[data-testid="assets-view-list"]').click()
  await page.waitForTimeout(120)
}

/** Long enough for a scene to load, a camera to frame it, and a canvas to draw. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(1_200)
}

// --- reading the project ---------------------------------------------------

function startupScene(projectPath: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(projectPath, 'project.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const scene = (parsed as { startupScene?: unknown }).startupScene
    return typeof scene === 'string' && scene !== '' ? scene : null
  } catch {
    return null
  }
}

/** The first file with this extension, depth first, project-relative and forward-slashed. */
function firstFile(projectPath: string, extension: string, within = ''): string | null {
  const root = path.join(projectPath, within)
  if (!fs.existsSync(root)) return null

  const walk = (folder: string): string | null => {
    const entries = fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) {
        const found = walk(full)
        if (found !== null) return found
      } else if (entry.name.endsWith(extension)) {
        return toPosixPath(path.relative(projectPath, full))
      }
    }
    return null
  }

  return walk(root)
}

// --- the command line ------------------------------------------------------

function readOptions(argv: readonly string[]): Options | null {
  const positional: string[] = []
  let out = 'shots'
  let width = 1440
  let height = 900
  let scale = 1

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? ''
    const value = argv[index + 1]

    if (token === '--out' || token === '--width' || token === '--height' || token === '--scale') {
      if (value === undefined) {
        console.error(`${token} needs a value.\n${USAGE}`)
        return null
      }
      if (token === '--out') out = value
      if (token === '--width') width = Number(value)
      if (token === '--height') height = Number(value)
      if (token === '--scale') scale = Number(value)
      index += 1
      continue
    }

    if (token.startsWith('-')) {
      console.error(`Unknown option: ${token}\n${USAGE}`)
      return null
    }
    positional.push(token)
  }

  const [project, ...states] = positional
  if (project === undefined) {
    console.error(`No project folder given.\n${USAGE}`)
    return null
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(scale) || scale <= 0) {
    console.error(`Width, height and scale are numbers.\n${USAGE}`)
    return null
  }

  const named = states.filter((state) => !(state in SHOTS))
  if (named.length > 0) {
    console.error(`No such state: ${named.join(', ')}\n${USAGE}`)
    return null
  }

  return { project, states: states.length > 0 ? states : Object.keys(SHOTS), out, width, height, scale }
}

// --- the command -----------------------------------------------------------

const options = readOptions(process.argv.slice(2))
if (options === null) process.exit(1)

const resolved = resolveConfig([options.project, '--port', String(SIDECAR_PORT)], {}, process.cwd())
if (!resolved.ok) {
  console.error(resolved.message)
  process.exit(1)
}

const config = resolved.config
const editor = await startEditor(config, { open: false, port: EDITOR_PORT })

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: options.width, height: options.height },
  deviceScaleFactor: options.scale,
})
const written: string[] = []

fs.mkdirSync(options.out, { recursive: true })

try {
  for (const state of options.states) {
    const shot = SHOTS[state]
    if (shot === undefined) continue

    await page.goto(`http://127.0.0.1:${String(EDITOR_PORT)}/`)
    await page.waitForSelector('[data-testid="assets-panel"]')
    const clip = await shot(page, config.projectPath)

    const file = path.join(options.out, `${state}.png`)
    await page.screenshot(clip === undefined ? { path: file } : { path: file, clip })
    written.push(file)
  }
} finally {
  await browser.close()
  await editor.close()
}

console.log('')
console.log('kernel-2d shots')
for (const file of written) console.log(`  ${toPosixPath(path.resolve(file))}`)
console.log('')

// The editor's watcher keeps this process alive on its own; the shots are done.
process.exit(0)
