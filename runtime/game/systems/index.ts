import type { System } from '../system.js'
import { spinSystem } from './spin.js'

/**
 * The systems a level runs with when nobody has said otherwise.
 *
 * One list, read by the editor's play mode and by a shipped game, so "what runs
 * when I press Play" and "what runs in the folder I hand somebody" cannot become
 * two answers. It is an argument to `runLevel` rather than a global the runner
 * reaches for, which is what keeps a test able to run a level with no systems at
 * all — the assertion that nothing moves unless something moves it.
 *
 * **It has one entry and that is the honest state of things.** A game's own
 * systems will arrive from the game's own folder, and until the machinery for
 * that exists this is the whole of what the kernel can run. Growing this list to
 * look more finished would be building genre features with no genre to justify
 * them (`genre-spinup` S1).
 */
export const BUILT_IN_SYSTEMS: readonly System[] = [spinSystem]

export { spinSystem }
