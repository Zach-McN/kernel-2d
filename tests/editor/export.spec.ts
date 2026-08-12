import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { isSearchableName, markersIn } from '../../scripts/export/editor-markers.js'
import { EXPORT_MANIFEST_FILE, ExportManifestSchema } from '../../scripts/export/manifest-schema.js'
import { filesUnder } from '../../scripts/export/write.js'
import { compareDrawings, describeDrawingComparison, parseDrawing } from '../instruments/drawn-comparison.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { GAME_URL } from './served-game.js'
import { editorTestExportPath } from './test-export.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * A folder that plays the game.
 *
 * The folder under test was written by the real export command before this run started
 * (`playwright.config.ts`), and is being served by the real serve command — so both are
 * under test here as well as the page they produced.
 *
 * **The load-bearing test is the comparison.** The exported game draws the level, the
 * editor plays the same level, and the two pictures are checked against each other
 * entity by entity in the level's own units. That is `editor-verification` V24's
 * pattern with the one change the situation forces: the two surfaces are a browser
 * window and a docked panel, so they frame the level differently and a screen-pixel
 * comparison would find nothing but differences that do not matter. In level units they
 * agree exactly, and the instrument that says so has its own tests
 * (`tests/instruments/drawn-comparison.test.ts`).
 *
 * The rest is what the human asked to be able to check: that the folder holds no
 * editor, that it works from anywhere, and that a page opened off the disk says so
 * rather than going blank.
 */

const LEVEL_ONE = 'scenes/level-01.json'

restoreProjectAfterEach()

/**
 * The game's own report, read the way every other picture in this suite is read: off an
 * attribute, with an ordinary locator (`editor-verification` V17). The page also
 * publishes `window.kernel2d` for a human with a console open; nothing here reaches
 * into the page, because the Node half of the repo has no DOM in it on purpose
 * (`editor-ui` U4).
 */
const gameHost = (page: Page) => page.locator('#game')

async function openExportedGame(page: Page, url = `${GAME_URL}/`): Promise<void> {
  await page.goto(url)
  await expect(gameHost(page)).toHaveAttribute('data-game-state', 'drawn')
  await expect(gameHost(page).locator('canvas')).toBeVisible()
}

// --- the folder plays the game --------------------------------------------

test('the exported page draws the starting level, with nothing missing', async ({ page }) => {
  await openExportedGame(page)

  const host = gameHost(page)
  await expect(host).toHaveAttribute('data-game-scene', LEVEL_ONE)
  // Every entity in level one draws a picture, so a count short of five means
  // something did not make it into the folder.
  await expect(host).toHaveAttribute('data-game-drawn', '5')
  await expect(host).toHaveAttribute('data-game-problems', '0')

  // Nothing to say means nothing said: the sentence only appears when there is one.
  await expect(page.locator('#say')).toBeHidden()
})

test('the exported game draws the level exactly as play mode draws it', async ({ page }) => {
  /*
   * The precondition, made explicit rather than assumed: both sides have to be pictures
   * of the *same document*.
   *
   * The folder was exported before this run started, and the run has since opened level
   * one in several other specs. Each of those puts the file back afterwards, but the
   * editor writes after a quiet period — so a restore can land while a write is still
   * in the air and leave the project's level a drag away from the export's copy. The
   * test would then fail with a real, correctly-named position difference for a reason
   * that has nothing to do with exporting.
   *
   * So the export's own copy is written into the project first, before the editor is
   * loaded and can read anything. What is being checked here is the drawing, not the
   * file; the file being identical is the setup.
   */
  const level = path.join(editorTestProjectPath(), LEVEL_ONE.replaceAll('/', path.sep))
  fs.writeFileSync(level, fs.readFileSync(path.join(editorTestExportPath(), LEVEL_ONE)))

  // The game first, so the picture being compared against is not the one that has just
  // been influenced by anything the editor did.
  await openExportedGame(page)
  const game = parseDrawing(await gameHost(page).getAttribute('data-game-units'))
  expect(game.length).toBeGreaterThan(0)
  const gameScale = Number(await gameHost(page).getAttribute('data-game-scale'))

  // Then the same level, run from the file by the editor's Play.
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await selectAsset(page, LEVEL_ONE)

  const viewport = page.getByTestId('viewport-panel')
  await expect(viewport).toHaveAttribute('data-scene-showing', LEVEL_ONE)
  await expect(page.getByTestId('play-start')).toBeEnabled()
  await page.getByTestId('play-start').click()
  await expect(viewport).toHaveAttribute('data-play-state', 'running')
  // Which is itself checked against the editing view, so this comparison is against a
  // picture already known to be the one the human was looking at.
  await expect(viewport).toHaveAttribute('data-play-match', 'same')

  const playing = parseDrawing(await viewport.getAttribute('data-scene-units'))

  // The two windows are different sizes, so they are at different zooms — which is
  // exactly why this is compared in the level's units and not in pixels. Asserted
  // rather than assumed: if the two ever happened to agree, this test would still pass
  // while checking something much weaker than it claims to.
  const editorScale = Number(await viewport.getAttribute('data-scene-scale'))
  expect(gameScale).toBeGreaterThan(0)
  expect(gameScale).not.toBe(editorScale)

  const verdict = compareDrawings(game, playing, ['the exported game', 'play mode'])
  expect(verdict.kind, describeDrawingComparison(verdict)).toBe('same')
  expect(verdict.kind === 'same' && verdict.count).toBe(5)
})

