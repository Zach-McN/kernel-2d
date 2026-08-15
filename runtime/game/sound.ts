import type { Entity } from '../formats/scene-schema.js'

/**
 * A game asking to be heard.
 *
 * A system's whole world is the entity list (`system.ts`), and making a noise
 * is one of the things that world cannot contain: the audio context, the
 * browser's autoplay lock and the speaker all belong to the host — the
 * editor's play mode, or an exported page. So the ask crosses the seam the way
 * the door and the camera do (`door.ts`, `camera.ts`), **as data on an
 * entity**: a system that wants a sound calls `playSound` with a recipe, the
 * runner takes the queue at the end of the frame and hands it to the host,
 * which synthesizes it. The first real consumer is the platformer's seven
 * effects, every one of them a few notes on an oscillator.
 *
 * **The ask is a recipe, not a file and not a name.** Three answers were
 * possible and only this one is genre-neutral:
 *
 *   - *a file* — the level would have to carry an audio asset per effect, and
 *     the game whose spec says "all synthesized, no audio files" could not be
 *     built at all;
 *   - *a name* (`'jump'`, `'coin'`) — the kernel would have to know what a jump
 *     sounds like, which is a game's business and nobody else's;
 *   - *a recipe* — the kernel learns what a **note** is, and a game says which
 *     notes. What a jump sounds like stays in the game's own code, and the
 *     kernel gains no vocabulary it would have to grow per genre.
 *
 * A note is the smallest thing an oscillator and a gain envelope can be asked
 * for: a frequency that ramps from one value to another over a duration, on a
 * wave, at a volume, optionally starting a moment after the cue does. That is
 * the whole vocabulary — no filters, no loops, no panning, no sample playback.
 * A level's *music* is a file and stays a file (`scene-schema.ts`'s `music`,
 * played by the scene view); this is for the noises a rule makes.
 *
 * **Muting is not here, deliberately.** Whether the game is muted is a fact
 * about the game — it survives, or does not survive, exactly as much as the
 * game's other facts do (`story.ts`) — and a host that could be muted would be
 * a second answer to the same question, disagreeing with the first the moment
 * a level was reloaded. A muted game raises no cue; the host plays what it is
 * told and holds no opinion.
 *
 * **The queue is a queue because a single step can make several noises.** A
 * ninja that lands on the last walker while the shell it kicked shatters a
 * brick has three cues in one step, and a slot that held one would silently
 * play the last. Unlike the door — which is taken and removed, because a run
 * is leaving — the carrier stays and is emptied, since the next step will
 * almost certainly want it again.
 *
 * A run whose host takes no sound leaves the cues standing (up to
 * `MAX_STANDING_CUES`, so a long headless run does not grow a list forever),
 * which is how a game's own tests assert "stomping a walker plays the stomp"
 * with no audio context, no browser and no speaker anywhere near them.
 */

export const SOUND_ENTITY_ID = 'run#sound'

/** The oscillator shapes Web Audio offers by name. Anything else is not a wave. */
export type SoundWave = 'sine' | 'square' | 'sawtooth' | 'triangle'

/** One note: a frequency sweep on a wave, fading to silence over its duration. */
export interface SoundNote {
  /** Hz at the start. */
  from: number
  /** Hz at the end — the same as `from` for a flat note. */
  to: number
  /** How long the note sounds, in seconds. */
  seconds: number
  wave: SoundWave
  /** Peak gain, 0 to 1, decaying to silence across the duration. */
  volume: number
  /** Seconds after the cue begins, for the notes of a chord or an arpeggio. Absent is none. */
  delay?: number
}

/** One sound: the notes it is made of, played together. */
export type SoundCue = readonly SoundNote[]

/**
 * How many cues may stand unheard before the oldest are dropped.
 *
 * A host takes the queue every frame it draws, so in a played game this is
 * never approached. It exists for the run with no sound handler — a test, or a
 * headless check — where nothing ever empties the list and a ten-minute run
 * would otherwise carry thirty thousand cues around with it.
 */
