import type { SoundCue } from '../game/sound.js'

/**
 * A cue, turned into scheduled Web Audio nodes.
 *
 * The host's half of `runtime/game/sound.ts`: the game says which notes, this
 * says what a note *is* — an oscillator whose frequency sweeps and a gain that
 * fades it to silence, both scheduled on the context's own clock rather than
 * started and stopped by anything watching a frame. **Scheduling, not
 * playing**, is what makes a cue survive a stuttering frame: four notes 0.12 s
 * apart are four appointments made now, and the audio thread keeps them
 * whether or not the renderer manages another frame in the meantime.
 *
 * It has no Phaser import and no game import beyond the shape of a cue, so the
 * arithmetic every sound in every game depends on is tested in plain Node
 * against a stand-in context (`tests/runtime/synth.test.ts`) — the same
 * instinct that keeps `coordinates.ts` browser-free.
 */

/**
 * What an exponential fade counts as silence.
 *
 * An exponential ramp cannot reach zero — the curve is a multiplication, and
 * the browser throws when the target is 0 — so every envelope in every Web
 * Audio codebase lands on a small positive number instead. A thousandth of the
 * peak is 60 dB down, which is silence to an ear.
 */
export const SILENCE = 0.001

/**
 * The moment of oscillator kept alive past the end of the envelope.
 *
 * The reference stops each note 0.03 s after its duration rather than exactly
 * on it. Ending the oscillator at the instant the gain arrives at `SILENCE`
 * cuts a still-audible tail on the wave's own cycle, which is heard as a
 * faint click on every single sound.
 */
export const TAIL_SECONDS = 0.03

/**
 * Schedules every note of one cue, and answers when the last of them is over.
 *
 * The answer is in the context's own time base, which is what lets a caller
 * say whether anything is still sounding by comparing it against
 * `context.currentTime` — a fact read off the audio clock rather than a timer
 * of the caller's own (`phaser4-runtime` P4).
 */
export function scheduleCue(
  context: AudioContext,
  destination: AudioNode,
  cue: SoundCue,
  startAt: number,
): number {
  let endsAt = startAt

  for (const note of cue) {
    const at = startAt + (note.delay ?? 0)
    const until = at + note.seconds

    const oscillator = context.createOscillator()
    oscillator.type = note.wave
    oscillator.frequency.setValueAtTime(note.from, at)
    // A flat note is left flat rather than ramped to where it already is: an
    // exponential ramp between two equal values is a no-op in every browser
    // that gets it right and a rounding artefact in any that does not.
    if (note.to !== note.from) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(note.to, 1), until)
    }

    const envelope = context.createGain()
    envelope.gain.setValueAtTime(note.volume, at)
    envelope.gain.exponentialRampToValueAtTime(SILENCE, until)

    oscillator.connect(envelope)
    envelope.connect(destination)
    oscillator.start(at)
    oscillator.stop(until + TAIL_SECONDS)

    if (until + TAIL_SECONDS > endsAt) endsAt = until + TAIL_SECONDS
  }

  return endsAt
}
