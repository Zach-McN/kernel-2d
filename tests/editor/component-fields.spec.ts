import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import {
  serializeComponentDescription,
  type ComponentDescription,
} from '../../runtime/formats/component-schema.js'
import { DOOR_DESCRIPTION, DOOR_DESCRIPTION_PATH } from '../fixtures/door-description.js'
import { restoreProjectAfterEach } from './restore-project.js'
import { openFileMenu, selectAsset } from './select-asset.js'
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

/** Typing into a generated field, the way the spin field is driven. */
async function type(page: Page, testId: string, value: string): Promise<void> {
  await typeInto(page, testId, value)
}

async function typeInto(page: Page, testId: string, value: string): Promise<void> {
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

/**
 * The override the prefab format always allowed and the editor now writes: a
 * placement's own component beats its prefab's, whole. So "give this placement
 * its own" has to copy the whole thing — an enemy inheriting a speed *and* its
 * squashed art would otherwise be written as the speed alone, and lose the art
 * the description never knew about.
 */
test('Add on a placement inheriting one copies what the prefab gives it, keys the description never named included', async ({
  page,
}) => {
  const prefabFile = path.join(editorTestProjectPath(), 'prefabs', 'enemy-slime.json')
  const prefab = JSON.parse(fs.readFileSync(prefabFile, 'utf8')) as { components: Record<string, unknown> }
  const inherited = { unitsPerSecond: 12, fromX: 96, toX: 176, squashed: { texture: { id: 'abc', path: 'a.png' } } }
  prefab.components['patrol'] = inherited
  fs.writeFileSync(prefabFile, `${JSON.stringify(prefab, null, 2)}\n`)

  await selectAsset(page, 'scenes/level-02.json')
  await page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: 'Tilted slime' }).first().click()
  await expect(page.getByTestId('inspector-name')).toHaveText('Tilted slime')
  await expect(page.getByTestId('entity-component-patrol-inherited')).toBeVisible({ timeout: WITHIN_A_SECOND + 2_000 })

  // Readable before Add, as text: the prefab's 12, not the description's 24.
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveText('12')
  await expect(page.getByTestId('entity-component-patrol-fromX')).toHaveText('96')

  await page.getByTestId('entity-component-patrol-add').click()

  const levelTwo = path.join(editorTestProjectPath(), 'scenes', 'level-02.json')
  const own = (): unknown => {
    const level = JSON.parse(fs.readFileSync(levelTwo, 'utf8')) as {
      entities: Array<{ name: string; components: Record<string, unknown> }>
    }
    return level.entities.find((one) => one.name === 'Tilted slime')?.components['patrol']
  }
  // The prefab's values, not the description's 24/0/0 — and the nested art too.
  await expect.poll(own).toEqual(inherited)
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveValue('12')
  // And it is a copy: tuning it leaves the prefab exactly as it was.
  await type(page, 'entity-component-patrol-unitsPerSecond', '30')
  await expect.poll(() => (own() as { unitsPerSecond?: unknown })?.unitsPerSecond).toBe(30)
  expect(JSON.parse(fs.readFileSync(prefabFile, 'utf8')).components.patrol).toEqual(inherited)
})

// --- acceptance: the same fields on a prefab -------------------------------

/**
 * The other direction: a speed typed on the prefab reaches every instance that
 * has not been given its own. The assertion is the prefab file changing and the
 * level file not — the same shape as changing a prefab's picture — plus the
 * instance's panel reading the new number as inherited.
 */
