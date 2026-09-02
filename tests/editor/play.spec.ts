import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { showPanel } from './panels.js'
import { editableFiles, restoreProjectAfterEach } from './restore-project.js'
import { selectAsset } from './select-asset.js'
import { editorTestProjectPath } from './test-project.js'

/**
 * Pressing Play and watching a level run from the file.
 *
 * Every acceptance criterion of this feature, in the units it was written in
 * (`editor-verification` V1). Nothing here compares a pixel: the renderer
 * reports what it drew and the editor compares the running picture with the one
 * it was showing a moment before, so "it looks the same" is an attribute on the
 * panel rather than a screenshot (V17).
 *
 * The load-bearing assertion in most of these is `data-play-match="same"`. It is
 * worth knowing what it means before trusting it: the editor resolved the level
 * one way, the runtime opened the file and resolved it another, both were drawn
 * by the same renderer through the same camera, and every entity landed in the
 * same place at the same size. A divergence between the two halves has nowhere
 * to hide in that.
 *
 * **It is now a statement about one frame**, and every assertion of it in this
 * file means "the level *started* where the file says". A running level moves —
 * level one's health icon turns — so the two pictures diverge on purpose a
 * sixtieth of a second later, and a check that kept comparing them would report
 * the game working as a fault. The three attributes that keep the pair honest
 * are `data-scene-units` (the frame it started on), `data-play-units` (where it
 * has got to) and `data-play-steps` (how many fixed steps that took).
 */

const LEVEL_ONE = 'scenes/level-01.json'
const LEVEL_TWO = 'scenes/level-02.json'
const SLIME_PREFAB = 'prefabs/enemy-slime.json'
const HEART = 'assets/textures/ui/icon-heart.png'

restoreProjectAfterEach()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
  await expect(page.getByTestId('viewport-stage').locator('canvas')).toBeVisible()
})

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')
const row = (page: Page, name: string): Locator =>
  page.getByTestId('outliner-panel').locator('[data-entity-id]').filter({ hasText: name }).first()

async function openScene(page: Page, scenePath: string): Promise<void> {
  await selectAsset(page, scenePath)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', scenePath)
  // The Play button is offered only once every prefab and texture has settled,
  // which is also the moment the picture is worth comparing against.
  await expect(page.getByTestId('play-start')).toBeEnabled()
}

async function play(page: Page): Promise<void> {
  await page.getByTestId('play-start').click()
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'running')
}

async function stop(page: Page): Promise<void> {
  await page.getByTestId('play-stop').click()
  await expect(viewport(page)).toHaveAttribute('data-play-state', 'stopped')
}

/** Waits until the running level has taken at least this many fixed steps. */
async function stepsPast(page: Page, steps: number): Promise<void> {
  await expect
    .poll(async () => Number(await viewport(page).getAttribute('data-play-steps')))
    .toBeGreaterThanOrEqual(steps)
}

function projectFile(relative: string): string {
  return path.join(editorTestProjectPath(), relative.replaceAll('/', path.sep))
}

/**
 * Every file the editor could write, and what is in it right now — the bytes
 * *and* the modification time (`editor-verification` V12).
 *
 * The timestamp is not belt and braces. A write of identical bytes leaves the
 * contents equal and the time moved, and "the editor rewrote my level with the
 * same contents" is still the editor writing to a file it promised not to touch —
 * it churns git, and it is the shape a bug here would most likely take.
 */
function snapshotProject(): Map<string, string> {
  return new Map(
    editableFiles().map((file) => [file, `${fs.statSync(file).mtimeMs} ${fs.readFileSync(file, 'utf8')}`]),
  )
}

async function typeInto(page: Page, testId: string, text: string): Promise<void> {
  const field = page.getByTestId(testId)
  await field.click()
  await field.press('ControlOrMeta+a')
  await field.pressSequentially(text, { delay: 20 })
}

async function camera(page: Page): Promise<{ scale: string | null; x: string | null; y: string | null }> {
  const panel = viewport(page)
  return {
    scale: await panel.getAttribute('data-scene-scale'),
    x: await panel.getAttribute('data-scene-focus-x'),
    y: await panel.getAttribute('data-scene-focus-y'),
  }
}

// --- acceptance 1 and 2: it runs, and it matches ---------------------------

