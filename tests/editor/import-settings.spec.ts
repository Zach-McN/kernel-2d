import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import type { AssetMeta, TextureImportSettings } from '../../sidecar/meta-schema.js'

import { assetRow, selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Changing a texture's import settings, against the real editor, the real
 * service, and the real project folder.
 *
 * Every test here is one of the acceptance criteria for this feature, in the
 * units they were written in (editor-verification V1): what the human does,
 * what the panel then says, and what the folder then holds. The folder is the
 * database, so "it worked" always means the bytes on disk changed — never that
 * a control looks right.
 *
 * The one-second budget is asserted rather than assumed. It is the whole of the
 * requirement, and a session that quietly spends it is how a sub-second promise
 * becomes a two-second one.
 */

const KNIGHT = 'assets/textures/characters/knight-idle.png'
const SLIME = 'assets/textures/characters/slime.png'
const STRIP = 'assets/textures/characters/knight-run-strip.png'

/** The human's budget, from "the `.meta` on disk says linear within a second". */
const WITHIN_A_SECOND = 1_000

// --- the folder, and putting it back --------------------------------------

/**
 * These tests change files in the shared sample project, so every `.meta` is
 * remembered before each one and put back after. Without this the suite would
 * depend on the order its files happen to run in, which is the kind of flake
 * that gets diagnosed as a product bug.
 */
let snapshot = new Map<string, string>()

test.beforeEach(async ({ page }) => {
  snapshot = new Map(everyMetaFile().map((file) => [file, fs.readFileSync(file, 'utf8')]))

  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test.afterEach(async () => {
  for (const [file, contents] of snapshot) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) {
      fs.writeFileSync(file, contents)
    }
  }
  for (const file of everyMetaFile()) {
    if (!snapshot.has(file)) fs.rmSync(file, { force: true })
  }
})

function everyMetaFile(root = editorTestProjectPath()): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) return everyMetaFile(full)
      return entry.name.endsWith('.meta') ? [full] : []
    })
    .sort()
}

function metaFile(assetPath: string): string {
  return path.join(editorTestProjectPath(), `${assetPath.replaceAll('/', path.sep)}.meta`)
}

function readMeta(assetPath: string): AssetMeta {
  return JSON.parse(fs.readFileSync(metaFile(assetPath), 'utf8')) as AssetMeta
}

/** The settings on disk, which is the only place an answer counts. */
function textureOnDisk(assetPath: string): TextureImportSettings {
  const settings = readMeta(assetPath).importSettings
  if (settings.type !== 'texture') throw new Error(`${assetPath} is not a texture`)
  return settings
}

function writeMetaByHand(assetPath: string, meta: unknown): void {
  fs.writeFileSync(metaFile(assetPath), `${JSON.stringify(meta, null, 2)}\n`)
}

// --- driving the editor ----------------------------------------------------

async function setFilter(page: Page, value: 'nearest' | 'linear'): Promise<void> {
  await page.getByTestId('filter-control').selectOption(value)
}

async function typeInto(page: Page, testId: string, text: string): Promise<void> {
  const field = page.getByTestId(testId)
  await field.click()
  await field.press('ControlOrMeta+a')
  // Typed a character at a time, because "one press of Ctrl-Z, not one per
  // digit" is a claim about keystrokes and `fill` makes only one of them.
  await field.pressSequentially(text, { delay: 20 })
}

const undo = (page: Page): Promise<void> => page.keyboard.press('ControlOrMeta+z')
const redo = (page: Page): Promise<void> => page.keyboard.press('Control+y')

// --- the acceptances -------------------------------------------------------

test.describe('changing a setting', () => {
  test('puts it on disk within a second', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    expect(textureOnDisk(KNIGHT).filter).toBe('nearest')

    await setFilter(page, 'linear')

    await expect
      .poll(() => textureOnDisk(KNIGHT).filter, { timeout: WITHIN_A_SECOND })
      .toBe('linear')
  })

  test('is taken back by Ctrl-Z, on screen and on disk', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await setFilter(page, 'linear')
    await expect.poll(() => textureOnDisk(KNIGHT).filter, { timeout: WITHIN_A_SECOND }).toBe('linear')

    await undo(page)

    await expect(page.getByTestId('filter-control')).toHaveValue('nearest')
    await expect.poll(() => textureOnDisk(KNIGHT).filter, { timeout: WITHIN_A_SECOND }).toBe('nearest')
  })

  test('is put forward again by Ctrl-Y', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await setFilter(page, 'linear')
    await undo(page)
    await expect(page.getByTestId('filter-control')).toHaveValue('nearest')

    await redo(page)

    await expect(page.getByTestId('filter-control')).toHaveValue('linear')
    await expect.poll(() => textureOnDisk(KNIGHT).filter, { timeout: WITHIN_A_SECOND }).toBe('linear')
  })
})