test('a described component on a prefab is edited there, and every instance follows without the level changing', async ({
  page,
}) => {
  const prefabFile = path.join(editorTestProjectPath(), 'prefabs', 'enemy-slime.json')
  const prefab = JSON.parse(fs.readFileSync(prefabFile, 'utf8')) as { components: Record<string, unknown> }
  prefab.components['patrol'] = { unitsPerSecond: 12, fromX: 96, toX: 176, squashed: { texture: { id: 'abc', path: 'a.png' } } }
  fs.writeFileSync(prefabFile, `${JSON.stringify(prefab, null, 2)}\n`)
  const levelTwo = path.join(editorTestProjectPath(), 'scenes', 'level-02.json')
  const levelBefore = fs.readFileSync(levelTwo, 'utf8')

  await selectAsset(page, 'scenes/level-02.json')
  await selectAsset(page, 'prefabs/enemy-slime.json')
  await expect(page.getByTestId('inspector-document-format')).toHaveText('Prefab')
  await expect(page.getByTestId('prefab-component-patrol-unitsPerSecond')).toHaveValue('12', {
    timeout: WITHIN_A_SECOND + 2_000,
  })
  // No longer named as a component with no controls: it has some.
  await expect(page.getByTestId('prefab-unknown-components')).toHaveCount(0)

  await typeInto(page, 'prefab-component-patrol-unitsPerSecond', '30')

  await expect
    .poll(() => (JSON.parse(fs.readFileSync(prefabFile, 'utf8')) as { components: Record<string, unknown> }).components['patrol'])
    .toEqual({ unitsPerSecond: 30, fromX: 96, toX: 176, squashed: { texture: { id: 'abc', path: 'a.png' } } })
  expect(fs.readFileSync(levelTwo, 'utf8')).toBe(levelBefore)

  // And an instance reads the new number as the prefab's, still following it.
  await page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: 'Tilted slime' }).first().click()
  await expect(page.getByTestId('entity-component-patrol-inherited')).toBeVisible()
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveText('30')

  // One Ctrl-Z takes the prefab's change back, everywhere.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveText('12')
})

test('Add on a prefab gives it the described defaults, and every instance inherits them', async ({ page }) => {
  await selectAsset(page, 'scenes/level-02.json')
  await selectAsset(page, 'prefabs/enemy-slime.json')
  await expect(page.getByTestId('prefab-component-patrol-add')).toBeVisible()

  await page.getByTestId('prefab-component-patrol-add').click()

  const prefabFile = path.join(editorTestProjectPath(), 'prefabs', 'enemy-slime.json')
  await expect
    .poll(() => (JSON.parse(fs.readFileSync(prefabFile, 'utf8')) as { components: Record<string, unknown> }).components['patrol'])
    .toEqual({ unitsPerSecond: 24, fromX: 0, toX: 0 })
  await expect(page.getByTestId('prefab-component-patrol-shared')).toBeVisible()

  await page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: 'Tilted slime' }).first().click()
  await expect(page.getByTestId('entity-component-patrol-inherited')).toBeVisible()
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveText('24')
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

