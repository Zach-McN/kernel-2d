import type { ReactElement } from 'react'

import { usePlacing } from '../shell/placing'

/**
 * The switch that turns every press in the picture into another copy of this
 * prefab.
 *
 * **One implementation, two doors**, the same rule that put placing itself in a
 * hook (`editor-ui` U24). The Inspector holds one thing at a time, so the mode
 * has to be reachable from the prefab *and* from an instance of it — and two
 * copies of "start placing this path" is two chances for one of them to start
 * placing something else.
 *
 * It is a toggle rather than a press, and it says which state it is in, because
 * the mode outlives the panel that switched it on: the human can select
 * something else entirely and every click in the picture is still putting road
 * tiles down. The other half of that promise is in the viewport's own caption,
 * which names what is being placed and the key that stops it.
 *
 * **Turning it on does not place anything.** The button beside it already means
 * "one, now, in the middle of the view"; a toggle that also placed one would
 * make the first copy land somewhere the human did not click, which is exactly
 * the thing they turned this on to stop doing.
 */
export function PlaceByClicking({
  prefabPath,
  canPlace,
  testId,
}: {
  prefabPath: string
  /** False when there is no level open to place into, or the prefab has gone. */
  canPlace: boolean
  testId: string
}): ReactElement {
  const placing = usePlacing()
  const on = placing.stamping === prefabPath

  return (
    <button
      type="button"
      className="control control--action"
      data-testid={testId}
      aria-pressed={on}
      // Still pressable while it is on even if placing has become impossible,
      // so a mode can always be switched off by the control that switched it on.
      disabled={!canPlace && !on}
      title={
        on
          ? 'Every click in the level puts another one down. Esc stops it.'
          : 'Put one down wherever you click, over and over, without coming back here'
      }
      onClick={() => {
        if (on) placing.stopStamping()
        else placing.startStamping(prefabPath)
      }}
    >
      {on ? 'Stop placing' : 'Place by clicking'}
    </button>
  )
}
