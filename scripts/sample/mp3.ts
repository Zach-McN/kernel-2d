/**
 * A minimal MP3 writer — silent MPEG-1 Layer III frames, assembled by hand.
 *
 * It exists so the sample project carries a *real* `.mp3` for the music picker
 * without shipping third-party audio or depending on an encoder being
 * installed. A Layer III frame whose side information is all zeros declares no
 * compressed data at all, which every decoder reads as silence; a run of such
 * frames is a valid, silent MP3 of the wanted length. Deterministic by
 * construction — every byte below is arithmetic — so re-running the generator
 * produces identical files, the same property the WAV synth keeps.
 *
 * The frame arithmetic, for whoever has to touch this next:
 *
 *   - Header `FF FB 90 C0`: sync, MPEG-1, Layer III, no CRC; 128 kbps
 *     (bitrate index 9), 44.1 kHz, no padding; mono.
 *   - Frame length is `floor(144 * bitrate / sampleRate)` bytes = 417.
 *   - Mono MPEG-1 side information is 17 bytes; zeros mean "no data".
 *   - One frame covers 1152 samples, so ~38.28 frames make a second.
 */

const SAMPLE_RATE = 44_100
const BITRATE = 128_000
const SAMPLES_PER_FRAME = 1_152
const FRAME_LENGTH = Math.floor((144 * BITRATE) / SAMPLE_RATE)

export function silentMp3(seconds: number): Buffer {
  const frames = Math.ceil((seconds * SAMPLE_RATE) / SAMPLES_PER_FRAME)
  const bytes = Buffer.alloc(frames * FRAME_LENGTH)

  for (let frame = 0; frame < frames; frame += 1) {
    const at = frame * FRAME_LENGTH
    bytes[at] = 0xff
    bytes[at + 1] = 0xfb
    bytes[at + 2] = 0x90
    bytes[at + 3] = 0xc0
    // Everything after the header — side information included — stays zero,
    // which is Layer III for "this frame holds silence".
  }

  return bytes
}
