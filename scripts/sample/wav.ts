/**
 * A minimal WAV writer — 16-bit mono PCM, which every browser and every audio
 * library reads without argument.
 *
 * The tones below are synthesised rather than sampled so the sample project
 * carries no third-party audio, and the noise is drawn from a fixed seed so
 * re-running the generator produces byte-identical files.
 */

const SAMPLE_RATE = 22_050

export interface Envelope {
  seconds: number
  /** Returns a sample in -1..1 for a moment in the sound, given 0..1 progress. */
  at: (progress: number, time: number, random: () => number) => number
}

export function encodeWav(envelope: Envelope): Buffer {
  const count = Math.floor(SAMPLE_RATE * envelope.seconds)
  const random = seededRandom(0x5eed)
  const samples = Buffer.alloc(count * 2)

  for (let index = 0; index < count; index += 1) {
    const time = index / SAMPLE_RATE
    const value = clamp(envelope.at(index / count, time, random))
    samples.writeInt16LE(Math.round(value * 32_000), index * 2)
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + samples.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // length of this format block
  header.writeUInt16LE(1, 20) // 1 means uncompressed PCM
  header.writeUInt16LE(1, 22) // one channel
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28) // bytes per second
  header.writeUInt16LE(2, 32) // bytes per sample frame
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(samples.length, 40)

  return Buffer.concat([header, samples])
}

export function sine(hertz: number, time: number): number {
  return Math.sin(2 * Math.PI * hertz * time)
}

/** Fades a sound out over its length, so nothing ends in a click. */
export function decay(progress: number, sharpness = 4): number {
  return Math.exp(-sharpness * progress)
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/** A small deterministic generator, so "noise" is the same noise every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0xffffffff
  }
}
