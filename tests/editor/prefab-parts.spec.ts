import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { outlinerRow, outlinerRows, viewport } from './scene-view.js'
import { openNewDocument, selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * A prefab that carries parts (editor-kernel D25 amended, D37): built through
 * the editor's own Inspector, placed as one entity, drawn as a group, tuned per
 * placement.
 *
 * Two assertions are the feature. **The level holds one entity** for a
 * placement whose picture is two sprites — the parts are never written. And
 * **changing a part in the prefab moves it in every placement while the level
 * file's bytes and timestamp do not change**, which is the same promise a
 * prefab's picture already keeps, now about a group.
 */

const LEVEL_TWO = 'scenes/level-02.json'
const SLIME = 'assets/textures/characters/slime.png'
const KNIGHT = 'assets/textures/characters/knight-idle.png'
const PREFAB = 'prefabs/lantern.json'
const SETTLES = 3_000

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

// --- reading -----------------------------------------------------------------

function fileFor(projectRelative: string): string {
  return path.join(editorTestProjectPath(), projectRelative.replaceAll('/', path.sep))
}

function fingerprint(projectRelative: string): { text: string; modifiedAt: number } {
  const file = fileFor(projectRelative)
  return { text: fs.readFileSync(file, 'utf8'), modifiedAt: fs.statSync(file).mtimeMs }
}

interface PrefabFile {
  children?: { id: string; transform: { x: number; y: number }; components: Record<string, unknown> }[]
}

interface SceneFile {
  entities: { id: string; name: string; components: Record<string, unknown> }[]
}

function prefabOnDisk(): PrefabFile {
  return JSON.parse(fs.readFileSync(fileFor(PREFAB), 'utf8')) as PrefabFile
}

function sceneOnDisk(): SceneFile {
  return JSON.parse(fs.readFileSync(fileFor(LEVEL_TWO), 'utf8')) as SceneFile
}

async function drawn(page: Page): Promise<number> {
  return Number(await viewport(page).getAttribute('data-scene-drawn'))
}

/** Where each drawn thing is, by id, in level units (V17). */
async function drawnUnits(page: Page): Promise<Map<string, { x: number; y: number }>> {
  const units = JSON.parse((await viewport(page).getAttribute('data-scene-units')) ?? '[]') as Array<{
    id: string
    x: number
    y: number
  }>
  return new Map(units.map((one) => [one.id, { x: one.x, y: one.y }]))
}

// --- driving -------------------------------------------------------------------

async function openScene(page: Page, scenePath: string): Promise<void> {
  await selectAsset(page, scenePath)
  await expect(page.getByTestId('outliner-panel')).toHaveAttribute('data-scene', scenePath)
  await expect(page.getByTestId('play-start')).toBeEnabled()
}

/** A prefab with a picture and one part 16 units to the right, made entirely through the Inspector. */
async function makeLantern(page: Page): Promise<string> {
  await page.locator('[data-asset-path="prefabs"]').click()
  await openNewDocument(page)
  const field = page.getByTestId('new-document-name')
  await field.click()
  await field.fill('lantern')
  await expect(page.getByTestId('new-prefab-create')).toBeEnabled()
  await page.getByTestId('new-prefab-create').click()
  await expect.poll(() => fs.existsSync(fileFor(PREFAB)), { timeout: SETTLES }).toBe(true)

  await page.getByTestId('prefab-texture-control').selectOption(SLIME)
  await page.getByTestId('prefab-part-add').click()
  const part = page.locator('[data-part-id]').first()
  await expect(part).toBeVisible()
  const partId = (await part.getAttribute('data-part-id')) ?? ''
  await page.getByTestId(`prefab-part-${partId}-texture`).selectOption(KNIGHT)
  await page.getByTestId(`prefab-part-${partId}-x`).fill('16')
  await page.getByTestId(`prefab-part-${partId}-x`).blur()
  await page.getByTestId(`prefab-part-${partId}-spin`).fill('90')
  await page.getByTestId(`prefab-part-${partId}-spin`).blur()
  await expect.poll(() => prefabOnDisk().children?.[0]?.transform.x, { timeout: SETTLES }).toBe(16)
  return partId
}

// --- the feature -----------------------------------------------------------------

test('a prefab gains a part in its Inspector, and the file says so once', async ({ page }, testInfo) => {
  const partId = await makeLantern(page)

  const saved = prefabOnDisk()
  expect(saved.children).toHaveLength(1)
  expect(saved.children?.[0]?.id).toBe(partId)
  expect(saved.children?.[0]?.components['spin']).toEqual({ degreesPerSecond: 90 })
  await page.getByTestId('inspector-panel').screenshot({ path: testInfo.outputPath('prefab-parts.png') })
})

test('placing it puts one entity in the level and two sprites in the picture, and Ctrl-Z takes both', async ({
  page,
}) => {
  await openScene(page, LEVEL_TWO)
  const before = await drawn(page)
  const entitiesBefore = sceneOnDisk().entities.length
  await makeLantern(page)

  await page.getByTestId('prefab-place').click()
  await expect.poll(() => drawn(page)).toBe(before + 2)
  await expect.poll(() => sceneOnDisk().entities.length, { timeout: SETTLES }).toBe(entitiesBefore + 1)
  expect(Object.keys(sceneOnDisk().entities.at(-1)?.components ?? {})).toEqual(['prefab'])

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => drawn(page)).toBe(before)
})

