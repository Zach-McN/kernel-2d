import { startGame, type GameHandle } from './start-game'

/**
 * The page's wiring, and nothing else.
 *
 * Separated from `start-game.ts` so that the game is a function anybody can call
 * with a host element — a genre layer wanting to boot it inside something of its
 * own, a test, a later desktop shell — and the page is the two lines that call it.
 * Everything interesting is next door.
 */

declare global {
  interface Window {
    /**
     * What this game drew, published so it can be asked from outside: by a test
     * comparing an exported folder against the editor, and by anybody with a
     * browser's console open wondering what a folder they were sent is doing.
     *
     * The only global this page defines, and it is read-only.
     */
    kernel2d?: GameHandle
  }
}

const host = document.getElementById('game')

if (host === null) {
  // Only reachable if the page and this file have been edited apart, which is
  // worth a sentence rather than a stack trace: the two ship together.
  document.body.textContent = 'This page has no game element in it, so there is nothing to start.'
} else {
  void startGame(host).then((game) => {
    window.kernel2d = game
  })
}
