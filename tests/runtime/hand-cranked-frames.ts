/**
 * A frame source a test drives by hand, standing in for the engine's ticker.
 *
 * `onFrame` is the shape the runner subscribes with; `frame` ticks every
 * subscriber once with the elapsed time the test chooses, so a suite about
 * what happens *on* a frame never waits for a real one. `subscribers` is how a
 * test proves that stopping a run let go of the ticker.
 */
export function handCrankedFrames(): {
  onFrame: (tick: (elapsedMs: number) => void) => () => void
  frame: (elapsedMs: number) => void
  subscribers: () => number
} {
  const ticks = new Set<(elapsedMs: number) => void>()

  return {
    onFrame: (tick) => {
      ticks.add(tick)
      return () => ticks.delete(tick)
    },
    frame: (elapsedMs) => {
      for (const tick of [...ticks]) tick(elapsedMs)
    },
    subscribers: () => ticks.size,
  }
}
