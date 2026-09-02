import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { restoreProjectAfterEach } from './restore-project.js'
import { viewport } from './scene-view.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Drawing something faintly: the sprite's `opacity` (`editor-kernel` D34).
 *
 * The proof is read back off the renderer rather than out of the file — the
 * viewport publishes what it *drew*, and the opacity it reports comes off the
 * drawn object's own alpha (`phaser4-runtime` P4). A field that parsed
 * perfectly and reached no sprite would pass a document test and fail this one,
 * which is the whole reason this test exists next to that one.
 *
 * Written into the level by hand rather than through a control, because there
 * is no control: nothing in the editor authors an opacity yet, and the
 * platformer's fading particles are spawned while a level runs.
 */

const LEVEL_ONE = 'scenes/level-01.json'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test('a sprite given an opacity is drawn faintly, and says so', async ({ page }) => {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)

  // Nothing in the sample fades, so nothing reports an opacity at all.
  expect(drawnOpacities(await unitsOf(page))).toEqual([])

  const faded = fadeFirstEntity(0.25)

  await expect
    .poll(async () => drawnOpacities(await unitsOf(page)), { timeout: 5_000 })
    .toEqual([{ id: faded, opacity: 0.25 }])

  // The Inspector says so too, for the human who opens a level somebody else
  // faded and wonders why one sprite is see-through.
  await page.locator(`[data-entity-id="${faded}"]`).first().click()
  await expect(page.getByTestId('entity-opacity')).toContainText('0.25')
})

test('an opacity outside the range is drawn as the nearest one it can be', async ({ page }) => {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)

  // Faded first, so that "no opacity is reported" means something: at the
  // start of any level nothing reports one, and a poll for that would pass
  // before the file was even written.
  const faded = fadeFirstEntity(0.25)
  await expect
    .poll(async () => drawnOpacities(await unitsOf(page)), { timeout: 5_000 })
    .toEqual([{ id: faded, opacity: 0.25 }])

  // Now the typo. The answer is a solid sprite rather than a missing one:
  // losing the picture is a far worse response to a stray digit.
  fadeFirstEntity(4)

  await expect
    .poll(
      async () => {
        const units = await unitsOf(page)
        const drawn = units.find((one) => one.id === faded)
        // Both halves at once: nothing faint, and the sprite still drawn.
        return { faint: drawn?.opacity, drawn: drawn?.bounds !== null && drawn?.bounds !== undefined }
      },
      { timeout: 5_000 },
    )
    .toEqual({ faint: undefined, drawn: true })
})

// --- driving ---------------------------------------------------------------

interface DrawnUnit {
  id: string
  bounds: unknown
  opacity?: number
}

async function unitsOf(page: Page): Promise<DrawnUnit[]> {
  const raw = await viewport(page).getAttribute('data-scene-units')
  return JSON.parse(raw === null || raw === '' ? '[]' : raw) as DrawnUnit[]
}

function drawnOpacities(units: DrawnUnit[]): { id: string; opacity: number }[] {
  return units
    .filter((one): one is DrawnUnit & { opacity: number } => one.opacity !== undefined)
    .map((one) => ({ id: one.id, opacity: one.opacity }))
}

/** Writes an opacity into the first entity that has a sprite, and answers its id. */
function fadeFirstEntity(opacity: number): string {
  const file = path.join(editorTestProjectPath(), LEVEL_ONE.replaceAll('/', path.sep))
  const scene = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    entities: { id: string; components: Record<string, Record<string, unknown>> }[]
  }
  const target = scene.entities.find((one) => one.components['sprite'] !== undefined)
  if (target === undefined) throw new Error('the sample level has no entity with a sprite of its own')

  target.components['sprite'] = { ...target.components['sprite'], opacity }
  fs.writeFileSync(file, `${JSON.stringify(scene, null, 2)}\n`)
  return target.id
}