test('changing a part in the prefab moves it in the placed group, and the level file is untouched', async ({
  page,
}, testInfo) => {
  await openScene(page, LEVEL_TWO)
  const partId = await makeLantern(page)
  await page.getByTestId('prefab-place').click()
  const placement = await page.getByTestId('outliner-panel').getAttribute('data-scene')
  expect(placement).toBe(LEVEL_TWO)
  await expect.poll(() => sceneOnDisk().entities.some((one) => one.name === 'lantern'), { timeout: SETTLES }).toBe(
    true,
  )
  const placedId = sceneOnDisk().entities.find((one) => one.name === 'lantern')?.id ?? ''
  const partDrawnId = `${placedId}:${partId}`
  await expect.poll(async () => (await drawnUnits(page)).get(partDrawnId)?.x).toBeDefined()
  const rootBefore = (await drawnUnits(page)).get(placedId)
  const partBefore = (await drawnUnits(page)).get(partDrawnId)
  expect(partBefore?.x).toBe((rootBefore?.x ?? 0) + 16)
  await viewport(page).screenshot({ path: testInfo.outputPath('placed-group.png') })

  const level = fingerprint(LEVEL_TWO)
  await selectAsset(page, PREFAB)
  await page.getByTestId(`prefab-part-${partId}-x`).fill('32')
  await page.getByTestId(`prefab-part-${partId}-x`).blur()

  await expect.poll(async () => (await drawnUnits(page)).get(partDrawnId)?.x).toBe((rootBefore?.x ?? 0) + 32)
  await expect.poll(() => prefabOnDisk().children?.[0]?.transform.x, { timeout: SETTLES }).toBe(32)
  expect(fingerprint(LEVEL_TWO)).toEqual(level)
})

test('clicking a part selects the placement, and the whole group is outlined', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  await makeLantern(page)
  await page.getByTestId('prefab-place').click()
  await expect.poll(() => sceneOnDisk().entities.some((one) => one.name === 'lantern'), { timeout: SETTLES }).toBe(
    true,
  )
  const placedId = sceneOnDisk().entities.find((one) => one.name === 'lantern')?.id ?? ''
  await expect(viewport(page)).toHaveAttribute('data-scene-selected', placedId)
  await expect(page.getByTestId('scene-selected-bounds')).toHaveCount(2)

  // The second outline is the part's. Remember where it is, let the selection
  // go by clicking empty space, then click the part itself.
  const partBox = await page.getByTestId('scene-selected-bounds').first().boundingBox()
  expect(partBox).not.toBeNull()
  await page.getByTestId('viewport-stage').click({ position: { x: 5, y: 5 } })
  await expect(viewport(page)).toHaveAttribute('data-scene-selected', '')
  await page.mouse.click((partBox?.x ?? 0) + (partBox?.width ?? 0) / 2, (partBox?.y ?? 0) + (partBox?.height ?? 0) / 2)
  await expect(viewport(page)).toHaveAttribute('data-scene-selected', placedId)
})

test('a placement gives a part its own spin, written on the placement alone, and Play agrees', async ({
  page,
}) => {
  await openScene(page, LEVEL_TWO)
  const partId = await makeLantern(page)
  await page.getByTestId('prefab-place').click()
  await expect.poll(() => sceneOnDisk().entities.some((one) => one.name === 'lantern'), { timeout: SETTLES }).toBe(
    true,
  )
  const prefab = fingerprint(PREFAB)

  await outlinerRow(page, 'lantern').click()
  await expect(page.getByTestId(`entity-part-${partId}-spin-inherited`)).toContainText('90')
  await page.getByTestId(`entity-part-${partId}-spin`).fill('180')
  await page.getByTestId(`entity-part-${partId}-spin`).blur()
  await expect(page.getByTestId(`entity-part-${partId}-spin-own`)).toBeVisible()

  await expect
    .poll(() => {
      const placed = sceneOnDisk().entities.find((one) => one.name === 'lantern')
      const reference = placed?.components['prefab'] as { parts?: Record<string, Record<string, unknown>> } | undefined
      return reference?.parts?.[partId]?.['spin']
    }, { timeout: SETTLES })
    .toEqual({ degreesPerSecond: 180 })
  expect(fingerprint(PREFAB)).toEqual(prefab)
  const overriding = sceneOnDisk().entities.filter((one) => {
    const reference = one.components['prefab']
    return typeof reference === 'object' && reference !== null && 'parts' in reference
  })
  expect(overriding).toHaveLength(1)

  await page.getByTestId('play-start').click()
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'running')
  await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')
  await page.getByTestId('play-stop').click()
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'stopped')

  await page.getByTestId(`entity-part-${partId}-spin-reset`).click()
  await expect(page.getByTestId(`entity-part-${partId}-spin-inherited`)).toBeVisible()
  await expect
    .poll(
      () => {
        const reference = sceneOnDisk().entities.find((one) => one.name === 'lantern')?.components['prefab']
        return typeof reference === 'object' && reference !== null && 'parts' in reference
      },
      { timeout: SETTLES },
    )
    .toBe(false)
})

test('the placement is one row in the Outliner, and duplicating it copies the whole group', async ({ page }) => {
  await openScene(page, LEVEL_TWO)
  const entitiesBefore = sceneOnDisk().entities.length
  await makeLantern(page)
  await page.getByTestId('prefab-place').click()
  // One row per entity in the file: the part has none.
  await expect(outlinerRows(page)).toHaveCount(entitiesBefore + 1)
  await expect.poll(() => sceneOnDisk().entities.length, { timeout: SETTLES }).toBe(entitiesBefore + 1)
  const before = await drawn(page)

  await outlinerRow(page, 'lantern').click()
  await page.getByTestId('entity-duplicate').click()
  await expect(outlinerRows(page)).toHaveCount(entitiesBefore + 2)
  await expect.poll(() => drawn(page)).toBe(before + 2)
})
