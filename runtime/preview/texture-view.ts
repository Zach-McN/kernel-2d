import * as Phaser from 'phaser'

import type { TextureFilter, TextureImportSettings } from '../formats/meta-schema'
import type { FrameRect } from '../textures/frames'
import { applyImportSettings, filterOf } from '../textures/import-settings'

/**
 * One texture, drawn by the real renderer, with its import settings applied.
 *
 * This is the runtime's first surface, and it is deliberately small: it boots
 * Phaser against a canvas, shows one texture at a scale it is told, and reports
 * what it drew. It knows nothing about panels, stores, selection, undo, or
 * where the editor keeps its service — the URL for an asset arrives as a
 * function, so a shipped game and the editor can each answer that question
 * their own way (editor-kernel D1).
 *
 * The instance is meant to live as long as the window does. Tearing down a
 * Phaser game and building another one per selection would look fine on a 16px
 * sprite and be the reason the viewport stutters later, when nobody remembers
 * why — and it churns WebGL contexts, which browsers hand out in limited
 * numbers.
 */

export interface TextureRequest {
  /** Project-relative, forward-slashed. */
  path: string
  /**
   * Changes whenever the file on disk does. Half the cache key: a request for
   * a path and version already loaded never touches the network, which is what
   * makes changing a setting flicker-free.
   */
  version: number
  settings: TextureImportSettings
  /** Whole-number scale, chosen by whatever is hosting this view. */
  scale: number
}

export interface ShownTexture {
  path: string
  version: number
  /** The image's own size, in its own pixels. */
  width: number
  height: number
  /**
   * Where the image was actually drawn, in CSS pixels from the canvas's
   * top-left, and the scale it was actually drawn at.
   *
   * Reported rather than left to be recalculated, because anything drawing on
   * top of this canvas has to line up with it exactly, and two pieces of code
   * deriving the same placement is two pieces of code that can disagree.
   */
  placement: { x: number; y: number; scale: number }
  /** The frames the renderer actually cut, in image pixels. */
  frames: FrameRect[]
  /** Pixels along the right and bottom edges that no frame covers. */
  uncoveredRight: number
  uncoveredBottom: number
  /** Read back off the live texture, not echoed from the request. */
  filter: TextureFilter
}

export interface TextureViewOptions {
  /** Where the bytes of an asset can be fetched from. */
  resolveAssetUrl: (path: string, version: number) => string
  /**
   * Device pixels per CSS pixel. Taken as an option so a test can pin it;
   * defaults to the window's.
   */
  pixelRatio?: number
}

export interface TextureView {
  /** Detached until something puts it in the document. */
  readonly canvas: HTMLCanvasElement
  /**
   * Both in CSS pixels. Answers with the new placement of whatever is on
   * screen, because a wider panel moves the picture and anything drawn on top
   * of it has to move with it.
   */
  resize: (width: number, height: number) => ShownTexture | null
  /**
   * Draws one texture. Resolves with what was drawn, or with `null` when a
   * later request overtook this one — a selection changed twice in the time one
   * image took to arrive, and drawing the first would put the wrong picture on
   * screen.
   */
  show: (request: TextureRequest) => Promise<ShownTexture | null>
  /**
   * Redraws what is already shown at a different scale, without fetching or
   * uploading anything. Zooming is a redraw, never a reload.
   */
  restage: (scale: number) => ShownTexture | null
  /** Draws nothing at all. */
  clear: () => void
  destroy: () => void
}

/** How many decoded images to keep, so flicking between two files is free. */
const IMAGE_CACHE_LIMIT = 8

/** The size the game boots at, before anything has measured the panel. */
const INITIAL_SIZE = { width: 320, height: 240 }

