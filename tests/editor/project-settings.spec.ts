import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Choosing which level the game starts on.
 *
 * Every acceptance criterion of this half of the feature, in the units it was written
 * in (`editor-verification` V1): the choice is made in the editor, it reaches the file,
 * it survives a reload, a choice that is not a level is refused with a sentence, and
 * one press of Ctrl-Z takes it back.
 *
 * The last one is worth stating as a criterion rather than assumed: project settings
 * are an ordinary document, so undo covers them without a line of undo code being
 * written for them (`editor-kernel` D7). A test is how that claim stops being a claim.
 */

const PROJECT_FILE = 'project.json'
const LEVEL_ONE = 'scenes/level-01.json'
const LEVEL_TWO = 'scenes/level-02.json'
const SLIME_PREFAB = 'prefabs/enemy-slime.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

const control = (page: Page) => page.getByTestId('project-startup-control')
const note = (page: Page) => page.getByTestId('project-startup-note')

async function openProjectSettings(page: Page): Promise<void> {
  await selectAsset(page, PROJECT_FILE)
  await expect(page.getByTestId('inspector-document-format')).toHaveText('Project settings')
  await expect(control(page)).toBeVisible()
}

/** What the file on disk says the starting level is. */
function startupSceneOnDisk(): unknown {
  const text = fs.readFileSync(path.join(editorTestProjectPath(), PROJECT_FILE), 'utf8')
  return (JSON.parse(text) as { startupScene: unknown }).startupScene
}

/**
 * Chooses a level and waits for it to reach the file.
 *
 * The **one-second budget is a criterion in its own right** and has a test of its own
 * below; everywhere else the write landing is setup rather than the thing being
 * checked, so it gets a timeout that will not turn a busy machine into a red suite for
 * a reason no acceptance criterion mentions. Spending the human's budget in a test that
 * is not about it is how a sub-second requirement quietly becomes a flake.
 */
async function choose(page: Page, level: string): Promise<void> {
  await control(page).selectOption(level)
  await expect(control(page)).toHaveValue(level)
  await expect.poll(startupSceneOnDisk, { timeout: 5000 }).toBe(level)
}

test('the Inspector shows which level the game starts on', async ({ page }) => {
  await openProjectSettings(page)

  await expect(control(page)).toHaveValue(LEVEL_ONE)
  await expect(note(page)).toContainText('starts on level-01.json')
})

test('choosing a different level reaches the file within the second', async ({ page }) => {
  await openProjectSettings(page)

  // This test is the timing budget, transcribed (`editor-verification` V1). There is no
  // save button: the change is written after a short quiet period, and the whole round
  // trip is spent out of the human's one second (`editor-ui` U6). The picking round trip
  // that validates the choice is inside that second too, which is the part this feature
  // added to the budget.
  const started = Date.now()
  await control(page).selectOption(LEVEL_TWO)
  await expect.poll(startupSceneOnDisk, { timeout: 1000 }).toBe(LEVEL_TWO)
  expect(Date.now() - started).toBeLessThan(1000)
})

test('the choice survives a reload', async ({ page }) => {
  await openProjectSettings(page)
  await choose(page, LEVEL_TWO)

  await page.reload()
  await openProjectSettings(page)

  await expect(control(page)).toHaveValue(LEVEL_TWO)
  await expect(note(page)).toContainText('starts on level-02.json')
})

test('one press of Ctrl-Z takes the choice back', async ({ page }) => {
  await openProjectSettings(page)
  await choose(page, LEVEL_TWO)

  await page.keyboard.press('ControlOrMeta+z')

  await expect(control(page)).toHaveValue(LEVEL_ONE)
  await expect.poll(startupSceneOnDisk, { timeout: 5000 }).toBe(LEVEL_ONE)
})

test('choosing a prefab is refused in a sentence, and changes nothing', async ({ page }) => {
  await openProjectSettings(page)

  // Nothing about a path says whether the file at it is a level, so the pick reads the
  // file. A prefab is the ordinary way to get this wrong: it is a `.json`, it is in the
  // project, and a game cannot start on it.
  await control(page).selectOption(SLIME_PREFAB)

  await expect(page.getByTestId('project-startup-problem')).toContainText('enemy-slime.json')
  await expect(page.getByTestId('project-startup-problem')).toContainText('not a level')

  await expect(control(page)).toHaveValue(LEVEL_ONE)
  // The file is the thing that matters: a refusal that still wrote the path would be
  // an export refusing later over something the editor already knew.
  expect(startupSceneOnDisk()).toBe(LEVEL_ONE)
})

test('a starting level that is no longer there is said so, before an export refuses over it', async ({
  page,
}) => {
  const level = path.join(editorTestProjectPath(), LEVEL_ONE.replaceAll('/', path.sep))
  const bytes = fs.readFileSync(level)

  try {
    fs.rmSync(level)
    await openProjectSettings(page)

    await expect(note(page)).toContainText('is not in the project folder')
    await expect(note(page)).toContainText('an export will refuse')
  } finally {
    // The shared restore only covers files the editor can write, and a test that
    // removes anything else has to put it back itself or the rest of the run breaks
    // somewhere that has nothing to do with the cause (`editor-verification` W14).
    fs.writeFileSync(level, bytes)
  }
})

test('the picture of the project settings', async ({ page }) => {
  // Not a baseline. A picture to look at when something is reported as looking wrong,
  // which beats reasoning about the source.
  await openProjectSettings(page)
  await expect(note(page)).toContainText('starts on')
  await page.screenshot({ path: 'test-results/project-settings.png', fullPage: false })
})
