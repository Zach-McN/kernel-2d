import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Prefabs, against the real editor, the real service and the real project
 * folder: define a thing once, place it many times, and change every one of them
 * at once.
 *
 * Two of these tests are the feature and the rest are the surroundings.
 *
 * The first is **"changes every instance"** — and the assertion that makes it
 * mean something is the one about the file the human did *not* edit: changing
 * the prefab's picture must leave the level's bytes and its timestamp exactly as
 * they were. A design that copied the picture into each instance would pass
 * every visible check on this page and fail that one.
 *
 * The second is **"by reference and nothing else"** — a placed instance's entry
 * in the level holds the reference and no copy of what it inherits. That is the
 * property everything else rests on, and it is checked by reading the file for
 * what it does *not* contain.
 *
 * Every file the editor can write is snapshotted and put back afterwards, and
 * anything that appeared is removed (V14) — which is what lets a test delete the
 * sample's prefab to see what the level says about it.
 */

const LEVEL_TWO = 'scenes/level-02.json'
const SLIME_PREFAB = 'prefabs/enemy-slime.json'
const SLIME = 'assets/textures/characters/slime.png'
const KNIGHT = 'assets/textures/characters/knight-idle.png'

/** The human's budget, from "within a second". */
const WITHIN_A_SECOND = 1_000
const SETTLES = WITHIN_A_SECOND + 2_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

// --- driving ---------------------------------------------------------------

const outliner = (page: Page): Locator => page.getByTestId('outliner-panel')
const rows = (page: Page): Locator => outliner(page).locator('[data-entity-id]')
const row = (page: Page, name: string): Locator =>
  outliner(page).locator('[data-entity-id]').filter({ hasText: name }).first()

async function openScene(page: Page, scenePath: string): Promise<void> {
  await selectAsset(page, scenePath)
  await expect(outliner(page)).toHaveAttribute('data-scene', scenePath)
}

/** How many sprites the renderer reports having actually drawn (V17). */
function drawn(page: Page): Promise<string | null> {
  return page.getByTestId('viewport-panel').getAttribute('data-scene-drawn')
}

function fileFor(projectRelative: string): string {
  return path.join(editorTestProjectPath(), projectRelative.replaceAll('/', path.sep))
}

interface SceneFile {
  entities: { name: string; transform: { x: number; y: number }; components: Record<string, unknown> }[]
}

function sceneOnDisk(scenePath = LEVEL_TWO): SceneFile {
  return JSON.parse(fs.readFileSync(fileFor(scenePath), 'utf8')) as SceneFile
}

/** Bytes and timestamp together — the pair that makes "untouched" checkable (V12). */
function fingerprint(projectRelative: string): { text: string; modifiedAt: number } {
  const file = fileFor(projectRelative)
  return { text: fs.readFileSync(file, 'utf8'), modifiedAt: fs.statSync(file).mtimeMs }
}

/** Which texture each row in the Outliner says it draws. */
function textures(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((buttons) =>
    buttons.map((button) => button.querySelector('.entity-row__texture')?.textContent ?? ''),
  )
}

async function makePrefab(page: Page, name: string): Promise<void> {
  await page.locator('[data-asset-path="prefabs"]').click()
  const field = page.getByTestId('new-document-name')
  await field.click()
  await field.fill(name)
  await expect(page.getByTestId('new-prefab-create')).toBeEnabled()
  await page.getByTestId('new-prefab-create').click()
  await expect
    .poll(() => fs.existsSync(fileFor(`prefabs/${name}.json`)), { timeout: SETTLES })
    .toBe(true)
}

// --- acceptance: the sample already uses one --------------------------------

test('the sample level is built from a prefab, and it is drawn', async ({ page }) => {
  await openScene(page, LEVEL_TWO)

  // Four entities, four sprites on screen — two of which have no picture of
  // their own anywhere in the level file.
  await expect(rows(page)).toHaveCount(4)
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('4')

  await expect(row(page, 'Slime')).toHaveAttribute('data-entity-prefab', SLIME_PREFAB)
  await expect(row(page, 'Tilted slime')).toHaveAttribute('data-entity-prefab', SLIME_PREFAB)
  await expect(row(page, 'Cave floor')).toHaveAttribute('data-entity-prefab', '')

  // And the level really does say nothing about a picture for them.
  const slime = sceneOnDisk().entities.find((entity) => entity.name === 'Slime')
  expect(Object.keys(slime?.components ?? {})).toEqual(['prefab'])
})