export async function createTextureView(options: TextureViewOptions): Promise<TextureView> {
  const pixelRatio = options.pixelRatio ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'

  let announceReady: (scene: PreviewScene) => void = () => {}
  const whenReady = new Promise<PreviewScene>((resolve) => {
    announceReady = resolve
  })

  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    canvas,
    // Null rather than undefined: undefined means "append me to the body", and
    // this canvas belongs to whichever panel is currently hosting it.
    parent: null,
    width: INITIAL_SIZE.width * pixelRatio,
    height: INITIAL_SIZE.height * pixelRatio,
    transparent: true,
    // The panel decides the size and tells us; nothing here should be watching
    // the window or resizing itself behind the host's back.
    scale: { mode: Phaser.Scale.NONE },
    banner: false,
    audio: { noAudio: true },
    scene: new PreviewScene((scene) => announceReady(scene)),
  })

  const scene = await whenReady

  // CSS pixels, kept alongside the drawing buffer, because placement is
  // reported in CSS pixels and the buffer is in device pixels.
  let cssWidth = INITIAL_SIZE.width
  let cssHeight = INITIAL_SIZE.height
  setCanvasStyleSize(canvas, cssWidth, cssHeight)

  const images = new Map<string, HTMLImageElement>()
  let sequence = 0
  let current: ShownTexture | null = null

  const textureKeyFor = (path: string, version: number): string => `preview:${path}@${version}`

  const redraw = (shown: ShownTexture, scale: number): ShownTexture => {
    const placement = placementFor(shown.width, shown.height, scale, cssWidth, cssHeight)
    scene.draw(textureKeyFor(shown.path, shown.version), placement, pixelRatio)
    return { ...shown, placement }
  }

  return {
    canvas,

    resize: (width, height) => {
      cssWidth = Math.max(1, Math.round(width))
      cssHeight = Math.max(1, Math.round(height))
      game.scale.resize(cssWidth * pixelRatio, cssHeight * pixelRatio)
      setCanvasStyleSize(canvas, cssWidth, cssHeight)
      if (current !== null) current = redraw(current, current.placement.scale)
      return current
    },

    restage: (scale) => {
      if (current === null) return null
      current = redraw(current, scale)
      return current
    },

    show: async (request) => {
      const mine = (sequence += 1)
      const key = textureKeyFor(request.path, request.version)

      const image = await loadImage(images, key, options.resolveAssetUrl(request.path, request.version))
      // Overtaken while the bytes were in the air. Drawing now would put the
      // file that *was* selected on screen under the name of the one that is.
      if (mine !== sequence) return null

      // Registered once per path-and-version. A texture already here is the
      // same bytes by construction, so re-adding it would be an identical
      // upload to the GPU for no reason.
      const texture = scene.textures.exists(key)
        ? scene.textures.get(key)
        : scene.textures.addImage(key, image)
      if (texture === null) return null

      const applied = applyImportSettings(texture, request.settings)
      const base = texture.get('__BASE')

      const shown: ShownTexture = {
        path: request.path,
        version: request.version,
        width: base.width,
        height: base.height,
        placement: placementFor(base.width, base.height, request.scale, cssWidth, cssHeight),
        frames: applied.frames,
        uncoveredRight: applied.uncoveredRight,
        uncoveredBottom: applied.uncoveredBottom,
        filter: filterOf(texture),
      }

      scene.draw(key, shown.placement, pixelRatio)
      forgetOldestBeyond(images, scene.textures, IMAGE_CACHE_LIMIT, key)
      current = shown
      return shown
    },

    clear: () => {
      sequence += 1
      current = null
      scene.draw(null, { x: 0, y: 0, scale: 1 }, pixelRatio)
    },

    destroy: () => {
      images.clear()
      game.destroy(true)
    },
  }
}

/**
 * Where an image of this size sits on a canvas of that size, centred, at a
 * whole-pixel position so the art lands on the pixel grid rather than between
 * two of them.
 */
function placementFor(
  imageWidth: number,
  imageHeight: number,
  scale: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; scale: number } {
  return {
    x: Math.round((canvasWidth - imageWidth * scale) / 2),
    y: Math.round((canvasHeight - imageHeight * scale) / 2),
    scale,
  }
}

/**
 * The scene, which holds exactly one Image and moves it about.
 *
 * `create` is not declared on Phaser's `Scene`, so it carries no `override`
 * keyword — it is a hook the framework calls by name rather than a method being
 * replaced.
 */
class PreviewScene extends Phaser.Scene {
  private readonly announceReady: (scene: PreviewScene) => void
  private image: Phaser.GameObjects.Image | null = null

  constructor(announceReady: (scene: PreviewScene) => void) {
    super('texture-preview')
    this.announceReady = announceReady
  }

  create(): void {
    this.announceReady(this)
  }

  /**
   * Shows the texture with this key, or nothing when given none.
   *
   * The Image is created once and then reused: swapping its texture is what
   * makes changing selection a redraw rather than a rebuild. `__BASE` is the
   * whole image, so a texture cut into frames still draws as the sheet it is.
   */
  draw(key: string | null, placement: { x: number; y: number; scale: number }, pixelRatio: number): void {
    if (key === null) {
      this.image?.setVisible(false)
      return
    }

    if (this.image === null) {
      this.image = this.add.image(0, 0, key, '__BASE').setOrigin(0, 0)
    } else {
      this.image.setTexture(key, '__BASE')
    }

    this.image
      .setVisible(true)
      .setPosition(Math.round(placement.x * pixelRatio), Math.round(placement.y * pixelRatio))
      .setScale(placement.scale * pixelRatio)
  }
}

/** Fetches and decodes an image, or hands back the one already decoded. */
async function loadImage(
  cache: Map<string, HTMLImageElement>,
  key: string,
  url: string,
): Promise<HTMLImageElement> {
  const cached = cache.get(key)
  if (cached !== undefined) {
    // Re-inserted so the eviction order is "least recently shown".
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const image = new Image()
  image.src = url
  await image.decode()

  cache.set(key, image)
  return image
}

/**
 * Drops the least recently shown images, and the GPU textures that go with
 * them, once there are more than the cache is meant to hold.
 */
function forgetOldestBeyond(
  cache: Map<string, HTMLImageElement>,
  textures: Phaser.Textures.TextureManager,
  limit: number,
  keep: string,
): void {
  for (const key of [...cache.keys()]) {
    if (cache.size <= limit) return
    if (key === keep) continue
    cache.delete(key)
    if (textures.exists(key)) textures.remove(key)
  }
}

function setCanvasStyleSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
}
