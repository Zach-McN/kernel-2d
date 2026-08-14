import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset as select } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * The Inspector, against the real sample project served by the real sidecar.
 *
 * The rule under test throughout is that it always says something: the cases
 * where there is nothing to tune are ordinary, and a panel that goes blank for
 * them is indistinguishable from one that has broken.
 */

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test.describe('the Inspector', () => {
  test('asks you to select something before anything is selected', async ({ page }) => {
    await expect(note(page)).toContainText('Select a file or folder')
  })

  test('shows a texture its id, its type and how it is cut into frames', async ({ page }) => {
    await select(page, 'assets/textures/characters/knight-run-strip.png')

    await expect(page.getByTestId('inspector-name')).toHaveText('knight-run-strip.png')
    await expect(page.getByTestId('inspector-type')).toHaveText('Texture')
    await expect(page.getByTestId('slice-mode-control')).toHaveValue('grid')
    await expect(page.getByTestId('frame-width-control')).toHaveValue('16')
    await expect(page.getByTestId('frame-height-control')).toHaveValue('16')
    await expect(page.getByTestId('filter-control')).toHaveValue('nearest')
    await expect(page.getByTestId('pivot-x-control')).toHaveValue('0.5')
    await expect(page.getByTestId('pivot-y-control')).toHaveValue('1')

    // Any id will do; that there is one, and it is not blank, is the promise.
    await expect(page.getByTestId('inspector-id')).not.toBeEmpty()
  })

  test('shows who made a generated file, so provenance is visible rather than buried', async ({ page }) => {
    await select(page, 'assets/textures/characters/slime.png')

    await expect(page.getByTestId('inspector-generated')).toContainText('2026-08-11')
  })

  test('says a sound has nothing to tune yet, rather than showing an empty panel', async ({ page }) => {
    await select(page, 'assets/audio/sfx/jump.wav')

    await expect(page.getByTestId('inspector-type')).toHaveText('Audio')
    await expect(note(page)).toContainText('Nothing to tune on import')
  })

  test('names a scene as a scene, says how much is in it, and points at the Outliner', async ({ page }) => {
    await select(page, 'scenes/level-01.json')

    await expect(page.getByTestId('inspector-document-format')).toHaveText('Scene')
    await expect(page.getByTestId('inspector-entity-count')).toHaveText('5 entities')
    await expect(note(page)).toContainText('Select an entity in the Outliner')
  })

  test('says what is wrong with a document it cannot read, and shows the file', async ({ page }) => {
    // A `.json` in a format nothing knows: the honest answer is "this editor
    // does not know that format", not "this file is invalid".
    const stray = path.join(editorTestProjectPath(), 'scenes', 'from-the-future.json')
    fs.writeFileSync(stray, '{ "format": "kernel2d.starfield", "version": 9 }\n')

    try {
      await select(page, 'scenes/from-the-future.json')

      await expect(note(page)).toContainText('kernel2d.starfield')
      await expect(page.locator('.inspector__raw')).toContainText('starfield')
    } finally {
      fs.rmSync(stray, { force: true })
    }
  })

  test('names a README as something it does not import, and has nothing to tune for it', async ({
    page,
  }) => {
    await select(page, 'assets/source/README.txt')

    await expect(page.getByTestId('inspector-type')).toHaveText('Not something the editor imports')
    await expect(note(page)).toContainText('Nothing to tune on import')
  })

  /**
   * The other half of that: a file the editor does not import *and* has no
   * settings file for. It is written by hand here because the sample project has
   * none — everything in it was either given a `.meta` by the generator or is a
   * document whose own folder names it.
   */
  test('says plainly that it does not import a file it has no settings for', async ({ page }) => {
    const notes = path.join(editorTestProjectPath(), 'assets', 'source', 'sketch-notes.txt')
    fs.writeFileSync(notes, 'rough ideas for the second level')

    try {
      await select(page, 'assets/source/sketch-notes.txt')

      await expect(note(page)).toContainText('does not import this kind of file')
    } finally {
      fs.rmSync(notes, { force: true })
    }
  })

  test('shows a folder what it holds', async ({ page }) => {
    await select(page, 'assets')

    await expect(page.getByTestId('inspector-name')).toHaveText('assets')
    await expect(note(page)).toContainText('no import settings of its own')
  })

  test('shows what is inside settings it cannot read, and leaves the file alone', async ({ page }) => {
    const broken = path.join(editorTestProjectPath(), 'assets', 'textures', 'ui', 'icon-moon.png')
    fs.writeFileSync(broken, 'pretend-png-bytes')
    fs.writeFileSync(`${broken}.meta`, '{ half a file')

    try {
      await select(page, 'assets/textures/ui/icon-moon.png')

      await expect(note(page)).toContainText('not valid JSON')
      await expect(page.locator('.inspector__raw')).toContainText('half a file')
      expect(fs.readFileSync(`${broken}.meta`, 'utf8')).toBe('{ half a file')
    } finally {
      fs.rmSync(broken, { force: true })
      fs.rmSync(`${broken}.meta`, { force: true })
    }
  })

  test('follows the selection from one file to the next', async ({ page }) => {
    await select(page, 'assets/textures/characters/knight-idle.png')
    await expect(page.getByTestId('inspector-name')).toHaveText('knight-idle.png')

    await select(page, 'assets/textures/characters/slime.png')
    await expect(page.getByTestId('inspector-name')).toHaveText('slime.png')
  })
})

