import * as Phaser from 'phaser'

import type { TextureImportSettings } from '../formats/meta-schema'
import { spriteOf, type Entity, type Scene } from '../formats/scene-schema'
import { applyImportSettings } from '../textures/import-settings'
import { createEntityLayer, type DrawnEntity, type EntityLayer, type ResolvedSprite } from './entity-layer'
import { toScreenPoint } from './coordinates'

/**
 * A scene, drawn by the real renderer.
 *
 * The second surface the runtime offers, alongside the single-texture preview.
 * Like that one it boots **one Phaser game and keeps it for the life of the
 * window** (phaser4-runtime P2) — the count of live renderers is the number of
 * viewport-shaped panels the editor declares, which is a number written down in
 * one file, not a number that grows with use. Nothing here is created per
 * selection and nothing is destroyed when a tab is closed or dragged.
 *
 * It knows nothing about panels, stores, selection or undo. Where the bytes of
 * a texture come from arrives as a function, so a shipped game and the editor
 * can each answer that question their own way (editor-kernel D1).
 */

/** What the caller can tell this view about one texture the scene refers to. */
export interface SceneTexture {
  /** Changes whenever the file on disk does. Half the cache key. */
  version: number
  settings: TextureImportSettings
}

export interface SceneRequest {
  /** The scene's own path, project-relative. Reported back so the caller can tell what it is looking at. */
  path: string
  scene: Scene
  /**
   * The textures this scene may draw, keyed by project-relative path.
   *
   * Only what the caller could actually supply: a texture missing from here is
   * one the editor already knows it cannot draw — it is not in the project, or
   * its import settings have not arrived — and saying so in words is the
   * editor's job, not this renderer's.
   */
  textures: Readonly<Record<string, SceneTexture>>
}

export interface ShownScene {
  path: string
  /** In list order, which is draw order. */
  entities: DrawnEntity[]
  /** Where the scene's own origin landed, in CSS pixels. The bottom-left corner. */
  sceneOrigin: { x: number; y: number }
  /** The canvas, in CSS pixels — what the overlay is drawing on top of. */
  canvasSize: { width: number; height: number }
  /**
   * Textures that were offered and could not be fetched or decoded. Rare, and
   * distinct from a texture the caller never offered: this one was supposed to
   * work.
   */
  undrawable: string[]
}

export interface SceneViewOptions {
  resolveAssetUrl: (path: string, version: number) => string
  /** Device pixels per CSS pixel. Taken as an option so a test can pin it. */
  pixelRatio?: number
}

export interface SceneView {
  /** Detached until something puts it in the document. */
  readonly canvas: HTMLCanvasElement
  /**
   * Both in CSS pixels. Answers with the new placement of everything on
   * screen, because a taller panel moves every sprite — the floor is the bottom
   * edge — and anything drawn on top has to move with it.
   */
  resize: (width: number, height: number) => ShownScene | null
  /**
   * Draws a scene. Resolves with what was drawn, or with `null` when a later
   * request overtook this one.
   */
  show: (request: SceneRequest) => Promise<ShownScene | null>
  /** Draws nothing at all. */
  clear: () => void
  destroy: () => void
}

/** How many decoded images to keep, so flicking between two scenes is free. */
const IMAGE_CACHE_LIMIT = 32

/** The size the game boots at, before anything has measured the panel. */
const INITIAL_SIZE = { width: 640, height: 360 }

