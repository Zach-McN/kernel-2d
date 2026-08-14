import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'

import { EDITOR_TEST_PROJECT_NAME } from './test-project.js'

/**
 * Getting around the icon view: the mouse's two side buttons, and the edge
 * between the halves of the split.
 *
 * The trail is the interesting half, and the test that says whether it is a
 * trail at all is "going somewhere new after stepping back" — an implementation
 * that walks to the parent instead of stepping back passes the first two tests
 * in this file and fails that one.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

// --- the side buttons ------------------------------------------------------

test.describe('the mouse’s back and forward buttons', () => {
  test('step out of a folder, and back into it', async ({ page }) => {
    await iconView(page)
    await tile(page, 'assets').dblclick()
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets'])

    await press(page, 'back')
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME])
    await expect(tile(page, 'assets')).toBeVisible()

    await press(page, 'forward')
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets'])
    await expect(tile(page, 'assets/textures')).toBeVisible()
  })

  test('walk three deep, then step all the way out and all the way back in', async ({ page }) => {
    await iconView(page)
    await tile(page, 'assets').dblclick()
    await tile(page, 'assets/textures').dblclick()
    await tile(page, 'assets/textures/characters').dblclick()

    for (const where of [['assets', 'textures'], ['assets'], []]) {
      await press(page, 'back')
      await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, ...where])
    }

    for (const where of [['assets'], ['assets', 'textures'], ['assets', 'textures', 'characters']]) {
      await press(page, 'forward')
      await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, ...where])
    }
  })

  /**
   * The one that says this is a trail rather than a walk up the path.
   *
   * Three deep, then out to `assets` in one press of the breadcrumb. Back from
   * there has to land where the human actually was — three deep — and not on
   * the top of the project, which is merely the folder `assets` lives in.
   */
  test('back goes where you were, not to the folder above', async ({ page }) => {
    await iconView(page)
    await tile(page, 'assets').dblclick()
    await tile(page, 'assets/textures').dblclick()
    await tile(page, 'assets/textures/characters').dblclick()

    await page.locator('[data-crumb-path="assets"]').click()
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets'])

    await press(page, 'back')

    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets', 'textures', 'characters'])
  })

  test('going somewhere new after stepping back drops what was ahead', async ({ page }) => {
    await iconView(page)
    await tile(page, 'assets').dblclick()
    await tile(page, 'assets/audio').dblclick()

    await press(page, 'back')
    // A different way on from here, so `assets/audio` is no longer ahead of us.
    await tile(page, 'assets/fonts').dblclick()
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets', 'fonts'])

    await press(page, 'forward')

    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets', 'fonts'])
  })

  test('back at the top of the project does nothing at all', async ({ page }) => {
    await iconView(page)
    await press(page, 'back')
    await press(page, 'back')

    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME])
    await expect(tile(page, 'assets')).toBeVisible()
  })

  test('the tree follows, so the split view never disagrees with itself', async ({ page }) => {
    await splitView(page)
    await row(page, 'assets').click()
    await row(page, 'assets/textures').click()
    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets', 'textures'])

    await press(page, 'back')

    await expect(crumbs(page)).toHaveText([EDITOR_TEST_PROJECT_NAME, 'assets'])
    await expect(row(page, 'assets/textures')).toBeVisible()
  })

  test('the browser is never allowed to navigate away from the editor', async ({ page }) => {
    await iconView(page)
    await tile(page, 'assets').dblclick()

    await press(page, 'back')
    await press(page, 'back')
    await press(page, 'forward')
    await press(page, 'forward')

    // Still the editor, and still the same one: a page that had navigated would
    // have lost the view the human chose along with everything else.
    await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', 'icons')
  })
})

// --- the split -------------------------------------------------------------