// --- acceptance: editing one changes every instance -------------------------

test('changing the prefab changes every instance, and never touches the level', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('4')
  expect(await textures(page)).toEqual(['tileset-cave.png', 'slime.png', 'slime.png', 'button-idle.png'])

  const levelBefore = fingerprint(LEVEL_TWO)

  // The level stays open in the Viewport while the prefab is edited, which is
  // the whole point: both slimes change while you are looking at them.
  await selectAsset(page, SLIME_PREFAB)
  await expect(page.getByTestId('inspector-document-format')).toHaveText('Prefab')
  await page.getByTestId('prefab-texture-control').selectOption(KNIGHT)

  await expect
    .poll(() => textures(page), { timeout: SETTLES })
    .toEqual(['tileset-cave.png', 'knight-idle.png', 'knight-idle.png', 'button-idle.png'])
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('4')

  // The prefab was written…
  await expect
    .poll(() => fs.readFileSync(fileFor(SLIME_PREFAB), 'utf8').includes('knight-idle'), {
      timeout: SETTLES,
    })
    .toBe(true)

  // …and the level was not. Bytes *and* timestamp: an editor that copied the
  // picture into each instance would have had to rewrite this file, and
  // identical contents alone would still pass for a file rewritten with the
  // same text (V12).
  expect(fingerprint(LEVEL_TWO)).toEqual(levelBefore)
})

test('one press of Ctrl-Z takes the prefab change back, everywhere at once', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('4')

  await selectAsset(page, SLIME_PREFAB)
  await page.getByTestId('prefab-texture-control').selectOption(KNIGHT)
  await expect
    .poll(() => textures(page), { timeout: SETTLES })
    .toEqual(['tileset-cave.png', 'knight-idle.png', 'knight-idle.png', 'button-idle.png'])

  await page.keyboard.press('ControlOrMeta+z')

  await expect
    .poll(() => textures(page), { timeout: SETTLES })
    .toEqual(['tileset-cave.png', 'slime.png', 'slime.png', 'button-idle.png'])
})

// --- acceptance: making one and placing it ----------------------------------

test('a new prefab is made where the preview said, and opens ready to fill in', async ({ page }) => {
  await page.locator('[data-asset-path="prefabs"]').click()
  const field = page.getByTestId('new-document-name')
  await field.click()
  await field.fill('enemy-bat')

  await expect(page.getByTestId('new-document-path')).toContainText('prefabs/enemy-bat.json')

  await page.getByTestId('new-prefab-create').click()

  await expect.poll(() => fs.existsSync(fileFor('prefabs/enemy-bat.json')), { timeout: SETTLES }).toBe(true)
  await expect(page.locator('[data-asset-path="prefabs/enemy-bat.json"]')).toBeVisible()
  await expect(page.getByTestId('inspector-document-format')).toHaveText('Prefab')
  // Named after the file it went into, and editable from the first moment.
  await expect(page.getByTestId('prefab-name-control')).toHaveValue('enemy-bat')
  await expect(page.getByTestId('prefab-id')).not.toBeEmpty()
})

test('a name that is taken is refused, and the prefab that is there is left alone', async ({ page }) => {
  const before = fingerprint(SLIME_PREFAB)

  await page.locator('[data-asset-path="prefabs"]').click()
  const field = page.getByTestId('new-document-name')
  await field.click()
  await field.fill('enemy-slime')
  await page.getByTestId('new-prefab-create').click()

  await expect(page.getByTestId('new-document-problem')).toContainText('already something at that path')
  expect(fingerprint(SLIME_PREFAB)).toEqual(before)
})

test('a prefab is placed by reference and nothing else, however many times', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('4')

  await makePrefab(page, 'enemy-bat')
  await page.getByTestId('prefab-texture-control').selectOption(SLIME)

  // The first press from the prefab; the rest from the instance it just placed,
  // because the Inspector holds one thing at a time and placing selects what it
  // placed. Both buttons are the same gesture.
  await page.getByTestId('prefab-place').click()
  await page.getByTestId('entity-place-another').click()
  await page.getByTestId('entity-place-another').click()

  await expect(rows(page)).toHaveCount(7)
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('7')
  await expect(page.getByTestId('entity-prefab-count')).toContainText('3 times')

  // Three entities in the file, each holding a reference to one prefab and no
  // copy of the picture it draws. This is the assertion the whole feature rests
  // on, and it is about what the file does *not* contain.
  await expect
    .poll(
      () =>
        sceneOnDisk()
          .entities.filter((entity) => entity.name.startsWith('enemy-bat'))
          .map((entity) => Object.keys(entity.components).join('+')),
      { timeout: SETTLES },
    )
    .toEqual(['prefab', 'prefab', 'prefab'])
})