test.describe('pressing Play', () => {
  test('runs the open level, drawn by the runtime reading the file', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    const drawnWhileEditing = await viewport(page).getAttribute('data-scene-drawn')

    await play(page)

    await expect(viewport(page)).toHaveAttribute('data-play-scene', LEVEL_ONE)
    // Criterion 2. The runtime found the same five sprites, cut the same frames
    // out of the sprite sheet among them, and put every one of them exactly
    // where the editor had it.
    await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')
    await expect(viewport(page)).toHaveAttribute('data-play-problems', '0')
    await expect(viewport(page)).toHaveAttribute('data-scene-drawn', drawnWhileEditing ?? '')
    await expect(page.getByTestId('play-comparison')).toContainText('exactly as the editing view')
  })

  test('says the same thing about the start long after the level has moved on', async ({ page }) => {
    // The one that would have gone red if the comparison had been left comparing
    // a running level with a standing-still one. Two seconds of simulated time
    // is a hundred and twenty steps and half a turn of the health icon.
    await openScene(page, LEVEL_ONE)
    await play(page)
    await stepsPast(page, 120)

    await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')
    await expect(page.getByTestId('play-comparison')).toContainText('Started exactly')
  })

  test('draws a prefab instance from the prefab it points at', async ({ page }) => {
    // Criterion 3, and the sharper half of it: the level names only a reference,
    // so a runtime that did not follow it would draw two fewer things — which is
    // what the comparison would report.
    await openScene(page, LEVEL_TWO)
    await play(page)

    await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')
    await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '4')
  })

  test('honours a pivot changed a moment earlier, without the editor being involved', async ({ page }) => {
    // Criterion 3's other half. The pivot lives in the texture's `.meta`, and
    // the runtime has to read that file for itself — so moving the pivot and
    // then playing is the test: if play still matches, the runtime read the
    // changed settings; if it drew on the old pivot, the comparison says the
    // heart sits on a different pivot.
    await openScene(page, LEVEL_ONE)
    await selectAsset(page, HEART)
    await typeInto(page, 'pivot-y-control', '1')

    await showPanel(page, 'Viewport')
    await expect(page.getByTestId('play-start')).toBeEnabled()
    await play(page)

    await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')
  })
})

// --- time passes -----------------------------------------------------------

