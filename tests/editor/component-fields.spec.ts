import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Fields for a component the *game* invented, drawn from the game's own
 * description of it — against the real editor, the real service and the real
 * sample project.
 *
 * The sample's `patrol` is the subject throughout, and the point of using it is
 * that nothing about it was arranged for this feature: the Slime has carried a
 * patrol since the day the sample was first written, `src/systems/patrol.ts` has
 * read it, and the Inspector's answer was a sentence saying it had no controls
 * for it. The only new thing in the folder is `components/patrol.json`.
 *
 * **What every test here is really asserting is that the kernel does not know
 * what a patrol is.** The word appears in a file in the project folder and
 * nowhere in the editor, so a test that passes because somebody wrote a patrol
 * panel would be a test that passed for the wrong reason. The one that would
 * catch that is the last: delete the description and the fields go.
 */

const LEVEL_ONE = 'scenes/level-01.json'
const DESCRIPTION = 'components/patrol.json'

/** The human's budget, from "within a second". */
const WITHIN_A_SECOND = 1_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

// --- reading what happened --------------------------------------------------

async function selectEntity(page: Page, name: string): Promise<void> {
  await selectAsset(page, LEVEL_ONE)
  await page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: name }).first().click()
  await expect(page.getByTestId('inspector-name')).toHaveText(name)
}

function levelFile(): string {
  return path.join(editorTestProjectPath(), 'scenes', 'level-01.json')
}

function descriptionFile(): string {
  return path.join(editorTestProjectPath(), 'components', 'patrol.json')
}

/**
 * The patrol one named entity carries on disk, or null.
 *
 * Read out of the level by entity rather than searched for as text: level one
 * has a patrol in it already, so "does the file mention a speed" would be
 * answered by the Slime whichever entity was being edited.
 */
function patrolInFile(name: string): Record<string, unknown> | null {
  const level = JSON.parse(fs.readFileSync(levelFile(), 'utf8')) as {
    entities: Array<{ name: string; components: Record<string, unknown> }>
  }
  const carried = level.entities.find((one) => one.name === name)?.components['patrol']
  return typeof carried === 'object' && carried !== null ? (carried as Record<string, unknown>) : null
}

/** Typing a number into a generated field, the way the spin field is driven. */
async function type(page: Page, testId: string, value: string): Promise<void> {
  const field = page.getByTestId(testId)
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.pressSequentially(value, { delay: 20 })
}

// --- acceptance: the fields exist because a file says so --------------------

test('an entity carrying a described component gets a field per described field', async ({ page }) => {
  await selectEntity(page, 'Slime')

  // The section is called what the description calls it, not what the type is.
  await expect(page.getByTestId('inspector-panel')).toContainText('Patrol')
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveValue('24')
  await expect(page.getByTestId('entity-component-patrol-fromX')).toHaveValue('200')
  await expect(page.getByTestId('entity-component-patrol-toX')).toHaveValue('296')
})

test('a described component is no longer reported as one with no controls', async ({ page }) => {
  await selectEntity(page, 'Slime')

  // The sentence that was the whole of the Inspector's answer to `patrol` is
  // gone, because the section above it now says everything it said.
  await expect(page.getByTestId('entity-unknown-components')).toHaveCount(0)
})

// --- acceptance: the fields write the level --------------------------------

test('typing in one reaches the level within a second, and one Ctrl-Z takes it back', async ({ page }) => {
  await selectEntity(page, 'Slime')

  await type(page, 'entity-component-patrol-unitsPerSecond', '48')

  await expect
    .poll(() => patrolInFile('Slime')?.['unitsPerSecond'], { timeout: WITHIN_A_SECOND + 1_000 })
    .toBe(48)

  // No undo code was written for a generated field: it goes through the same
  // transaction API every other control does (`editor-kernel` D7), with a merge
  // key per field, so the whole run of keystrokes is one press.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveValue('24')
})

/**
 * The half a wholesale write would break. The description names three fields;
 * the component in a level may carry a fourth that some system reads, and a
 * control that replaced the object would delete it silently on the first
 * keystroke.
 */