test.describe('the edge between the halves of the split view', () => {
  test('is only there when both halves are', async ({ page }) => {
    await iconView(page)
    await expect(page.getByTestId('assets-split-handle')).toBeHidden()

    await chooseView(page, 'split')
    await expect(page.getByTestId('assets-split-handle')).toBeVisible()
  })

  test('drags to make the tree narrower and the tiles wider', async ({ page }) => {
    await splitView(page)
    const before = await widths(page)

    await dragHandle(page, -80)

    const after = await widths(page)
    expect(after.tree).toBeLessThan(before.tree - 40)
    expect(after.grid).toBeGreaterThan(before.grid + 40)
  })

  test('drags the other way too', async ({ page }) => {
    await splitView(page)
    const before = await widths(page)

    await dragHandle(page, 80)

    expect((await widths(page)).tree).toBeGreaterThan(before.tree + 40)
  })

  test('cannot be dragged so far that a pane is lost', async ({ page }) => {
    await splitView(page)

    await dragHandle(page, -4000)

    const squashed = await widths(page)
    expect(squashed.tree).toBeGreaterThan(20)
    // And it is still there to take hold of again.
    await expect(page.getByTestId('assets-split-handle')).toBeVisible()

    await dragHandle(page, 4000)
    expect((await widths(page)).grid).toBeGreaterThan(20)
  })

  test('double-clicking puts it back', async ({ page }) => {
    await splitView(page)
    const before = await widths(page)

    await dragHandle(page, -100)
    expect((await widths(page)).tree).toBeLessThan(before.tree)

    await page.getByTestId('assets-split-handle').dblclick()

    expect((await widths(page)).tree).toBeCloseTo(before.tree, 0)
  })

  test('the size survives dragging the panel somewhere else', async ({ page }) => {
    await splitView(page)
    await dragHandle(page, -80)
    const narrowed = await widths(page)

    // Onto the Viewport's tab, which is a group of much the same width. A
    // narrower corner would floor the tree at its minimum and the proportion
    // would change for a reason that has nothing to do with what was
    // remembered. Off-centre because the middle of a tab is a dead line
    // (`editor-ui` UG11).
    await page
      .getByRole('tab', { name: 'Assets', exact: true })
      .dragTo(page.getByRole('tab', { name: 'Viewport', exact: true }), {
        targetPosition: { x: 20, y: 12 },
      })

    const moved = await widths(page)
    expect(moved.tree / (moved.tree + moved.grid)).toBeCloseTo(
      narrowed.tree / (narrowed.tree + narrowed.grid),
      1,
    )
  })

  test('leaves a picture of a narrowed tree behind', async ({ page }, testInfo) => {
    await splitView(page)
    await tile(page, 'assets').dblclick()
    await dragHandle(page, -70)
    await page.screenshot({ path: testInfo.outputPath('assets-split-resized.png') })
  })
})

// --- driving ---------------------------------------------------------------

async function chooseView(page: Page, view: 'list' | 'icons' | 'split'): Promise<void> {
  await page.getByTestId('assets-settings').click()
  await page.getByTestId(`assets-view-${view}`).click()
  await expect(page.getByTestId('assets-panel')).toHaveAttribute('data-view', view)
}

async function iconView(page: Page): Promise<void> {
  await chooseView(page, 'icons')
  await expect(page.getByTestId('assets-grid')).toBeVisible()
}

async function splitView(page: Page): Promise<void> {
  await chooseView(page, 'split')
  await expect(page.getByTestId('assets-grid')).toBeVisible()
}

/**
 * A side button, pressed over the tiles — the surface the gesture belongs to.
 *
 * Dispatched through the debugging protocol rather than through Playwright's
 * mouse, which knows only the three buttons a mouse is guaranteed to have. This
 * is the real button as the browser reports it, arriving as a real `mousedown`
 * with `button: 3` — a synthetic `MouseEvent` from inside the page would prove
 * only that the handler is wired up, and would say nothing about whether the
 * browser had already taken the press for its own history.
 */
async function press(page: Page, button: 'back' | 'forward'): Promise<void> {
  const box = await page.getByTestId('assets-icons').boundingBox()
  expect(box).not.toBeNull()
  const at = {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) - 12,
  }

  const input = await session(page)
  // 8 is the back button's bit in the held-buttons mask, 16 is forward's.
  const held = button === 'back' ? 8 : 16
  await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'none', buttons: 0 })
  await input.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...at,
    button,
    buttons: held,
    clickCount: 1,
  })
  await input.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...at,
    button,
    buttons: 0,
    clickCount: 1,
  })
}

/** One protocol session per page, because opening one per press is a round trip. */
const sessions = new WeakMap<Page, Promise<CDPSession>>()

function session(page: Page): Promise<CDPSession> {
  const existing = sessions.get(page)
  if (existing !== undefined) return existing

  const opened = page.context().newCDPSession(page)
  sessions.set(page, opened)
  return opened
}

async function dragHandle(page: Page, by: number): Promise<void> {
  const handle = page.getByTestId('assets-split-handle')
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const middle = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 }

  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down()
  await page.mouse.move(middle.x + by, middle.y, { steps: 8 })
  await page.mouse.up()
  await expect(handle).toHaveAttribute('data-dragging', 'false')
}

async function widths(page: Page): Promise<{ tree: number; grid: number }> {
  const tree = await page.getByTestId('assets-list').boundingBox()
  const grid = await page.getByTestId('assets-icons').boundingBox()
  expect(tree).not.toBeNull()
  expect(grid).not.toBeNull()
  return { tree: tree?.width ?? 0, grid: grid?.width ?? 0 }
}

function tile(page: Page, assetPath: string): Locator {
  return page.getByTestId('assets-icons').locator(`[data-asset-path="${assetPath}"]`)
}

function row(page: Page, assetPath: string): Locator {
  return page.getByTestId('assets-list').locator(`[data-asset-path="${assetPath}"]`)
}

function crumbs(page: Page): Locator {
  return page.getByTestId('assets-breadcrumb').locator('.breadcrumb__crumb')
}