test.describe('a level that is running', () => {
  test('moves, while the frame it started on stays where it was', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await play(page)
    await stepsPast(page, 1)

    // Two pictures of one level, and the whole point of publishing both: this
    // one is the frame the comparison above is about.
    const started = await viewport(page).getAttribute('data-scene-units')
    const firstMoved = await viewport(page).getAttribute('data-play-units')
    expect(firstMoved).not.toBe('')

    // It carries on turning. Read by polling rather than after a sleep, because
    // what is being waited for is a change and not a duration (V5).
    await expect
      .poll(async () => viewport(page).getAttribute('data-play-units'))
      .not.toBe(firstMoved)

    await expect(viewport(page)).toHaveAttribute('data-scene-units', started ?? '')
  })

  test('moves exactly the two entities the level asked to move, and nothing else', async ({ page }) => {
    /*
     * The sharp version of "something moves", and it is now sharp about two
     * different things at once.
     *
     * The health icon turns, read by the engine's own `spin`. The slime walks,
     * read by a system in the **project's** `src/systems/` from a component the
     * engine has never heard of. Three sprites carry neither and must not move.
     *
     * So this is where the seam that loads a game's code is proved end to end: a
     * runner that moved everything, or nothing, or only the icon — which is what
     * a project's code failing to compile in would look like — each fail here.
     */
    await openScene(page, LEVEL_ONE)
    await play(page)
    // A quarter turn at 90°/s and a quarter of the slime's walk. Well past any
    // tolerance for both.
    await stepsPast(page, 60)

    const started = boundsById(await viewport(page).getAttribute('data-scene-units'))
    const now = boundsById(await viewport(page).getAttribute('data-play-units'))

    const moved = [...now.keys()].filter((id) => started.get(id) !== now.get(id))
    expect(moved).toHaveLength(2)

    // And they are the two the Outliner names, identified by the ids that moved
    // rather than by position — the picture cannot tell you *why* something moved,
    // so the assertion has to be about which entity it was.
    await stop(page)
    const movedIds = new Set(moved)

    await row(page, 'Health icon').click()
    const icon = await page.getByTestId('entity-id').textContent()
    await row(page, 'Slime').click()
    const slime = await page.getByTestId('entity-id').textContent()

    expect(movedIds).toEqual(new Set([icon, slime]))
  })

  test('runs the project’s own system, and stops when the project stops asking for it', async ({ page }) => {
    /*
     * The decision this feature turns on: **pressing Play re-reads the game's
     * code.** Editing a system hot-replaces the module the editor reads its list
     * from, so Stop and Play is enough — the open level, the selection and the
     * camera all survive, and nothing reloads.
     *
     * Proved by taking the behaviour away rather than adding one: a slime that
     * stops walking cannot be a stale picture, a caching accident or a coincidence
     * of timing. Only the icon is left turning.
     *
     * The file is put back by hand. The shared restore covers what the *editor*
     * can write — `.json` and `.meta` — and a source file is neither
     * (`editor-verification` V14).
     */
    const systemFile = projectFile('src/systems/patrol.ts')
    const original = fs.readFileSync(systemFile, 'utf8')

    try {
      await openScene(page, LEVEL_ONE)
      await play(page)
      await stepsPast(page, 60)
      expect(movedCount(await pictures(page))).toBe(2)
      await stop(page)

      // The same system, asked to move nothing.
      const before = await viewport(page).getAttribute('data-game-code-version')
      fs.writeFileSync(systemFile, original.replace('entity.transform.x +=', 'entity.transform.x += 0 *'))

      /*
       * Waited for as a fact, not guessed at with runs. What is being waited on
       * is the dev server noticing the file and hot-replacing the module — a
       * duration nobody should hard-code, and on a loaded machine one that beat
       * the poll of whole Play/Stop cycles this used to be (W26: "expected 1,
       * received 2", which read as the feature being broken). The editor now
       * announces the replacement, so this waits on that with a ceiling that is
       * only about how slow a dev server can be, and then runs the level once.
       */
      await expect(viewport(page)).not.toHaveAttribute('data-game-code-version', before ?? '', {
        timeout: 30_000,
      })

      await play(page)
      await stepsPast(page, 60)
      expect(movedCount(await pictures(page))).toBe(1)
      await stop(page)

      // Nothing reloaded on the way: the level is still open and still the one
      // that was open, which is the half of this decision a human notices.
      await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
    } finally {
      fs.writeFileSync(systemFile, original)
    }
  })

  test('stands perfectly still while you are editing', async ({ page }) => {
    /*
     * The negative half, anchored on a positive event rather than on a sleep
     * (`editor-verification` V6). A level is played first purely to find out how
     * many steps this machine gets through in a given stretch — so the stretch
     * the editing view is then watched over is known to be long enough for
     * motion to have shown up if there were any.
     */
    await openScene(page, LEVEL_ONE)
    await play(page)
    await stepsPast(page, 60)
    await stop(page)

    await expect(viewport(page)).toHaveAttribute('data-play-units', '')
    await expect(viewport(page)).toHaveAttribute('data-play-steps', '')

    const editing = await viewport(page).getAttribute('data-scene-units')
    // The same wall-clock stretch that produced sixty steps a moment ago.
    await page.waitForTimeout(1000)

    expect(await viewport(page).getAttribute('data-scene-units')).toBe(editing)
  })
})

/** Each entity's drawn rectangle, keyed by id, out of one of the units attributes. */
function boundsById(units: string | null): Map<string, string> {
  const drawn = JSON.parse(units ?? '[]') as Array<{ id: string; bounds: unknown }>
  return new Map(drawn.map((entity) => [entity.id, JSON.stringify(entity.bounds)]))
}

interface Pictures {
  /** The frame the level started on. */
  started: Map<string, string>
  /** Where it has got to since. */
  now: Map<string, string>
}

async function pictures(page: Page): Promise<Pictures> {
  return {
    started: boundsById(await viewport(page).getAttribute('data-scene-units')),
    now: boundsById(await viewport(page).getAttribute('data-play-units')),
  }
}

