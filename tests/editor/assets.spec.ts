import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { editorTestProjectPath } from './test-project.js'

/**
 * The Assets panel against the real sample project, served by the real sidecar.
 * Files are written straight onto disk mid-test, because "I save a PNG and it
 * appears" is the behaviour, and anything that stubs the filesystem stops
 * testing it.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test.describe('the Assets panel', () => {
  test('mirrors the top of the project folder', async ({ page }) => {
    for (const name of ['assets', 'data', 'prefabs', 'scenes', 'project.json']) {
      await expect(row(page, name)).toBeVisible()
    }
  })

  test('opens folders down to the files inside them', async ({ page }) => {
    await expect(row(page, 'assets/textures')).toBeHidden()

    await row(page, 'assets').click()
    await row(page, 'assets/textures').click()
    await row(page, 'assets/textures/characters').click()

    await expect(row(page, 'assets/textures/characters/knight-idle.png')).toBeVisible()
  })

  test('shows the whole folder, sidecars included, rather than a tidied version of it', async ({
    page,
  }) => {
    await openTexturesFolder(page)

    await expect(row(page, 'assets/textures/characters/knight-idle.png.meta')).toBeVisible()
  })

  test('shows how big each file is', async ({ page }) => {
    await openTexturesFolder(page)

    await expect(row(page, 'assets/textures/characters/knight-idle.png')).toContainText(/\d+ B/)
  })

  test('folders come before files, the way a file explorer shows them', async ({ page }) => {
    const names = await page.locator('.assets__tree > .asset-row > .asset-row__button').allInnerTexts()
    const kinds = await page
      .locator('.assets__tree > .asset-row > .asset-row__button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-kind')))

    expect(names.length).toBeGreaterThan(1)
    expect(kinds.indexOf('file')).toBeGreaterThan(kinds.lastIndexOf('directory'))
  })

  test('selecting a file marks it as selected', async ({ page }) => {
    const scene = row(page, 'scenes')
    await scene.click()

    const level = row(page, 'scenes/level-01.json')
    await level.click()

    await expect(level).toHaveAttribute('data-selected', 'true')
    await expect(scene).toHaveAttribute('data-selected', 'false')
  })

  test('a file saved on disk appears within a second, and leaves when it is deleted', async ({
    page,
  }) => {
    await openTexturesFolder(page)

    const newFile = path.join(editorTestProjectPath(), 'assets', 'textures', 'ui', 'icon-star.png')
    const added = row(page, 'assets/textures/ui/icon-star.png')

    await row(page, 'assets/textures/ui').click()
    await expect(added).toBeHidden()

    fs.writeFileSync(newFile, 'pretend-png-bytes')
    await expect(added).toBeVisible({ timeout: 1000 })

    fs.rmSync(newFile)
    await expect(added).toBeHidden({ timeout: 1000 })
  })

  test('leaves a picture of itself behind', async ({ page }, testInfo) => {
    await openTexturesFolder(page)
    await page.screenshot({ path: testInfo.outputPath('assets-panel.png') })
  })
})

/** Rows are addressed by their project-relative path, which is unique. */
function row(page: Page, assetPath: string) {
  return page.locator(`[data-asset-path="${assetPath}"]`)
}

async function openTexturesFolder(page: Page): Promise<void> {
  await row(page, 'assets').click()
  await row(page, 'assets/textures').click()
  await row(page, 'assets/textures/characters').click()
  await expect(row(page, 'assets/textures/characters/knight-idle.png')).toBeVisible()
}