// --- the one thing that is about behaviour rather than appearance ----------

test.describe('an entity’s turn rate', () => {
  const LEVEL_ONE = 'scenes/level-01.json'

  async function selectEntity(page: Page, name: string): Promise<void> {
    await select(page, LEVEL_ONE)
    await page
      .getByTestId('outliner-panel')
      .locator('[data-entity-id]')
      .filter({ hasText: name })
      .first()
      .click()
  }

  function levelFile(): string {
    return path.join(editorTestProjectPath(), 'scenes', 'level-01.json')
  }

  /**
   * The turn rate one named entity carries on disk, or null.
   *
   * Read out of the level rather than searched for as text, because level one
   * has an entity that turns in it already — a plain "does the file mention a
   * rate" would be answered by the health icon whichever entity was being
   * edited, and would pass while testing nothing.
   */
  function spinInFile(name: string): number | null {
    const level = JSON.parse(fs.readFileSync(levelFile(), 'utf8')) as {
      entities: Array<{ name: string; components: { spin?: { degreesPerSecond: number } } }>
    }
    const entity = level.entities.find((one) => one.name === name)
    return entity?.components.spin?.degreesPerSecond ?? null
  }

  test('shows the rate the level gives it, and nothing for an entity that does not turn', async ({
    page,
  }) => {
    await selectEntity(page, 'Health icon')
    await expect(page.getByTestId('entity-spin-control')).toHaveValue('90')

    await selectEntity(page, 'Knight')
    // Nought and "does not turn" are the same thing to look at, which is what
    // lets one field cover both without a checkbox beside it.
    await expect(page.getByTestId('entity-spin-control')).toHaveValue('0')
  })

  test('writes a rate to the file, and Ctrl-Z takes it back', async ({ page }) => {
    await selectEntity(page, 'Knight')
    const field = page.getByTestId('entity-spin-control')
    await field.click()
    await field.press('ControlOrMeta+a')
    await field.pressSequentially('45', { delay: 20 })

    await expect.poll(() => spinInFile('Knight')).toBe(45)

    // No undo code was written for this field. It is on the one stack because
    // every write in the editor goes through the transaction API
    // (`editor-kernel` D7), and this is the evidence rather than the claim.
    // One press for the whole run of keystrokes, because the merge key carries
    // the entity and the field.
    await page.keyboard.press('ControlOrMeta+z')
    await expect(field).toHaveValue('0')
    await expect.poll(() => spinInFile('Knight')).toBeNull()

    // And the entity nobody touched still turns — the undo put back one field
    // of one entity rather than a level.
    expect(spinInFile('Health icon')).toBe(90)
  })

  test('takes the component out of the level when the rate goes back to nought', async ({ page }) => {
    // A level stays a description of what is in it: an entity somebody clicked
    // on and thought better of does not end up carrying a rate of nothing.
    await selectEntity(page, 'Health icon')
    const field = page.getByTestId('entity-spin-control')
    await field.click()
    await field.press('ControlOrMeta+a')
    await field.pressSequentially('0', { delay: 20 })

    await expect.poll(() => spinInFile('Health icon')).toBeNull()
    // The rest of the entity is exactly as it was: this took a component out,
    // it did not rewrite a level.
    expect(fs.readFileSync(levelFile(), 'utf8')).toContain('icon-heart.png')
  })
})

function note(page: Page) {
  return page.getByTestId('inspector-note')
}
