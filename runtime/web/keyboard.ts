/**
 * The keyboard, collected for a running level.
 *
 * The DOM half of `game/input.ts`: listens while a level runs, buffers what
 * went down, and hands the buffer to `runLevel`'s `input` option through
 * `drain`. It lives in `web/` because it touches the DOM and `game/` may not —
 * the runner and every system stay testable in plain Node, and the two hosts
 * that have a keyboard (the editor's play mode, an exported game's page) wire
 * this same collector so a key means the same thing in both.
 *
 * Four deliberate choices:
 *
 *   - **Repeats are skipped.** A held key autorepeats at the OS's whim, and
 *     `pressed` means *pressed* — one press, one entry, however long the key
 *     stays down. Holding is carried separately, as state: `held` answers
 *     which codes are down right now, kept by pairing every keydown with its
 *     keyup.
 *   - **Typing is not playing.** A key that goes down while something editable
 *     has focus belongs to the text being typed — in the editor, play mode
 *     shares a window with panels that take text — so it is neither buffered
 *     nor interfered with.
 *   - **Space and the arrows are claimed.** They are the game keys whose
 *     defaults do real damage in a page: Space scrolls and re-activates
 *     whatever button was focused — in the editor that is the Stop button the
 *     human just clicked — and the arrows scroll too, on *every autorepeat*,
 *     which is why the claim happens before the repeat check. Claimed only
 *     when they were collected, so typing keeps its keys.
 *   - **Losing the window empties the hands.** A keyup that fires while the
 *     window is unfocused never arrives, so without this a player who
 *     alt-tabs mid-sprint comes back to a character still running with
 *     nothing pressed.
 */

export interface KeyCollector {
  /** The codes pressed since last asked. Asking forgets them. */
  drain: () => string[]
  /** The codes down at this moment. Asking changes nothing. */
  held: () => string[]
  /** Stops listening. Safe to call twice. */
  stop: () => void
}

const CLAIMED = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

export function collectKeys(target: Window): KeyCollector {
  let buffered: string[] = []
  const down = new Set<string>()

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTyping(event.target)) return

    if (CLAIMED.has(event.code)) event.preventDefault()
    if (event.repeat) return

    buffered.push(event.code)
    down.add(event.code)
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    down.delete(event.code)
  }

  const onBlur = (): void => {
    down.clear()
  }

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', onBlur)

  return {
    drain: () => {
      const pressed = buffered
      buffered = []
      return pressed
    },
    held: () => [...down],
    stop: () => {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('keyup', onKeyUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
}
