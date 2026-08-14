/**
 * What a game's own code may name — the surface `kernel-2d/runtime` resolves to
 * inside a game folder, for the compiler (the game's `tsconfig` paths), for the
 * bundler (`scripts/game-code.ts`), and for the game's own test runner.
 *
 * It is deliberately **the DOM-free subset** of the runtime: the vocabulary of
 * entities, what a system is, and the input a step can read. A system is an
 * ordinary function over plain objects precisely so a game's tests drive it in
 * plain Node (`system.ts`) — and the runtime's full barrel reaches the
 * renderer, which reaches Phaser, which reaches for `window` the moment it is
 * imported. Pointing games at the barrel therefore *worked in the editor and
 * failed in the game's own vitest*, which is how this file earned its
 * existence. What a game cannot import, it cannot slowly come to depend on:
 * game code that could reach the renderer would be game code that draws, and
 * the seam that keeps the editor's Play and an exported folder the same game
 * runs through systems staying blind to where their output goes.
 *
 * Everything here re-exports the runtime's own modules, so the editor (which
 * imports the barrel) and a game (which imports this) resolve any shared
 * module to the same file — one `input.ts`, not two.
 */

export {
  copyEntity,
  type AssetRef,
  type ComponentHolder,
  type Entity,
  type Transform,
} from '../formats/scene-schema.js'

export { stepSystems, type System } from './system.js'

export { BUILT_IN_SYSTEMS, spinSystem } from './systems/index.js'

export {
  INPUT_ENTITY_ID,
  NOTHING,
  clickedIn,
  inputEntity,
  pressedIn,
  writeInput,
  type InputSample,
  type ScenePoint,
} from './input.js'

export { DOOR_ENTITY_ID, doorIn, openDoor } from './door.js'

export { STORY_ENTITY_ID, factOf, factsIn, learn, sceneIn, storyEntity } from './story.js'