/** How many entities are somewhere other than where they started. */
function movedCount(pair: Pictures): number {
  return [...pair.now.keys()].filter((id) => pair.started.get(id) !== pair.now.get(id)).length
}

// --- acceptance 4: Stop puts me back ---------------------------------------

test.describe('pressing Stop', () => {
  test('leaves the level, the selection and the view exactly as they were', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    await row(page, 'Knight').click()
    // Moved off the framing default, so "the camera came back" is a claim about
    // a value somebody chose rather than about a default being recomputed. Read
    // after the zoom has landed: a press and the attribute it changes are a
    // render apart, and capturing in between compares against the value the
    // human just moved off.
    const framed = await viewport(page).getAttribute('data-scene-scale')
    await page.getByTestId('scene-zoom-in').click()
    await expect(viewport(page)).not.toHaveAttribute('data-scene-scale', framed ?? '')

    const before = await camera(page)
    const editing = await viewport(page).getAttribute('data-scene-units')

    await play(page)
    // Stopped from a level that has genuinely moved, which is the only version
    // of this test worth running now: stopping a level that never moved cannot
    // tell you whether anything was put back.
    await stepsPast(page, 60)
    await stop(page)

    await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)
    await expect(page.getByTestId('inspector-panel')).toHaveAttribute('data-inspecting-entity', /.+/)
    await expect(row(page, 'Knight')).toHaveAttribute('data-selected', 'true')
    expect(await camera(page)).toEqual(before)
    // Every sprite back at the angle the file has it, because the level that was
    // turning was a copy and the copy has been dropped.
    await expect(viewport(page)).toHaveAttribute('data-scene-units', editing ?? '')
  })

  test('puts the turning entity back at the angle the file gives it', async ({ page }) => {
    // The same claim read off the Inspector rather than off the picture: the
    // number a human would look at, which never moved because the document
    // never moved.
    await openScene(page, LEVEL_ONE)
    await row(page, 'Health icon').click()
    await expect(page.getByTestId('entity-rotation-control')).toHaveValue('0')

    await play(page)
    await stepsPast(page, 60)
    await stop(page)

    await expect(page.getByTestId('entity-rotation-control')).toHaveValue('0')
    await expect(page.getByTestId('entity-spin-control')).toHaveValue('90')
  })

  test('cannot be driven off course by the camera, because the camera is frozen', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    const before = await camera(page)

    await play(page)
    // Every gesture is off while a level runs: the two pictures are only
    // comparable through one camera, and Stop is only free if nothing moved.
    await page.getByTestId('viewport-stage').click({ position: { x: 200, y: 120 } })
    await page.mouse.wheel(0, -240)
    await page.keyboard.press('Home')

    expect(await camera(page)).toEqual(before)
    await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')

    await stop(page)
    expect(await camera(page)).toEqual(before)
  })
})

// --- acceptance 5: a change made a moment before ---------------------------

test('runs the change made a moment earlier, with no save in between', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await row(page, 'Health icon').click()

  await typeInto(page, 'entity-x-control', '44')

  // Straight to Play. There is no save button and the autosave delay has not
  // elapsed, so this only works because Play finishes the write before it reads.
  await play(page)

  await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')
  // And the file really is what ran: this is the whole difference between
  // playing from disk and playing from the editor's copy.
  expect(fs.readFileSync(projectFile(LEVEL_ONE), 'utf8')).toContain('"x": 44')
})

// --- acceptance 6: it says why -------------------------------------------

