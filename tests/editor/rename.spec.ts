import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { showPanel } from './panels.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { openFileMenu, selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Renaming, moving and deleting a file from inside the editor — and the fixup
 * that is the whole reason for doing it here.
 *
 * Every acceptance criterion in the human's own units (`editor-verification`
 * V1): a renamed texture keeps being drawn, a moved file does too, a renamed
 * level takes the project's starting-level setting with it, a delete says what
 * still uses the file before it does it, and every refusal is a sentence naming
 * the file.
 *
 * **Two assertions carry the feature and neither is about the screen.** The
 * level's reference has the *new path and the same id* — the id is what a rename
 * must not disturb, because the `.meta` moved with the file and the witness is
 * still correct. And the export runs afterwards without refusing, which is the
 * failure this whole session exists to remove: before it, a rename in Explorer
 * left `npm run export` naming a picture it could not find.
 *
 * **This spec restores its own binaries.** The shared snapshot only covers what
 * the editor can write — `.meta` and `.json` — so a test that moves or deletes a
 * PNG has left it moved or deleted for the rest of the run (W14), and a folder
 * test has left a folder the restore cannot even write back into.
 */

const KNIGHT = 'assets/textures/characters/knight-idle.png'
const HEART = 'assets/textures/ui/icon-heart.png'
const LEVEL_ONE = 'scenes/level-01.json'
const PROJECT_FILE = 'project.json'
const UI_FOLDER = 'assets/textures/ui'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

// --- driving the control ----------------------------------------------------

const name = (page: Page) => page.getByTestId('move-file-name')
const folder = (page: Page) => page.getByTestId('move-file-folder')
const apply = (page: Page) => page.getByTestId('move-file-apply')
const remove = (page: Page) => page.getByTestId('move-file-delete')
const problem = (page: Page) => page.getByTestId('move-file-problem')
const uses = (page: Page) => page.getByTestId('move-file-uses')

async function moveIt(page: Page, from: string, to: { name?: string; folder?: string }): Promise<void> {
  await openFileMenu(page, from)
  if (to.name !== undefined) await name(page).fill(to.name)
  if (to.folder !== undefined) await folder(page).selectOption(to.folder)
  await apply(page).click()
}

async function openScene(page: Page): Promise<void> {
  await selectAsset(page, LEVEL_ONE)
  await expect(page.getByTestId('outliner-panel')).toHaveAttribute('data-scene', LEVEL_ONE)
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-scene-drawn', '5')
}

/**
 * Puts the level back in front before anything is asserted about the picture.
 *
 * Two rules stacked, and getting either wrong produces a failure that describes
 * the wrong subject.
 *
 * **The Viewport shares a group with the Texture tab**, so only one of them is
 * mounted and an assertion against the hidden one is an assertion against
 * nothing (`editor-verification` W12).
 *
 * **And the tab has to be claimed after the editor has taken the rename, not
 * after the file has changed** (W10). Selecting a texture brings the Texture tab
 * forward, and whether the newly-named file *is* a texture cannot be answered
 * until the folder listing catches up a few hundred milliseconds later. Click
 * Viewport inside that window and the Texture tab takes it straight back —
 * leaving `data-scene-drawn` frozen at whatever it was mid-rename, which reads
 * exactly like a level that never recovered. Waiting for the row to appear is
 * waiting for the editor rather than for the disk.
 */
async function backToTheLevel(page: Page, moved: string): Promise<void> {
  await expect(page.locator(`[data-asset-path="${moved}"]`)).toHaveCount(1)
  await showPanel(page, 'Viewport')
  await expect(page.getByTestId('viewport-panel')).toBeVisible()
}

// --- reading the folder, which is where the promises actually land -----------

function fileIn(relativePath: string): string {
  return path.join(editorTestProjectPath(), relativePath.replaceAll('/', path.sep))
}

function documentIn(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(fileIn(relativePath), 'utf8')) as Record<string, unknown>
}

/** The texture reference one named entity of a level holds. */
function textureOf(level: string, entityName: string): { id?: unknown; path?: unknown } {
  const entities = documentIn(level)['entities'] as { name: string; components: Record<string, unknown> }[]
  const found = entities.find((entity) => entity.name === entityName)
  if (found === undefined) throw new Error(`no entity called ${entityName} in ${level}`)
  return (found.components['sprite'] as { texture: { id?: unknown; path?: unknown } }).texture
}