export const MAX_STANDING_CUES = 16

const WAVES: readonly string[] = ['sine', 'square', 'sawtooth', 'triangle']

/** Asks the host to play this cue once. Cues queue; nothing is replaced. */
export function playSound(entities: Entity[], cue: SoundCue): void {
  const notes = cue.map(plainNote)
  if (notes.length === 0) return

  const standing = entities.find((entity) => entity.id === SOUND_ENTITY_ID)
  if (standing === undefined) {
    entities.push({
      id: SOUND_ENTITY_ID,
      name: 'Sound',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { sound: { cues: [notes] } },
    })
    return
  }

  const queued = [...rawCuesOf(standing), notes]
  standing.components['sound'] = {
    cues: queued.length > MAX_STANDING_CUES ? queued.slice(-MAX_STANDING_CUES) : queued,
  }
}

/**
 * The cues waiting to be heard, oldest first — empty when nothing is asking.
 *
 * Every note is checked here rather than trusted: the carrier is an ordinary
 * entity in an ordinary list, so a fixture or a game can put anything on it,
 * and a note that cannot be played is dropped rather than thrown over. A cue
 * left with no playable note at all is dropped whole, since asking for silence
 * and asking for nothing are the same ask.
 */
export function soundIn(entities: readonly Entity[]): SoundCue[] {
  const standing = entities.find((entity) => entity.id === SOUND_ENTITY_ID)
  if (standing === undefined) return []

  const cues: SoundCue[] = []
  for (const raw of rawCuesOf(standing)) {
    const notes: SoundNote[] = []
    for (const note of raw) {
      const read = readNote(note)
      if (read !== null) notes.push(read)
    }
    if (notes.length > 0) cues.push(notes)
  }
  return cues
}

/**
 * The runner's half: reads the queue and empties it, so a cue is heard once.
 *
 * The carrier stays behind empty — the next step is very likely to want it,
 * and an entity pushed and spliced sixty times a second is churn with nothing
 * to show for it.
 */
export function takeSound(entities: Entity[]): SoundCue[] {
  const cues = soundIn(entities)
  const standing = entities.find((entity) => entity.id === SOUND_ENTITY_ID)
  if (standing !== undefined) standing.components['sound'] = { cues: [] }
  return cues
}

/** The note as JSON, so what stands on the entity is a plain document like everything else. */
function plainNote(note: SoundNote): Record<string, unknown> {
  const plain: Record<string, unknown> = {
    from: note.from,
    to: note.to,
    seconds: note.seconds,
    wave: note.wave,
    volume: note.volume,
  }
  if (note.delay !== undefined && note.delay !== 0) plain['delay'] = note.delay
  return plain
}

/** The cues on the carrier, unchecked — every reader below does its own checking. */
function rawCuesOf(carrier: Entity): unknown[][] {
  const component: unknown = carrier.components['sound']
  if (typeof component !== 'object' || component === null) return []
  const cues: unknown = (component as { cues?: unknown }).cues
  if (!Array.isArray(cues)) return []
  return cues.filter((cue): cue is unknown[] => Array.isArray(cue))
}

/** One note, or null when it is not one. */
function readNote(raw: unknown): SoundNote | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { from, to, seconds, wave, volume, delay } = raw as Record<string, unknown>

  if (!positive(from) || !positive(to)) return null
  if (!positive(seconds)) return null
  if (typeof wave !== 'string' || !WAVES.includes(wave)) return null
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0) return null

  let waits = 0
  if (delay !== undefined) {
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0) return null
    waits = delay
  }

  return {
    from,
    to,
    seconds,
    wave: wave as SoundWave,
    volume,
    ...(waits === 0 ? {} : { delay: waits }),
  }
}

/**
 * A number an oscillator can be handed.
 *
 * Zero and below are refused for frequencies as well as durations, because the
 * envelope ramps *exponentially* and an exponential ramp to zero is undefined —
 * a browser throws on it, from inside a host, on a frame that is trying to
 * draw. Refusing it here costs one comparison.
 */
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
