import { useEffect, useState } from 'react'

import { gameCodeVersion } from 'virtual:game-systems'

/**
 * Which version of the game's code this page holds, kept current across hot
 * replacements.
 *
 * The virtual module counts its own evaluations and announces each one on the
 * window (`scripts/game-code.ts`); this listens, and re-reads the count. Reading
 * through the getter rather than holding a number is what makes it right after
 * a replacement: the getter this module imported before the edit still reads
 * the holder Vite preserved across it, so the answer is the new count even
 * though the binding is the old one — the same trick `currentSystems()` plays.
 *
 * The viewport publishes it as `data-game-code-version`, so "the dev server has
 * picked up my edit" is a fact that can be read and waited for, from outside,
 * rather than found out by pressing Play.
 */

export const GAME_CODE_CHANGED_EVENT = 'kernel2d:game-code'

export function useGameCodeVersion(): number {
  const [version, setVersion] = useState(() => gameCodeVersion())

  useEffect(() => {
    const changed = (): void => {
      setVersion(gameCodeVersion())
    }
    window.addEventListener(GAME_CODE_CHANGED_EVENT, changed)
    return () => {
      window.removeEventListener(GAME_CODE_CHANGED_EVENT, changed)
    }
  }, [])

  return version
}