/** Bytes and modification time together — the pair V12 is about. */
function fingerprint(relativePath: string): string {
  const absolute = fileIn(relativePath)
  return `${fs.readFileSync(absolute, 'utf8')}@${fs.statSync(absolute).mtimeMs}`
}

/** Puts a file back where it was, whatever the test did to it. */
function putBack(from: string, to: string): void {
  if (fs.existsSync(fileIn(from))) fs.renameSync(fileIn(from), fileIn(to))
}

// --- acceptance 1: a renamed texture keeps being drawn ----------------------

test('renaming a texture leaves every level still drawing it', async ({ page }) => {
  const pixels = Buffer.from(fs.readFileSync(fileIn(KNIGHT)))
  await openScene(page)

  try {
    await moveIt(page, KNIGHT, { name: 'hero-idle.png' })

    const renamed = 'assets/textures/characters/hero-idle.png'
    await expect.poll(() => textureOf(LEVEL_ONE, 'Knight')['path']).toBe(renamed)

    // The id is untouched. It is the witness every reference recorded, and the
    // `.meta` travelled with the file, so it is still the right one — rewriting
    // it would be inventing agreement rather than keeping it.
    expect(textureOf(LEVEL_ONE, 'Knight')['id']).toBe(
      (documentIn(`${renamed}.meta`) as { id: unknown })['id'],
    )

    // And the picture never breaks: five entities drawn, and nothing to say.
    await backToTheLevel(page, renamed)
    await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-scene-drawn', '5')
    await expect(page.getByTestId('viewport-problem')).toHaveCount(0)
  } finally {
    putBack('assets/textures/characters/hero-idle.png', KNIGHT)
    if (!fs.existsSync(fileIn(KNIGHT))) fs.writeFileSync(fileIn(KNIGHT), pixels)
  }
})

test('moving a file into another folder does the same', async ({ page }) => {
  await openScene(page)

  try {
    await moveIt(page, KNIGHT, { folder: UI_FOLDER })

    const moved = `${UI_FOLDER}/knight-idle.png`
    await expect.poll(() => textureOf(LEVEL_ONE, 'Knight')['path']).toBe(moved)
    expect(fs.existsSync(fileIn(`${moved}.meta`))).toBe(true)

    await backToTheLevel(page, moved)
    await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-scene-drawn', '5')
    await expect(page.getByTestId('viewport-problem')).toHaveCount(0)
  } finally {
    putBack(`${UI_FOLDER}/knight-idle.png`, KNIGHT)
  }
})

// --- acceptance 3: a renamed level takes the starting-level setting with it --

test('renaming a level makes the game still start on it', async ({ page }) => {
  expect(documentIn(PROJECT_FILE)['startupScene']).toBe(LEVEL_ONE)

  try {
    await moveIt(page, LEVEL_ONE, { name: 'opening.json' })

    await expect.poll(() => documentIn(PROJECT_FILE)['startupScene']).toBe('scenes/opening.json')

    // The Inspector agrees, rather than the file quietly being right while the
    // panel still names the old one.
    await selectAsset(page, PROJECT_FILE)
    await expect(page.getByTestId('project-startup-note')).toContainText('opening.json')
  } finally {
    putBack('scenes/opening.json', LEVEL_ONE)
  }
})

// --- acceptance 2: a folder, which is one gesture and many references -------

test('renaming a folder moves everything under it, references and all', async ({ page }) => {
  await openScene(page)

  try {
    await moveIt(page, UI_FOLDER, { name: 'hud' })

    await expect
      .poll(() => textureOf(LEVEL_ONE, 'Health icon')['path'])
      .toBe('assets/textures/hud/icon-heart.png')
    expect(fs.existsSync(fileIn('assets/textures/hud/icon-heart.png.meta'))).toBe(true)

    await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-scene-drawn', '5')
    await expect(page.getByTestId('viewport-problem')).toHaveCount(0)
  } finally {
    // The whole folder, before the shared restore runs — it puts files back by
    // path, and it cannot write into a folder that is no longer there.
    putBack('assets/textures/hud', UI_FOLDER)
  }
})

// --- acceptance 4: told first, then done ------------------------------------