test('a placed instance lands where the viewport is looking, and is selected', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('4')

  await makePrefab(page, 'enemy-bat')
  await page.getByTestId('prefab-texture-control').selectOption(SLIME)
  await page.getByTestId('prefab-place').click()

  // Selected, so the outline is on it and one drag moves it off.
  await expect(page.getByTestId('inspector-name')).toHaveText('enemy-bat')
  // On screen rather than at an origin the camera may be nowhere near — which
  // is the whole reason it is placed at the middle of the view.
  await expect.poll(() => page.getByTestId('viewport-panel').getAttribute('data-scene-onscreen')).toBe('5')
})

test('one press of Ctrl-Z takes a placement back', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await makePrefab(page, 'enemy-bat')
  await page.getByTestId('prefab-texture-control').selectOption(SLIME)

  await page.getByTestId('prefab-place').click()
  await expect(rows(page)).toHaveCount(5)

  await page.keyboard.press('ControlOrMeta+z')

  await expect(rows(page)).toHaveCount(4)
})

// --- acceptance: an instance is an ordinary entity --------------------------

test('an instance moves, duplicates and deletes like anything else', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await row(page, 'Tilted slime').click()

  // Where it stands is its own, not the prefab's: this one is turned and the
  // other is not.
  await expect(page.getByTestId('entity-rotation-control')).toHaveValue('20')

  await page.getByTestId('entity-x-control').fill('200')
  await expect
    .poll(() => sceneOnDisk().entities.find((entity) => entity.name === 'Tilted slime')?.transform.x, {
      timeout: SETTLES,
    })
    .toBe(200)
  // Moving one instance is a change to the level, never to the prefab.
  expect(fs.readFileSync(fileFor(SLIME_PREFAB), 'utf8')).not.toContain('200')

  await page.getByTestId('entity-duplicate').click()
  await expect(rows(page)).toHaveCount(5)
  // The copy is an instance too — a duplicate that quietly cut the link would
  // look identical and stop following the prefab.
  await expect(row(page, 'Tilted slime 2')).toHaveAttribute('data-entity-prefab', SLIME_PREFAB)

  await page.getByTestId('entity-delete').click()
  await expect(rows(page)).toHaveCount(4)
})

test('the inspector for an instance points at the prefab instead of offering a picker', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await row(page, 'Slime').click()

  // No texture control at all: this entity's picture is not its to decide.
  await expect(page.getByTestId('entity-texture-control')).toHaveCount(0)
  await expect(page.getByTestId('entity-prefab-texture')).toHaveText(SLIME)
  await expect(page.getByTestId('entity-prefab-count')).toContainText('2 times')

  await page.getByTestId('entity-open-prefab').click()

  await expect(page.getByTestId('inspector-path')).toHaveText(SLIME_PREFAB)
  await expect(page.getByTestId('prefab-texture-control')).toBeVisible()
  // And the level is still the one open in the Viewport.
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-scene-showing', LEVEL_TWO)
})

// --- acceptance: when the prefab is not there -------------------------------

test('a prefab that goes missing is named, rather than its instances going quiet', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('4')

  // Deleted from the folder itself, the way it would happen in real life.
  fs.rmSync(fileFor(SLIME_PREFAB))

  await expect(row(page, 'Slime')).toHaveAttribute('data-entity-problem', 'missing prefab', {
    timeout: SETTLES,
  })
  await expect(page.getByTestId('viewport-problem').first()).toContainText('enemy-slime.json')
  // Two sprites left, and the level says which two are gone and why.
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('2')

  await row(page, 'Slime').click()
  await expect(page.getByTestId('entity-prefab-problem')).toContainText('not in the project folder')
})

test('a picture of a level built from a prefab', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await makePrefab(page, 'enemy-bat')
  await page.getByTestId('prefab-texture-control').selectOption(SLIME)
  await page.getByTestId('prefab-place').click()
  await page.getByTestId('entity-place-another').click()

  await selectAsset(page, SLIME_PREFAB)
  await expect(page.getByTestId('prefab-instance-count')).toContainText('2 times')
  await expect.poll(() => drawn(page), { timeout: SETTLES }).toBe('6')

  await page.screenshot({ path: 'test-results/prefabs.png', fullPage: false })
})