test('the folder works from somewhere else entirely', async ({ page }, testInfo) => {
  // Moved rather than copied in place: "give it to somebody" means the folder stops
  // being where it was built, and every URL in the page has to be relative for that to
  // survive. Served over a fresh server on its own port, so nothing about the original
  // location is still in play.
  const moved = path.join(testInfo.outputDir, 'moved-game')
  fs.cpSync(editorTestExportPath(), moved, { recursive: true })

  const { startStaticServer } = await import('../../scripts/serve-folder.js')
  const server = await startStaticServer({ root: moved, port: 0 })

  try {
    await openExportedGame(page, `${server.url}/`)
    await expect(page.locator('#game')).toHaveAttribute('data-game-drawn', '5')
    await expect(page.locator('#game')).toHaveAttribute('data-game-problems', '0')
  } finally {
    await server.close()
  }
})

test('a page opened straight off the disk says so, rather than going blank', async ({ page }) => {
  // A browser refuses to load a module script from a file:// document, so the game
  // never runs — which is why the sentence comes from a plain inline script in the
  // page. Without it this is a black rectangle and an error in a console nobody has
  // open.
  const pageUrl = pathToFileURL(path.join(editorTestExportPath(), 'index.html')).href
  await page.goto(pageUrl)

  const say = page.locator('#say')
  await expect(say).toBeVisible()
  await expect(say).toContainText('has to be served')
  await expect(say).toHaveClass(/bad/)
})

// --- no editor in there ---------------------------------------------------

test('the folder holds a page, a game, and the project’s own files — and nothing else', async () => {
  const folder = editorTestExportPath()
  const manifest = ExportManifestSchema.parse(
    JSON.parse(fs.readFileSync(path.join(folder, EXPORT_MANIFEST_FILE), 'utf8')),
  )

  // Everything on disk is accounted for by the record the export left. That is the
  // rule that catches a stray, where a marker search would not.
  expect(filesUnder(folder)).toEqual([...manifest.files, EXPORT_MANIFEST_FILE].sort());

  // And what is in it is readable at a glance, which is how the human checks this by
  // eye rather than trusting a test.
  expect(manifest.files).toContain('index.html')
  expect(manifest.files).toContain('game.js')
  expect(manifest.files).toContain('project.json')
  expect(manifest.files).toContain(LEVEL_ONE)
  expect(manifest.startupScene).toBe(LEVEL_ONE)
})

test('nothing generated into the folder mentions the editor', async () => {
  const folder = editorTestExportPath()
  const manifest = ExportManifestSchema.parse(
    JSON.parse(fs.readFileSync(path.join(folder, EXPORT_MANIFEST_FILE), 'utf8')),
  )

  const hits = manifest.files
    .filter((file) => isSearchableName(file))
    .flatMap((file) => markersIn(file, fs.readFileSync(path.join(folder, file.replaceAll('/', path.sep)), 'utf8')))

  expect(
    hits.map((hit) => `${hit.file} mentions ${hit.marker.text}`),
    'the exported folder has editor code in it',
  ).toEqual([])
})

test('the folder holds no panel, no inspector and no filesystem service', async ({ page }) => {
  // Everything the page asked for, watched from outside the browser rather than from
  // inside the page.
  const asked: string[] = []
  page.on('request', (request) => asked.push(new URL(request.url()).pathname))

  // The same claim from the other side: the page itself. Every one of these is a thing
  // the editor's own page has, so their absence is the observable form of "there is no
  // editor in here".
  await openExportedGame(page)

  await expect(page.getByTestId('assets-panel')).toHaveCount(0)
  await expect(page.getByTestId('inspector-panel')).toHaveCount(0)
  await expect(page.getByTestId('viewport-panel')).toHaveCount(0)
  await expect(page.locator('.dv-dockview')).toHaveCount(0)

  // Nothing came from a service: every file the game opened came out of the folder
  // beside it, at the path the level names.
  expect(asked.filter((requested) => requested.startsWith('/api/'))).toEqual([])
  expect(asked).toContain(`/${LEVEL_ONE}`)
  expect(asked).toContain('/project.json')
})

test('the picture of the exported game', async ({ page }) => {
  // Not a baseline. A picture to look at when a folder is reported as looking wrong,
  // and the newest surface that can look wrong on its own.
  await openExportedGame(page)
  await page.screenshot({ path: 'test-results/exported-game.png', fullPage: false })
})