test('deleting a file names what still uses it, and takes a second press', async ({ page }) => {
  const pixels = Buffer.from(fs.readFileSync(fileIn(HEART)))
  await openScene(page)

  try {
    await openFileMenu(page, HEART)
    await remove(page).click()

    await expect(uses(page)).toContainText(LEVEL_ONE)
    await expect(remove(page)).toHaveText('Delete anyway')
    // Nothing has happened yet, which is the whole point of the first press.
    expect(fs.existsSync(fileIn(HEART))).toBe(true)

    await remove(page).click()

    await expect.poll(() => fs.existsSync(fileIn(HEART))).toBe(false)
    // Its settings went with it rather than being left stranded.
    expect(fs.existsSync(fileIn(`${HEART}.meta`))).toBe(false)

    // And the level says the picture is missing, by name, through the machinery
    // that was already there.
    await showPanel(page, 'Viewport')
    await expect(page.getByTestId('viewport-problem')).toContainText('icon-heart.png')
  } finally {
    if (!fs.existsSync(fileIn(HEART))) fs.writeFileSync(fileIn(HEART), pixels)
  }
})

test('deleting a file nothing uses says so, and still takes a second press', async ({ page }) => {
  const source = 'assets/source/README.txt'
  const text = fs.readFileSync(fileIn(source), 'utf8')

  try {
    await openFileMenu(page, source)
    await remove(page).click()

    await expect(uses(page)).toContainText('Nothing else in the project uses')
    expect(fs.existsSync(fileIn(source))).toBe(true)

    await remove(page).click()
    await expect.poll(() => fs.existsSync(fileIn(source))).toBe(false)
  } finally {
    if (!fs.existsSync(fileIn(source))) fs.writeFileSync(fileIn(source), text)
  }
})

// --- acceptance 6: the refusals, as sentences -------------------------------

test('a name already taken is refused, and the file that has it is untouched', async ({ page }) => {
  const before = fingerprint(`${UI_FOLDER}/button-hover.png`)

  await moveIt(page, `${UI_FOLDER}/button-idle.png`, { name: 'button-hover.png' })

  await expect(problem(page)).toContainText('never writes over it')
  expect(fingerprint(`${UI_FOLDER}/button-hover.png`)).toBe(before)
  expect(fs.existsSync(fileIn(`${UI_FOLDER}/button-idle.png`))).toBe(true)
})

test('the settings file itself cannot be renamed away from what it annotates', async ({ page }) => {
  // Selectable on its own only when it is stranded, but the service is what
  // holds the rule and this is the sentence it gives.
  await moveIt(page, LEVEL_ONE, { name: 'level-01.json.meta' })

  await expect(problem(page)).toContainText('.meta')
  expect(fs.existsSync(fileIn(LEVEL_ONE))).toBe(true)
})

test('the project settings cannot be renamed out from under an export', async ({ page }) => {
  await moveIt(page, PROJECT_FILE, { name: 'settings.json' })

  await expect(problem(page)).toContainText('an export looks for')
  expect(fs.existsSync(fileIn(PROJECT_FILE))).toBe(true)
})

test('a folder offers no way to delete it, and says so', async ({ page }) => {
  await openFileMenu(page, UI_FOLDER)

  await expect(remove(page)).toHaveCount(0)
  await expect(page.getByTestId('move-file-folder-note')).toContainText('renamed or moved')
})

// --- acceptance 7: the export stops refusing --------------------------------

test('an export straight afterwards does not refuse over the file that moved', async ({ page }) => {
  const out = path.join(HERE, '..', '.tmp', 'rename-export')
  fs.rmSync(out, { recursive: true, force: true })

  await openScene(page)

  try {
    await moveIt(page, KNIGHT, { name: 'hero-idle.png' })
    await expect.poll(() => textureOf(LEVEL_ONE, 'Knight')['path']).toBe(
      'assets/textures/characters/hero-idle.png',
    )
    await backToTheLevel(page, 'assets/textures/characters/hero-idle.png')

    // The real command, as a process (V8): before this session it would have
    // refused here, naming a picture it could not find.
    const printed = execFileSync(
      'npm',
      ['run', '--silent', 'export', '--', editorTestProjectPath(), '--out', out, '--date', '2026-08-11'],
      { cwd: REPO_ROOT, stdio: 'pipe', shell: true },
    ).toString()

    expect(printed).toContain('hero-idle.png')
  } finally {
    putBack('assets/textures/characters/hero-idle.png', KNIGHT)
    fs.rmSync(out, { recursive: true, force: true })
  }
})