test.describe('one undo stack for the whole project', () => {
  test('goes back through changes to different files, most recent first', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await typeInto(page, 'pivot-x-control', '0.25')
    await expect.poll(() => textureOnDisk(KNIGHT).pivot.x, { timeout: WITHIN_A_SECOND }).toBe(0.25)

    await selectAsset(page, SLIME)
    await setFilter(page, 'linear')
    await expect.poll(() => textureOnDisk(SLIME).filter, { timeout: WITHIN_A_SECOND }).toBe('linear')

    // Both presses happen with the slime selected: which file is being looked
    // at has nothing to do with what Ctrl-Z reverses.
    await undo(page)
    await expect.poll(() => textureOnDisk(SLIME).filter, { timeout: WITHIN_A_SECOND }).toBe('nearest')
    expect(textureOnDisk(KNIGHT).pivot.x).toBe(0.25)

    await undo(page)
    await expect.poll(() => textureOnDisk(KNIGHT).pivot.x, { timeout: WITHIN_A_SECOND }).toBe(0.5)
  })

  test('reverses the last thing that was changed, not the last thing that was looked at', async ({
    page,
  }) => {
    await selectAsset(page, KNIGHT)
    await setFilter(page, 'linear')
    await expect.poll(() => textureOnDisk(KNIGHT).filter, { timeout: WITHIN_A_SECOND }).toBe('linear')

    // Clicking around, which changes nothing.
    await selectAsset(page, SLIME)
    await selectAsset(page, STRIP)
    await assetRow(page, 'assets/textures/characters').click()

    await undo(page)

    await expect.poll(() => textureOnDisk(KNIGHT).filter, { timeout: WITHIN_A_SECOND }).toBe('nearest')
  })
})

test.describe('typing a number', () => {
  test('is one press of Ctrl-Z, not one per digit', async ({ page }) => {
    await selectAsset(page, STRIP)
    await expect(page.getByTestId('frame-width-control')).toHaveValue('16')

    await typeInto(page, 'frame-width-control', '24')
    await expect.poll(() => onDiskFrameWidth(STRIP), { timeout: WITHIN_A_SECOND }).toBe(24)

    await undo(page)

    await expect(page.getByTestId('frame-width-control')).toHaveValue('16')
    await expect.poll(() => onDiskFrameWidth(STRIP), { timeout: WITHIN_A_SECOND }).toBe(16)
  })

  test('starts a new step once the field has been left', async ({ page }) => {
    await selectAsset(page, STRIP)

    await typeInto(page, 'frame-width-control', '24')
    await page.getByTestId('frame-height-control').click()
    await typeInto(page, 'frame-width-control', '48')
    await expect.poll(() => onDiskFrameWidth(STRIP), { timeout: WITHIN_A_SECOND }).toBe(48)

    await undo(page)

    await expect(page.getByTestId('frame-width-control')).toHaveValue('24')
  })
})

test.describe('a .meta somebody edited by hand', () => {
  test('keeps a key of their own when the editor changes a setting', async ({ page }) => {
    const original = readMeta(KNIGHT)
    writeMetaByHand(KNIGHT, { ...original, myOwnNote: 'the walk cycle starts on frame 3' })

    await selectAsset(page, KNIGHT)
    // Wait for the editor to have picked up the hand-edited file, so the change
    // below is made on top of it rather than on top of what was there before.
    await expect.poll(() => readMeta(KNIGHT)).toMatchObject({ myOwnNote: expect.any(String) })

    await setFilter(page, 'linear')
    await expect.poll(() => textureOnDisk(KNIGHT).filter, { timeout: WITHIN_A_SECOND }).toBe('linear')

    expect(readMeta(KNIGHT)).toMatchObject({ myOwnNote: 'the walk cycle starts on frame 3' })
  })

  test('shows their new value, and is not quietly written over', async ({ page }) => {
    await selectAsset(page, KNIGHT)
    await expect(page.getByTestId('pivot-y-control')).toHaveValue('1')

    const original = readMeta(KNIGHT)
    writeMetaByHand(KNIGHT, {
      ...original,
      importSettings: { ...original.importSettings, pivot: { x: 0.5, y: 0.25 } },
    })

    await expect(page.getByTestId('pivot-y-control')).toHaveValue('0.25', { timeout: 2_000 })

    // Left alone, bytes and timestamp both: contents alone would pass for a
    // file the editor had rewritten with identical bytes, which is a different
    // promise (editor-verification V12).
    const settled = fs.statSync(metaFile(KNIGHT))
    await page.waitForTimeout(500)
    expect(fs.statSync(metaFile(KNIGHT)).mtimeMs).toBe(settled.mtimeMs)
    expect(textureOnDisk(KNIGHT).pivot.y).toBe(0.25)
  })
})

test.describe('the settings that are not a texture', () => {
  test('stay as sentences rather than becoming empty controls', async ({ page }) => {
    await selectAsset(page, 'assets/audio/sfx/jump.wav')

    await expect(page.getByTestId('inspector-note')).toContainText('Nothing to tune on import')
    await expect(page.getByTestId('filter-control')).toHaveCount(0)
  })
})

function onDiskFrameWidth(assetPath: string): number | null {
  const slice = textureOnDisk(assetPath).slice
  return slice.mode === 'grid' ? slice.frameWidth : null
}
