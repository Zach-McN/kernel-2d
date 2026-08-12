import * as Phaser from 'phaser'

import type { TextureFilter, TextureImportSettings } from '../formats/meta-schema'
import { framesFor, type FrameRect } from './frames'

/**
 * A texture's import settings, applied to the live texture in the renderer.
 *
 * This is the only place that decides what a setting *means*. The Inspector
 * writes `filter: "nearest"` into a `.meta`; what nearest does to pixels is
 * decided here, once, for the preview and for every game that ever loads that
 * texture. A second interpretation anywhere is how a preview starts lying.
 *
 * Everything here changes the texture in place. Nothing re-uploads it, and
 * nothing re-fetches it — which is what lets a human drag a frame-size field
 * and watch the guides move, on a 4096px tileset, without the editor stuttering.
 */

/** Phaser's name for what the schema calls a filter. */
const FILTER_MODES: Readonly<Record<TextureFilter, Phaser.Textures.FilterMode>> = {
  nearest: Phaser.Textures.FilterMode.NEAREST,
  linear: Phaser.Textures.FilterMode.LINEAR,
}

/**
 * Frames are named by their index, as strings.
 *
 * Phaser 4 removed the public sprite-sheet parser that v3 exposed, so frames
 * are added by hand from `framesFor`. That is the better arrangement anyway:
 * the geometry becomes ours to define and to test without a browser, and the
 * rectangles the renderer holds are the same objects the viewport draws guides
 * from rather than a reconstruction of them.
 */
export interface AppliedSlice {
  frames: FrameRect[]
  uncoveredRight: number
  uncoveredBottom: number
}

export function applyImportSettings(
  texture: Phaser.Textures.Texture,
  settings: TextureImportSettings,
): AppliedSlice {
  applyFilter(texture, settings.filter)
  return applySlice(texture, settings)
}

export function applyFilter(texture: Phaser.Textures.Texture, filter: TextureFilter): void {
  texture.setFilter(FILTER_MODES[filter])
}

/**
 * What filtering the texture is *actually* using, read back off it.
 *
 * Deliberately not the value that was asked for. Anything reporting what the
 * preview looks like should be evidence rather than an echo — a report built
 * from the request would keep saying "linear" long after the day somebody
 * breaks the line that applies it.
 */
export function filterOf(texture: Phaser.Textures.Texture): TextureFilter {
  const source = texture.source[0]
  if (source === undefined) return 'nearest'
  return source.scaleMode === Phaser.Textures.FilterMode.LINEAR ? 'linear' : 'nearest'
}

/**
 * Cuts the texture into frames, replacing whatever frames it had.
 *
 * `__BASE` is left alone: every texture has one, it is the whole image, and it
 * is what the preview draws — so re-slicing never disturbs the picture on
 * screen, only the rectangles laid over it.
 */
function applySlice(texture: Phaser.Textures.Texture, settings: TextureImportSettings): AppliedSlice {
  const base = texture.get('__BASE')
  const sliced = framesFor(settings.slice, base.width, base.height)

  for (const name of texture.getFrameNames()) texture.remove(name)

  sliced.frames.forEach((frame, index) => {
    texture.add(String(index), 0, frame.x, frame.y, frame.width, frame.height)
  })

  return {
    frames: sliced.frames,
    uncoveredRight: sliced.uncoveredRight,
    uncoveredBottom: sliced.uncoveredBottom,
  }
}