test('a value the field cannot show is shown as the file has it, with no control, and left alone', async ({
  page,
}) => {
  const level = JSON.parse(fs.readFileSync(levelFile(), 'utf8')) as {
    entities: Array<{ name: string; components: Record<string, Record<string, unknown>> }>
  }
  const slime = level.entities.find((one) => one.name === 'Slime')
  if (slime !== undefined) slime.components['patrol'] = { ...slime.components['patrol'], unitsPerSecond: 'fast' }
  fs.writeFileSync(levelFile(), `${JSON.stringify(level, null, 2)}\n`)

  await selectEntity(page, 'Slime')

  // The file's own word, read-only — not the description's default in a box
  // that would write over it.
  await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveText('fast')
  await expect(page.getByTestId('entity-component-patrol-mismatch')).toContainText('Speed')
  // The neighbours are still controls, and using one leaves the odd value alone.
  await type(page, 'entity-component-patrol-fromX', '150')
  await expect.poll(() => patrolInFile('Slime')?.['fromX']).toBe(150)
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

// =============================================================================
// Every field kind, on a described door — text, tick, list, file, level, and a
// kind this editor does not know. The description is the fixture in
// `tests/fixtures/door-description.ts`, written into the test project's
// `components/` for each test and taken away again after (the sample project
// itself has no door, because it has no system reading one).
// =============================================================================

const DOOR = DOOR_DESCRIPTION.type
const HEART = 'assets/textures/ui/icon-heart.png'
const LEVEL_TWO = 'scenes/level-02.json'

test.describe('a component that cannot be added by hand', () => {
  /**
   * `addable: false`, against the sample's own patrol.
   *
   * The problem it answers is not hypothetical: describing two components in the
   * platformer put "Add walker" and "Add turtle" on all 249 entities of its
   * level, clouds and coin counters included, every button offering to write a
   * component no system would read. A description can say what a component
   * holds and cannot say what it belongs on, because nothing in a level marks an
   * entity as an enemy — being one *is* carrying the component the button
   * offers.
   *
   * So the rule these tests pin is narrow on purpose: the section disappears
   * only where the entity has no claim on it. Carrying one, or inheriting one
   * from a prefab, still shows everything it ever showed — and a component that
   * is in the file where it has no business is shown too, because hiding what a
   * level really holds is the one thing the panel may never do.
   */
  function unaddablePatrol(): ComponentDescription {
    const described = JSON.parse(fs.readFileSync(descriptionFile(), 'utf8')) as ComponentDescription
    return { ...described, addable: false }
  }

  /**
   * The rewritten description reaches the editor through the folder listing a
   * moment later, so every test waits for it to have landed before doing
   * anything. Without the wait it arrives *during* a test — and a re-render
   * halfway through a run of keystrokes swallows the rest of them, which reads
   * as a product bug and is not one.
   */
  test.beforeEach(async ({ page }) => {
    fs.writeFileSync(descriptionFile(), serializeComponentDescription(unaddablePatrol()))
    await selectEntity(page, 'Knight')
    await expect(page.getByTestId('entity-component-patrol-add')).toHaveCount(0, {
      timeout: WITHIN_A_SECOND + 2_000,
    })
  })

  test('is not offered to an entity that is not one, section and all', async ({ page }) => {
    await selectEntity(page, 'Knight')
    expect(patrolInFile('Knight')).toBeNull()

    await expect(page.getByTestId('entity-component-patrol-add')).toHaveCount(0)
    // Not a disabled button and not a sentence about an absence: no section.
    await expect(page.getByTestId('inspector-panel')).not.toContainText('Patrol')
    // And it is not reported as a component with no controls either — the
    // Knight simply has nothing to do with a patrol.
    await expect(page.getByTestId('entity-unknown-components')).toHaveCount(0)
  })

  test('is still fully shown, and removable, on an entity that carries one', async ({ page }) => {
    await selectEntity(page, 'Slime')

    await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveValue('24')
    await expect(page.getByTestId('entity-component-patrol-remove')).toBeVisible()

    // Still writable: this key governs adding, not editing.
    await type(page, 'entity-component-patrol-unitsPerSecond', '48')
    await expect.poll(() => patrolInFile('Slime')?.['unitsPerSecond']).toBe(48)
  })

  test('is shown even where it has no business being, because the file has it', async ({ page }) => {
    const level = JSON.parse(fs.readFileSync(levelFile(), 'utf8')) as {
      entities: Array<{ name: string; components: Record<string, unknown> }>
    }
    const ground = level.entities.find((one) => one.name === 'Ground')
    if (ground !== undefined) ground.components['patrol'] = { unitsPerSecond: 5, fromX: 0, toX: 9 }
    fs.writeFileSync(levelFile(), `${JSON.stringify(level, null, 2)}\n`)

    await selectEntity(page, 'Ground')

    // A patrol on a strip of ground is a mistake, and the panel's job is to
    // show it rather than to decide it is not there.
    await expect(page.getByTestId('entity-component-patrol-unitsPerSecond')).toHaveValue('5')
    await expect(page.getByTestId('entity-component-patrol-remove')).toBeVisible()
  })

  test('goes away for good once removed, and Ctrl-Z is the way back', async ({ page }) => {
    await selectEntity(page, 'Slime')

    await page.getByTestId('entity-component-patrol-remove').click()

    await expect.poll(() => patrolInFile('Slime')).toBeNull()
    // No Add to put it back with — the whole section has gone.
    await expect(page.getByTestId('entity-component-patrol-add')).toHaveCount(0)
    await expect(page.getByTestId('inspector-panel')).not.toContainText('Patrol')

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => patrolInFile('Slime')?.['unitsPerSecond']).toBe(24)
  })

  test('is still offered to a placement inheriting one, which is how a single one is detached', async ({
    page,
  }) => {
    const prefabFile = path.join(editorTestProjectPath(), 'prefabs', 'enemy-slime.json')
    const prefab = JSON.parse(fs.readFileSync(prefabFile, 'utf8')) as {
      components: Record<string, unknown>
    }
    prefab.components['patrol'] = { unitsPerSecond: 24, fromX: 96, toX: 176 }
    fs.writeFileSync(prefabFile, `${JSON.stringify(prefab, null, 2)}\n`)

    await selectAsset(page, 'scenes/level-02.json')
    await page
      .getByTestId('outliner-panel')
      .locator('[data-entity-id]')
      .filter({ hasText: 'Tilted slime' })
      .first()
      .click()
    await expect(page.getByTestId('inspector-name')).toHaveText('Tilted slime')

    // It plainly is one of these, so the offer to give it its own stands.
    await expect(page.getByTestId('entity-component-patrol-inherited')).toBeVisible({
      timeout: WITHIN_A_SECOND + 2_000,
    })
    await expect(page.getByTestId('entity-component-patrol-add')).toBeVisible()
  })

  test('says on the description itself that it is never offered', async ({ page }) => {
    await selectAsset(page, DESCRIPTION)

    await expect(page.getByTestId('component-note')).toContainText('never offered')
  })
})

test.describe('every kind of described field', () => {
  test.beforeEach(async ({ page }) => {
    fs.writeFileSync(
      path.join(editorTestProjectPath(), ...DOOR_DESCRIPTION_PATH.split('/')),
      serializeComponentDescription(DOOR_DESCRIPTION),
    )
    await selectEntity(page, 'Knight')
    // The description arrives through the folder listing, within the second.
    await expect(page.getByTestId(`entity-component-${DOOR}-add`)).toBeVisible({ timeout: WITHIN_A_SECOND + 2_000 })
  })

  /** The door one named entity carries on disk, or null. */
  function doorInFile(name: string): Record<string, unknown> | null {
    const level = JSON.parse(fs.readFileSync(levelFile(), 'utf8')) as {
      entities: Array<{ name: string; components: Record<string, unknown> }>
    }
    const carried = level.entities.find((one) => one.name === name)?.components[DOOR]
    return typeof carried === 'object' && carried !== null ? (carried as Record<string, unknown>) : null
  }

  const control = (page: Page, key: string) => page.getByTestId(`entity-component-${DOOR}-${key}`)
  const type = (page: Page, key: string, value: string) => typeInto(page, `entity-component-${DOOR}-${key}`, value)

  test('Add writes every kind at its starting value, null for a file and a level', async ({ page }) => {
    await control(page, 'add').click()

    await expect.poll(() => doorInFile('Knight')).toEqual({
      scene: null,
      locked: false,
      sign: '',
      side: 'right',
      texture: null,
      sound: null,
      delay: 0,
    })
    // And each control is there, showing that value.
    await expect(control(page, 'scene')).toHaveValue('')
    await expect(control(page, 'locked')).not.toBeChecked()
    await expect(control(page, 'sign')).toHaveValue('')
    await expect(control(page, 'side')).toHaveValue('right')
    await expect(control(page, 'texture')).toHaveValue('')
    await expect(control(page, 'delay')).toHaveValue('0')
  })

  test('a line of text reaches the level within a second, and one Ctrl-Z takes the whole run back', async ({
    page,
  }) => {
    await control(page, 'add').click()
    await expect(control(page, 'sign')).toBeVisible()

    await type(page, 'sign', 'Exit')
    await expect.poll(() => doorInFile('Knight')?.['sign'], { timeout: WITHIN_A_SECOND + 1_000 }).toBe('Exit')

    await page.keyboard.press('ControlOrMeta+z')
    await expect(control(page, 'sign')).toHaveValue('')
    await expect.poll(() => doorInFile('Knight')?.['sign']).toBe('')
  })

  test('a tick box writes true and false, and Ctrl-Z unticks it', async ({ page }) => {
    await control(page, 'add').click()
    await control(page, 'locked').check()
    await expect.poll(() => doorInFile('Knight')?.['locked']).toBe(true)

    await page.keyboard.press('ControlOrMeta+z')
    await expect(control(page, 'locked')).not.toBeChecked()
    await expect.poll(() => doorInFile('Knight')?.['locked']).toBe(false)
  })

  test('a choice offers the described options by their labels and writes the value', async ({ page }) => {
    await control(page, 'add').click()
    await expect(control(page, 'side').locator('option')).toHaveText([
      'Left edge',
      'Right edge',
      'Top edge',
      'Bottom edge',
    ])

    await control(page, 'side').selectOption('top')
    await expect.poll(() => doorInFile('Knight')?.['side']).toBe('top')

    await page.keyboard.press('ControlOrMeta+z')
    await expect(control(page, 'side')).toHaveValue('right')
  })

  test('a file field writes the id and the path together, and Nothing puts null back', async ({ page }) => {
    await control(page, 'add').click()
    // Only textures are offered for a field restricted to them.
    await expect(control(page, 'texture').locator('option', { hasText: '.wav' })).toHaveCount(0)

    await control(page, 'texture').selectOption(HEART)
    const meta = JSON.parse(fs.readFileSync(path.join(editorTestProjectPath(), `${HEART}.meta`), 'utf8')) as {
      id: string
    }
    await expect.poll(() => doorInFile('Knight')?.['texture']).toEqual({ id: meta.id, path: HEART })

    await control(page, 'texture').selectOption('')
    await expect.poll(() => doorInFile('Knight')?.['texture']).toBeNull()

    await page.keyboard.press('ControlOrMeta+z')
    await expect(control(page, 'texture')).toHaveValue(HEART)
  })

  test('a level field writes the level’s path, and refuses a file that is not a level', async ({ page }) => {
    await control(page, 'add').click()

    await control(page, 'scene').selectOption(LEVEL_TWO)
    await expect.poll(() => doorInFile('Knight')?.['scene']).toBe(LEVEL_TWO)

    // A prefab is a document, so it is on the list — and the pick reads it and
    // says no, leaving the level as it was.
    await control(page, 'scene').selectOption('prefabs/enemy-slime.json')
    await expect(page.getByTestId(`entity-component-${DOOR}-scene-problem`)).toContainText('not a level')
    expect(doorInFile('Knight')?.['scene']).toBe(LEVEL_TWO)

    await page.keyboard.press('ControlOrMeta+z')
    await expect(control(page, 'scene')).toHaveValue('')
  })

  test('what was chosen is still there after a reload', async ({ page }) => {
    await control(page, 'add').click()
    await type(page, 'sign', 'Exit')
    await control(page, 'locked').check()
    await control(page, 'side').selectOption('top')
    await control(page, 'texture').selectOption(HEART)
    await control(page, 'scene').selectOption(LEVEL_TWO)
    await expect.poll(() => doorInFile('Knight')?.['scene']).toBe(LEVEL_TWO)
    await expect.poll(() => doorInFile('Knight')?.['texture']).toEqual(expect.objectContaining({ path: HEART }))

    await page.reload()
    await expect(page.getByTestId('assets-panel')).toBeVisible()
    await selectEntity(page, 'Knight')

    await expect(control(page, 'sign')).toHaveValue('Exit')
    await expect(control(page, 'locked')).toBeChecked()
    await expect(control(page, 'side')).toHaveValue('top')
    await expect(control(page, 'texture')).toHaveValue(HEART)
    await expect(control(page, 'scene')).toHaveValue(LEVEL_TWO)
  })

  test('a field of a kind this editor does not know is shown and cannot be edited', async ({ page }) => {
    await control(page, 'add').click()
    // Nothing was written for it — the editor cannot say what a colour starts as.
    await expect.poll(() => doorInFile('Knight')).not.toHaveProperty('tint')

    await expect(page.getByTestId(`entity-component-${DOOR}-tint-uneditable`)).toContainText('cannot edit')
    await expect(control(page, 'tint')).toHaveText('—')
    // And the description's own panel says the same about the kind.
    await selectAsset(page, DOOR_DESCRIPTION_PATH)
    await expect(page.getByTestId('component-field-tint')).toContainText('does not know')
    await expect(page.getByTestId('component-field-side')).toContainText('Left edge / Right edge')
  })

  test('a value of the wrong kind is shown as the file has it, not editable, and never rewritten', async ({
    page,
  }) => {
    const level = JSON.parse(fs.readFileSync(levelFile(), 'utf8')) as {
      entities: Array<{ name: string; components: Record<string, unknown> }>
    }
    const knight = level.entities.find((one) => one.name === 'Knight')
    if (knight !== undefined) {
      knight.components[DOOR] = {
        scene: null,
        locked: 'yes',
        sign: 'Exit',
        side: 'middle',
        texture: null,
        sound: null,
        delay: 0,
      }
    }
    fs.writeFileSync(levelFile(), `${JSON.stringify(level, null, 2)}\n`)

    await selectEntity(page, 'Knight')
    await expect(control(page, 'locked')).toHaveText('yes')
    await expect(control(page, 'side')).toHaveText('middle')
    await expect(page.getByTestId(`entity-component-${DOOR}-mismatch`)).toContainText('Locked and Side')
    // The good fields beside them are still controls.
    await expect(control(page, 'sign')).toHaveValue('Exit')

    // Editing a neighbour writes the level and leaves the odd values exactly as they were.
    await type(page, 'sign', 'Way out')
    await expect.poll(() => doorInFile('Knight')?.['sign']).toBe('Way out')
    expect(doorInFile('Knight')?.['locked']).toBe('yes')
    expect(doorInFile('Knight')?.['side']).toBe('middle')
  })

  test('renaming a picked file follows it into the door, id untouched', async ({ page }) => {
    await control(page, 'add').click()
    await control(page, 'texture').selectOption(HEART)
    await expect.poll(() => doorInFile('Knight')?.['texture']).toEqual(expect.objectContaining({ path: HEART }))
    const before = doorInFile('Knight')?.['texture'] as { id: string; path: string }

    await openFileMenu(page, HEART)
    await page.getByTestId('move-file-name').fill('icon-life.png')
    await page.getByTestId('move-file-apply').click()

    const renamed = 'assets/textures/ui/icon-life.png'
    await expect.poll(() => doorInFile('Knight')?.['texture']).toEqual({ id: before.id, path: renamed })
  })

  test('a picture of every kind of field', async ({ page }, testInfo) => {
    await control(page, 'add').click()
    await control(page, 'remove').scrollIntoViewIfNeeded()
    await expect(control(page, 'scene')).toBeVisible()
    await page.getByTestId('inspector-panel').screenshot({ path: testInfo.outputPath('component-fields-kinds.png') })
  })
})