export async function createSceneView(options: SceneViewOptions): Promise<SceneView> {
  const pixelRatio =
    options.pixelRatio ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'

  let announceReady: (scene: SceneStage) => void = () => {}
  const whenReady = new Promise<SceneStage>((resolve) => {
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
    scale: { mode: Phaser.Scale.NONE },
    banner: false,
    audio: { noAudio: true },
    scene: new SceneStage((stage) => announceReady(stage)),
  })

  const stage = await whenReady

  let cssWidth = INITIAL_SIZE.width
  let cssHeight = INITIAL_SIZE.height
  setCanvasStyleSize(canvas, cssWidth, cssHeight)

  const images = new Map<string, HTMLImageElement>()
  let sequence = 0
  let current: SceneRequest | null = null

  const textureKeyFor = (path: string, version: number): string => `scene:${path}@${version}`

  /**
   * Draws the request that is already loaded, at the current canvas size.
   *
   * Separated from `show` because resizing must not fetch anything: a panel
   * dragged taller moves every sprite and reloads nothing.
   */
  const draw = (request: SceneRequest, available: ReadonlySet<string>): ShownScene => {
    const resolve = (entity: Entity): ResolvedSprite | null => {
      const sprite = spriteOf(entity)
      if (sprite === null) return null

      const texture = request.textures[sprite.texture.path]
      if (texture === undefined) return null

      const key = textureKeyFor(sprite.texture.path, texture.version)
      if (!available.has(key)) return null

      return {
        textureKey: key,
        // Frame "0" is the first frame of a sliced sheet, and the whole image
        // when the slice is `single` — applying import settings always leaves
        // one behind. `__BASE` is the fallback for a grid whose frame size does
        // not fit the image at all, where there are no frames to draw.
        frame: stage.textures.get(key).has('0') ? '0' : '__BASE',
        // The pivot comes from the texture's import settings and from nowhere
        // else. The scene has no opinion about it, deliberately.
        pivot: texture.settings.pivot,
      }
    }

    return {
      path: request.path,
      entities: stage.entities.sync(request.scene.entities, resolve, cssHeight, pixelRatio),
      sceneOrigin: toScreenPoint({ x: 0, y: 0 }, cssHeight),
      canvasSize: { width: cssWidth, height: cssHeight },
      undrawable: undrawableIn(request, available, textureKeyFor),
    }
  }

  /** Which of this request's textures are registered and ready to draw. */
  const registered = (request: SceneRequest): Set<string> => {
    const keys = new Set<string>()
    for (const [path, texture] of Object.entries(request.textures)) {
      const key = textureKeyFor(path, texture.version)
      if (stage.textures.exists(key)) keys.add(key)
    }
    return keys
  }

  return {
    canvas,

    resize: (width, height) => {
      cssWidth = Math.max(1, Math.round(width))
      cssHeight = Math.max(1, Math.round(height))
      game.scale.resize(cssWidth * pixelRatio, cssHeight * pixelRatio)
      setCanvasStyleSize(canvas, cssWidth, cssHeight)
      if (current === null) return null
      return draw(current, registered(current))
    },

    show: async (request) => {
      const mine = (sequence += 1)

      const wanted = Object.entries(request.textures)
      const loaded = await Promise.all(
        wanted.map(async ([path, texture]) => {
          const key = textureKeyFor(path, texture.version)
          try {
            const image = await loadImage(images, key, options.resolveAssetUrl(path, texture.version))
            return { key, image }
          } catch {
            // Reported through `undrawable` rather than thrown: one texture that
            // will not decode should cost that one entity its picture, not the
            // whole scene.
            return { key, image: null }
          }
        }),
      )

      // Overtaken while the bytes were in the air. Drawing now would put the
      // scene that *was* open on screen under the name of the one that is.
      if (mine !== sequence) return null

      const available = new Set<string>()
      for (const { key, image } of loaded) {
        if (image === null) continue
        // Registered once per path-and-version: a texture already here is the
        // same bytes by construction, so re-adding it would be an identical
        // upload to the GPU for no reason.
        const texture = stage.textures.exists(key)
          ? stage.textures.get(key)
          : stage.textures.addImage(key, image)
        if (texture === null) continue
        available.add(key)
      }

      // Settings are applied to the live texture on every pass, in place. That
      // is what makes changing a filter or a frame size a redraw rather than a
      // reload (phaser4-runtime P3), and it is why a scene picks up a texture
      // setting changed in another panel without being reopened.
      for (const [path, texture] of Object.entries(request.textures)) {
        const key = textureKeyFor(path, texture.version)
        if (!available.has(key)) continue
        applyImportSettings(stage.textures.get(key), texture.settings)
      }

      current = request
      const shown = draw(request, available)
      forgetOldestBeyond(images, stage.textures, IMAGE_CACHE_LIMIT, available)
      return shown
    },

    clear: () => {
      sequence += 1
      current = null
      stage.entities.clear()
    },

    destroy: () => {
      images.clear()
      game.destroy(true)
    },
  }
}

function undrawableIn(
  request: SceneRequest,
  available: ReadonlySet<string>,
  textureKeyFor: (path: string, version: number) => string,
): string[] {
  return Object.entries(request.textures)
    .filter(([path, texture]) => !available.has(textureKeyFor(path, texture.version)))
    .map(([path]) => path)
    .sort()
}

/**
 * The stage: an empty scene that owns the entity layer.
 *
 * `create` is not declared on Phaser's `Scene`, so it carries no `override`
 * keyword — it is a hook the framework calls by name rather than a method being
 * replaced (phaser4-runtime G4).
 */
class SceneStage extends Phaser.Scene {
  private readonly announceReady: (stage: SceneStage) => void
  private layer: EntityLayer | null = null

  constructor(announceReady: (stage: SceneStage) => void) {
    super('scene-view')
    this.announceReady = announceReady
  }

  create(): void {
    this.layer = createEntityLayer(this)
    this.announceReady(this)
  }

  get entities(): EntityLayer {
    if (this.layer === null) throw new Error('the scene stage was used before it was ready')
    return this.layer
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
    // Re-inserted so the eviction order is "least recently drawn".
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

/** Drops the least recently drawn images, and the GPU textures with them. */
function forgetOldestBeyond(
  cache: Map<string, HTMLImageElement>,
  textures: Phaser.Textures.TextureManager,
  limit: number,
  keep: ReadonlySet<string>,
): void {
  for (const key of [...cache.keys()]) {
    if (cache.size <= limit) return
    if (keep.has(key)) continue
    cache.delete(key)
    if (textures.exists(key)) textures.remove(key)
  }
}

function setCanvasStyleSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
}
