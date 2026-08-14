/**
 * The shape of the module `scripts/game-code.ts` generates.
 *
 * It has no file on disk, so this is the only place a typechecker can learn what
 * importing it gives you. Kept beside the shipped page that imports it rather
 * than in a global `env.d.ts` — the editor's `running-level.ts` imports it too,
 * but the module exists so a shipped game can load a project's systems, and
 * reading it next to that consumer is worth more than tidiness.
 */
declare module 'virtual:game-systems' {
  import type { System } from '../game/system'

  /**
   * The project's systems as they were when the page loaded. What a shipped game
   * uses: a folder somebody was handed cannot change underneath itself.
   */
  export const systems: readonly System[]

  /**
   * The project's systems as they are *now* — the same list in a built game, and
   * the freshly edited one in the editor, where pressing Play re-reads the game's
   * code. Called at the moment a level starts rather than captured at import,
   * which is the whole of how an edit reaches the next Play without a reload.
   */
  export function currentSystems(): readonly System[]
}
