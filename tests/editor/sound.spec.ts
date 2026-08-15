import { expect, test, type Locator, type Page } from '@playwright/test'

import { selectAsset } from './select-asset.js'

/**
 * The game's own sound effects: a system asks for notes, the browser plays
 * them, and nothing is ever fetched.
 *
 * The sample project's patrolling slime chirps each time it starts its walk
 * again (`scripts/sample/content.ts`), which makes this the whole seam end to
 * end — a game's code, the runner's hand-over, and Chromium's audio context —
 * asserted off `data-play-sound`, which the viewport reads back from that
 * context's own clock (`phaser4-runtime` P4) rather than echoing the ask. A
 * cue that was refused, or one nobody scheduled, cannot make this attribute
 * say `playing`.
 */

const LEVEL_ONE = 'scenes/level-01.json'

/** The slime's lap: 96 units at 24 a second, so a chirp lands every four. */
const LAP_MS = 4_000

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('assets-panel')).toBeVisible()
})

test('editing is silent, and a running level is heard', async ({ page }) => {
  await selectAsset(page, LEVEL_ONE)
  await expect(viewport(page)).toHaveAttribute('data-scene-showing', LEVEL_ONE)

  // Nothing is running, so there is nothing to say — the same way the music
  // attribute is empty while the human is editing.
  await expect(viewport(page)).toHaveAttribute('data-play-sound', '')

  const start = page.getByTestId('play-start')
  await expect(start).toBeEnabled({ timeout: 10_000 })
  await start.click()

  // Nothing has asked for a sound yet: a game that has not chirped is silent
  // rather than broken.
  await expect(viewport(page)).toHaveAttribute('data-play-sound', 'silent')

  // The click that started the run is the browser's gesture, so the context is
  // already unlocked and the first chirp is really scheduled and really heard.
  //
  // Watched from inside the page rather than through `expect.poll`, and that is
  // not a style choice: a chirp *sounds* for about a third of a second once
  // every four, and a poll whose interval backs off past that length walks
  // straight over the window it is looking for. Anything reading back a state
  // that comes and goes needs a watcher faster than the state is short.
  await waitForSound(page, 'playing', LAP_MS + 6_000)

  // And it goes quiet again by itself, because `playing` is the audio clock
  // being behind the last scheduled note rather than a flag anybody set.
  await waitForSound(page, 'silent', LAP_MS)

  await page.getByTestId('play-stop').click()
  await expect(viewport(page)).toHaveAttribute('data-play-sound', '')
})

const viewport = (page: Page): Locator => page.getByTestId('viewport-panel')

/** Waits for the viewport to be reading back this sound state, checked every frame. */
async function waitForSound(page: Page, state: string, timeout: number): Promise<void> {
  await page.waitForFunction(
    (wanted) => {
      // `globalThis` rather than `document`, because this spec is compiled by
      // the Node half of the repo, which has no DOM globals (`editor-ui` U4).
      const host = globalThis as unknown as {
        document: { querySelector: (selector: string) => { getAttribute: (name: string) => string | null } | null }
      }
      return host.document.querySelector('[data-testid="viewport-panel"]')?.getAttribute('data-play-sound') === wanted
    },
    state,
    { timeout, polling: 'raf' },
  )
}