test('writing one field leaves a key the description has never heard of alone', async ({ page }) => {
  const level = JSON.parse(fs.readFileSync(levelFile(), 'utf8')) as {
    entities: Array<{ name: string; components: Record<string, Record<string, unknown>> }>
  }
  const slime = level.entities.find((one) => one.name === 'Slime')
  if (slime !== undefined) slime.components['patrol'] = { ...slime.components['patrol'], pauseFor: 2 }
  fs.writeFileSync(levelFile(), `${JSON.stringify(level, null, 2)}\n`)

  await selectEntity(page, 'Slime')
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveValue('24')

  await type(page, 'entity-component-patrol-unitsPerSecond', '30')

  await expect.poll(() => patrolInFile('Slime')?.['unitsPerSecond']).toBe(30)
  expect(patrolInFile('Slime')?.['pauseFor']).toBe(2)
})

// --- acceptance: putting one on and taking it off ---------------------------

test('an entity without one is offered Add, which writes the described defaults', async ({ page }) => {
  await selectEntity(page, 'Knight')
  expect(patrolInFile('Knight')).toBeNull()

  await page.getByTestId('entity-component-patrol-add').click()

  await expect.poll(() => patrolInFile('Knight')).toEqual({ unitsPerSecond: 24, fromX: 0, toX: 0 })
  // And the fields are there to tune, on the entity that now has one.
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveValue('24')
})

test('Remove takes the component out of the level, and Ctrl-Z brings it back', async ({ page }) => {
  await selectEntity(page, 'Slime')

  await page.getByTestId('entity-component-patrol-remove').click()

  await expect.poll(() => patrolInFile('Slime')).toBeNull()
  await expect(page.getByTestId('entity-component-patrol-add')).toBeVisible()
  // The rest of the entity is exactly as it was: this took a component off, it
  // did not rewrite a level.
  expect(fs.readFileSync(levelFile(), 'utf8')).toContain('slime.png')

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => patrolInFile('Slime')?.['unitsPerSecond']).toBe(24)
})

// --- acceptance: the panel never says something untrue ----------------------

test('a value the field cannot show is said out loud rather than shown as a default', async ({ page }) => {
  const level = JSON.parse(fs.readFileSync(levelFile(), 'utf8')) as {
    entities: Array<{ name: string; components: Record<string, Record<string, unknown>> }>
  }
  const slime = level.entities.find((one) => one.name === 'Slime')
  if (slime !== undefined) slime.components['patrol'] = { ...slime.components['patrol'], unitsPerSecond: 'fast' }
  fs.writeFileSync(levelFile(), `${JSON.stringify(level, null, 2)}\n`)

  await selectEntity(page, 'Slime')

  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveValue('24')
  await expect(page.getByTestId('entity-component-patrol-mismatch')).toContainText('Speed')
  // Shown, and not yet written over: a level is only changed by somebody typing.
  expect(patrolInFile('Slime')?.['unitsPerSecond']).toBe('fast')
})

// --- acceptance: the description is a file, and behaves like one ------------

/**
 * The test that would catch a hand-written patrol panel pretending to be a
 * generated one, which is the only way every other test in this file could pass
 * for the wrong reason.
 */
test('deleting the description takes the fields away, and the old sentence comes back', async ({ page }) => {
  await selectEntity(page, 'Slime')
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toBeVisible()

  fs.rmSync(descriptionFile())

  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveCount(0, {
    timeout: WITHIN_A_SECOND + 2_000,
  })
  await expect(page.getByTestId('entity-unknown-components')).toContainText('patrol')
})

test('selecting the description shows what the editor read from it, not a level', async ({ page }) => {
  await selectAsset(page, DESCRIPTION)

  await expect(page.getByTestId('inspector-document-format')).toHaveText('Component')
  await expect(page.getByTestId('component-type')).toHaveText('patrol')
  await expect(page.getByTestId('component-field-unitsPerSecond')).toContainText('number')
  await expect(page.getByTestId('component-note')).toContainText('Entities can carry')
})

test('the description says how many entities in the open level carry one', async ({ page }) => {
  await selectAsset(page, LEVEL_ONE)
  await selectAsset(page, DESCRIPTION)

  await expect(page.getByTestId('component-in-level')).toContainText('1 entity carries')
})

test('a picture of the generated fields', async ({ page }, testInfo) => {
  await selectEntity(page, 'Slime')
  // Scrolled to, because the generated section is below the hand-written ones
  // and a panel screenshot is of what is on screen — the picture is here to be
  // looked at when somebody reports these fields as looking wrong
  // (`editor-verification` V31), so it has to have them in it.
  await page.getByTestId('entity-component-patrol-remove').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toBeVisible()
  await page.getByTestId('inspector-panel').screenshot({ path: testInfo.outputPath('component-fields.png') })
})