test.describe('a level the runtime cannot fully load', () => {
  test('names a prefab that is gone, and runs the rest of the level', async ({ page }) => {
    await openScene(page, LEVEL_TWO)
    fs.rmSync(projectFile(SLIME_PREFAB))
    // Wait for the editor to notice, so Play is not racing the folder.
    await expect(viewport(page).getByTestId('viewport-problem').first()).toContainText('enemy-slime.json')

    await play(page)

    await expect(viewport(page).getByTestId('play-problem').first()).toContainText(
      'enemy-slime.json is not in the project folder',
    )
    // The level still runs. The two slimes draw nothing and the floor and the
    // button are still there, which is more useful than an empty picture.
    await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '2')
  })

  test('names import settings somebody broke in a text editor', async ({ page }) => {
    await openScene(page, LEVEL_ONE)
    fs.writeFileSync(projectFile(`${HEART}.meta`), '{ "format": "kernel2d.asset-meta", "version": 1 }\n')
    await expect(viewport(page).getByTestId('viewport-problem').first()).toContainText('icon-heart.png')

    await play(page)

    await expect(viewport(page).getByTestId('play-problem').first()).toContainText('icon-heart.png')
    await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '4')
  })

  test('names a texture whose picture has gone', async ({ page }) => {
    await openScene(page, LEVEL_ONE)

    // Put back by hand: the shared restore only covers files the *editor* can
    // write, which is `.meta` and `.json`. A test that removes a PNG and leaves
    // it removed breaks whichever later spec happens to open a level that uses
    // it, and gets diagnosed there (`editor-verification` V14).
    const pixels = fs.readFileSync(projectFile(HEART))
    try {
      fs.rmSync(projectFile(HEART))
      await expect(viewport(page).getByTestId('viewport-problem').first()).toContainText('icon-heart.png')

      await play(page)

      await expect(viewport(page).getByTestId('play-problem').first()).toContainText('icon-heart.png')
      await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '4')
    } finally {
      fs.writeFileSync(projectFile(HEART), pixels)
    }
  })
})

// --- acceptance 7 and 8: nothing is written -------------------------------

test('writes nothing at all while a level is running', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await row(page, 'Knight').click()
  const before = snapshotProject()

  await play(page)
  /*
   * Run until the level has genuinely moved before pressing anything.
   *
   * This is what the test is for now. A running level mutates entities sixty
   * times a second, and the only thing standing between that and somebody's file
   * is that the entities being mutated are a copy — so the version of this test
   * that plays a level which never moves is testing the *editor's* controls and
   * nothing about the runner. Level one's health icon turns, so by here a
   * hundred and twenty transforms have been written to something.
   */
  await stepsPast(page, 120)

  // Every way the editor has of changing a level is out of reach — `inert` is
  // what the human sees, and the transaction API refusing is what makes it true
  // whichever control anybody finds. Forced, because an ordinary click would
  // simply time out on an inert button and prove nothing.
  await page.getByTestId('entity-add').click({ force: true })
  await page.getByTestId('entity-delete').click({ force: true })
  await page.keyboard.press('ControlOrMeta+z')

  await stop(page)

  // Long enough for a debounced save to have fired, had anything scheduled one.
  await page.waitForTimeout(500)

  // Criterion 7 and criterion 8 together: not the level, not a `.meta`, and
  // nothing anywhere recording that this happened.
  expect(snapshotProject()).toEqual(before)
  // The level is also still the length it was, so the Add really did nothing
  // rather than being added and written back later.
  await expect(page.getByTestId('outliner-panel').locator('[data-entity-id]')).toHaveCount(5)
})

// --- the pictures ---------------------------------------------------------

test('a picture of a level running, and of the editor it came back to', async ({ page }) => {
  // Level one rather than level two, because a picture of a level running is
  // only worth looking at if the level is doing something: the health icon is
  // caught part-way through a turn here, and the second picture is it back at
  // the angle the file gives it.
  await openScene(page, LEVEL_ONE)
  await play(page)
  await expect(page.getByTestId('play-comparison')).toBeVisible()
  await stepsPast(page, 30)
  await page.screenshot({ path: 'test-results/play-running.png', fullPage: false })

  await stop(page)
  await page.screenshot({ path: 'test-results/play-stopped.png', fullPage: false })
})

// --- acceptance 9: one level after another --------------------------------

test('shows only the second level when a second level is played', async ({ page }) => {
  await openScene(page, LEVEL_ONE)
  await play(page)
  await stop(page)

  await openScene(page, LEVEL_TWO)
  await play(page)

  // Level one has five entities and level two has four, none of them shared, so
  // a picture carrying anything over would draw more than this. What removes the
  // first level's sprites is the entity layer matching by id and destroying what
  // is not in the new list — the same path opening a second level in the editor
  // already takes.
  await expect(viewport(page)).toHaveAttribute('data-play-scene', LEVEL_TWO)
  await expect(viewport(page)).toHaveAttribute('data-scene-drawn', '4')
  await expect(viewport(page)).toHaveAttribute('data-play-match', 'same')
})
