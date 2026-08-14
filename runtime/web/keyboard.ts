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
 * Three deliberate choices:
 *
 *   - **Repeats are skipped.** A held key autorepeats at the OS's whim, and
 *     `pressed` means *pressed* — one press, one entry, however long the key
 *     stays down. Holding is not a thing input carries yet (`input.ts`).
 *   - **Typing is not playing.** A key that goes down while something editable
 *     has focus belongs to the text being typed — in the editor, play mode
 *     shares a window with panels that take text — so it is neither buffered
 *     nor interfered with.
 *   - **Space is claimed.** It is the one game key whose default does real
 *     damage in a page: it scrolls, and it re-activates whatever button was
 *     focused — in the editor that is the Stop button the human just clicked
 *     to start playing. Claimed only when it was buffered, so typing keeps its
 *     spacebar.
 */

export interface KeyCollector {
  /** The codes pressed since last asked. Asking forgets them. */
  drain: () => string[]
  /** Stops listening. Safe to call twice. */
  stop: () => void
}

export function collectKeys(target: Window): KeyCollector {
  let buffered: string[] = []

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return
    if (isTyping(event.target)) return

    buffered.push(event.code)
    if (event.code === 'Space') event.preventDefault()
  }

  target.addEventListener('keydown', onKeyDown)

  return {
    drain: () => {
      const pressed = buffered
      buffered = []
      return pressed
    },
    stop: () => {
      target.removeEventListener('keydown', onKeyDown)
    },
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
}
