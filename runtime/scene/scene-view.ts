import * as Phaser from 'phaser'

import { spriteOf, type Entity } from '../formats/scene-schema'
import { forgetOldestBeyond, loadImage, setCanvasStyleSize } from '../textures/image-cache'
import { applyImportSettings } from '../textures/import-settings'
import { createEntityLayer, type DrawnEntity, type EntityLayer, type ResolvedSprite } from './entity-layer'
import type { SceneMusic, SceneRequest, SceneTexture } from './scene-request'
import {
  DEFAULT_CAMERA,
  snapCamera,
  toSceneRect,
  toScreenPoint,
  union,
  type Camera,
  type Rect,
  type Size,
} from './coordinates'

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

/**
 * What this view is asked to draw is declared next door, in a module the Node
 * half of the repo can compile — see the note at the top of `scene-request.ts`
 * for why that mattered. Re-exported here so nothing downstream can tell.
 */
export type { SceneMusic, SceneRequest, SceneTexture }

export interface ShownScene {
  path: string
  /** In list order, which is draw order. */
  entities: DrawnEntity[]
  /**
   * Where the scene's own origin landed, in CSS pixels from the canvas's
   * top-left. Off the canvas whenever the camera is looking elsewhere.
   */
  sceneOrigin: { x: number; y: number }
  /** The canvas, in CSS pixels — what the overlay is drawing on top of. */
  canvasSize: Size
  /**
   * The camera this scene was *asked* to be drawn with — deliberately, and it
   * is not quite the one it was drawn with. See `drawnWith` below: the pair
   * exists because those two answer different questions.
   */
  camera: Camera
  /**
   * The camera actually used: `camera` nudged by less than a pixel onto the
   * device's own grid, which is how pixel art is kept crisp (`phaser4-runtime`
   * P5). Every rectangle reported in `entities` was drawn through *this* one, so
   * it is the camera to invert with when turning the report back into the
   * level's own units — `contentBounds` is already arrived at that way.
   *
   * It is reported alongside `camera` rather than instead of it because a caller
   * that stored this one would find its own state disagreeing with itself on the
   * next comparison: the snap depends on the canvas size, so a resize would look
   * like the human had moved the view. Read it, invert with it, never keep it.
   */
  drawnWith: Camera
  /**
   * The extent of everything drawn, in **scene** units, or null for a scene
   * with nothing in it.
   *
   * This is what framing needs, and it is arrived at by inverting the
   * rectangles that were actually drawn rather than by working the extent out
   * again from the transforms — a second derivation of the same geometry is two
   * answers that agree until they don't. An entity with nothing to draw counts
   * as a point at its own position, so it is still findable.
   */
  contentBounds: Rect | null
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
   * Both in CSS pixels. The camera is left exactly as it was, so a panel
   * dragged wider reveals more scene on both sides rather than moving what was
   * already on screen — the middle of the panel keeps meaning the same place.
   * Answers with the new placement, because everything drawn on top has to move
   * with the picture.
   */
  resize: (width: number, height: number) => ShownScene | null
  /**
   * Draws a scene, with whatever camera is current. Resolves with what was
   * drawn, or with `null` when a later request overtook this one.
   *
   * The camera is deliberately not part of the request: a request is compared
   * by value to decide when bytes need fetching again, so a camera inside one
   * would turn every frame of a drag into a reload.
   */
  show: (request: SceneRequest) => Promise<ShownScene | null>
  /**
   * Looks from somewhere else, without fetching or uploading anything.
   * Panning and zooming are a redraw, never a reload.
   */
  restage: (camera: Camera) => ShownScene | null
  /**
   * Draws the scene already loaded with its entities as they are *now*, at
   * whatever camera is current, fetching and uploading nothing.
   *
   * This is what a running level redraws through. It is deliberately not
   * `show` with a rebuilt request: `show` fetches bytes, and a level that
   * re-fetched its textures sixty times a second would be a level that
   * stuttered for reasons nobody could see. It is deliberately not `restage`
   * either — that one is about the camera moving while the level stands still,
   * and this is the exact opposite.
   *
   * The entities replace the ones the current request carried, so a resize or a
   * pan afterwards draws where things have got to rather than where they
   * started.
   */
  redraw: (entities: readonly Entity[]) => ShownScene | null
  /**
   * Calls back once per rendered frame with the milliseconds since the last
   * one, and answers with the way to stop. **The engine's own ticker is the one
   * tick source in the kernel**, so nothing here starts a `requestAnimationFrame`
   * of its own: a second timing source would be a second answer to "how much
   * time passed", and the two would disagree the first time a browser throttled
   * a background tab. It also means a hidden tab stops the simulation for free,
   * because Phaser stops stepping.
   *
   * The delta handed over is Phaser's, which is already smoothed and capped
   * (`TimeStep.delta`), so it feeds an accumulator without being tidied first.
   *
   * Nothing subscribes while the editor is editing, which is the whole of why
   * nothing moves in edit mode.
   */
  onFrame: (tick: (elapsedMs: number) => void) => () => void
  /**
   * Starts this file looping — the level's music, for as long as the run lasts.
   * Fetching and decoding happen once per file per version; asking for the
   * track that is already playing changes nothing. Nothing plays until a run
   * asks, which is the whole of why editing is silent.
   */
  playMusic: (music: SceneMusic) => void
  /** Silence, and the way every run ends its music. Harmless when silent. */
  stopMusic: () => void
  /**
   * What the sound system is actually doing, read back off it (P4) — never an
   * echo of what was asked. `locked` is the browser holding audio until the
   * player's first press; the music starts itself the moment that arrives.
   */
  musicState: () => MusicState
  /** Draws nothing at all. */
  clear: () => void
  destroy: () => void
}

export type MusicState = 'silent' | 'loading' | 'locked' | 'playing' | 'failed'

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
    // Audio stays on: this is the surface levels run in, and a running level
    // may have music. The single-texture preview keeps `noAudio` — a picture
    // has nothing to play — so the window still owns exactly one AudioContext.
    scene: new SceneStage((stage) => announceReady(stage)),
  })

  const stage = await whenReady

  let canvasSize: Size = { ...INITIAL_SIZE }
  setCanvasStyleSize(canvas, canvasSize.width, canvasSize.height)

  const images = new Map<string, HTMLImageElement>()
  let sequence = 0
  let current: SceneRequest | null = null
  // Where the viewport is looking. Held here rather than passed in with every
  // request so that panning costs a redraw and nothing else.
  let camera: Camera = DEFAULT_CAMERA

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

    // Everything is drawn through the camera moved onto the device's pixel
    // grid, and the extent is measured back through the same one — so the
    // inversion is exact and a level's size is the same measurement at every
    // zoom. The camera *reported* is the one that was asked for: the snap is a
    // sub-pixel presentation detail, and handing it back would make the caller's
    // own state disagree with itself on the next comparison.
    const drawing = snapCamera(camera, canvasSize, pixelRatio)
    const entities = stage.entities.sync(request.scene.entities, resolve, drawing, canvasSize, pixelRatio)

    return {
      path: request.path,
      entities,
      sceneOrigin: toScreenPoint({ x: 0, y: 0 }, drawing, canvasSize),
      canvasSize: { ...canvasSize },
      camera,
      drawnWith: drawing,
      contentBounds: extentOf(entities, drawing, canvasSize),
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

  // --- the level's music ----------------------------------------------------

  /**
   * Versioned like a texture's key, so a file re-saved from an audio editor
   * while the editor is open is re-fetched rather than played stale.
   */
  const musicKeyFor = (path: string, version: number): string => `music:${path}@${version}`

  /** The sound being played, or on its way to being played. */
  let music: { key: string; sound: Phaser.Sound.BaseSound | null } | null = null
  let musicState: MusicState = 'silent'
  /**
   * Which ask is current. A fetch and a decode both land later, and a run may
   * have stopped — or asked for something else — in between; a continuation
   * that is not the current ask does nothing. Same shape as `sequence` above.
   */
  let musicTicket = 0

  const stopMusic = (): void => {
    musicTicket += 1
    if (music?.sound != null) {
      music.sound.stop()
      music.sound.destroy()
    }
    music = null
    musicState = 'silent'
  }

  /**
   * The decoded file, made into a looping sound and started.
   *
   * If the browser is still holding audio shut — sound before the player's
   * first press — the start is parked on the manager's own `unlocked` event
   * rather than dropped, so an exported game's music begins on the first
   * click without anybody writing a retry.
   */
  const beginMusic = (key: string): void => {
    const manager = game.sound
    const sound = manager.add(key, { loop: true })
    music = { key, sound }

    if (manager.locked) {
      musicState = 'locked'
      const ticket = musicTicket
      manager.once(Phaser.Sound.Events.UNLOCKED, () => {
        if (ticket !== musicTicket) return
        sound.play()
        musicState = 'playing'
      })
      return
    }

    sound.play()
    musicState = 'playing'
  }

  const playMusic = (wanted: SceneMusic): void => {
    const key = musicKeyFor(wanted.path, wanted.version)
    if (music !== null && music.key === key) return

    stopMusic()
    const ticket = ++musicTicket
    music = { key, sound: null }

    const manager = game.sound
    // Decoding straight from bytes is the Web Audio manager's; the HTML5
    // fallback cannot do it. Desktop browsers all take the Web Audio path, so
    // the honest answer elsewhere is "failed", said in the state rather than
    // thrown from inside a renderer.
    if (!(manager instanceof Phaser.Sound.WebAudioSoundManager)) {
      music = null
      musicState = 'failed'
      return
    }

    if (game.cache.audio.has(key)) {
      beginMusic(key)
      return
    }

    musicState = 'loading'

    // Registered before `decodeAudio` is called, not after: the decode can
    // settle in the same tick and an event nobody was listening for yet is an
    // event that never happened.
    const onDecoded = (decodedKey: string): void => {
      if (ticket !== musicTicket || decodedKey !== key) return
      cleanup()
      beginMusic(key)
    }
    // Fires when every file handed to `decodeAudio` has decoded *or errored* —
    // so a file that is not audio at all lands here with nothing in the cache,
    // which is the only failure signal the decode offers.
    const onSettled = (): void => {
      if (ticket !== musicTicket) return
      cleanup()
      if (!game.cache.audio.has(key)) {
        music = null
        musicState = 'failed'
      }
    }
    const cleanup = (): void => {
      manager.off(Phaser.Sound.Events.DECODED, onDecoded)
      manager.off(Phaser.Sound.Events.DECODED_ALL, onSettled)
    }

    void fetch(options.resolveAssetUrl(wanted.path, wanted.version))
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.arrayBuffer()
      })
      .then((bytes) => {
        if (ticket !== musicTicket) return
        manager.on(Phaser.Sound.Events.DECODED, onDecoded)
        manager.on(Phaser.Sound.Events.DECODED_ALL, onSettled)
        manager.decodeAudio(key, bytes)
      })
      .catch(() => {
        if (ticket !== musicTicket) return
        music = null
        musicState = 'failed'
      })
  }

  return {
    canvas,

    resize: (width, height) => {
      canvasSize = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
      game.scale.resize(canvasSize.width * pixelRatio, canvasSize.height * pixelRatio)
      setCanvasStyleSize(canvas, canvasSize.width, canvasSize.height)
      if (current === null) return null
      return draw(current, registered(current))
    },

    restage: (next) => {
      camera = next
      if (current === null) return null
      return draw(current, registered(current))
    },

    redraw: (entities) => {
      if (current === null) return null
      // A new request object rather than an assignment into the old one: the
      // request handed to `show` belongs to whoever built it, and a running
      // level writing into it would change an object the editor is comparing
      // by value — which would restart the very level that is running.
      current = { ...current, scene: { ...current.scene, entities: [...entities] } }
      return draw(current, registered(current))
    },

    onFrame: (tick) => {
      stage.frames.add(tick)
      return () => {
        stage.frames.delete(tick)
      }
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

    playMusic,
    stopMusic,
    musicState: () => musicState,

    clear: () => {
      sequence += 1
      current = null
      stage.entities.clear()
    },

    destroy: () => {
      stopMusic()
      images.clear()
      game.destroy(true)
    },
  }
}

/**
 * How much of the scene is here, in the scene's own units.
 *
 * Built by inverting what was drawn rather than by measuring the transforms a
 * second time, so "frame everything" frames exactly the things that are on the
 * canvas — including an entity whose texture is missing, which has no picture
 * but is still somewhere and still worth being able to find.
 */
function extentOf(entities: readonly DrawnEntity[], camera: Camera, canvas: Size): Rect | null {
  let extent: Rect | null = null

  for (const entity of entities) {
    const screen = entity.bounds ?? { x: entity.origin.x, y: entity.origin.y, width: 0, height: 0 }
    const rect = toSceneRect(screen, camera, canvas)
    extent = extent === null ? rect : union(extent, rect)
  }

  return extent
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
 * The stage: an empty scene that owns the entity layer, and the one place in
 * the kernel that hears the engine's clock.
 *
 * The two hooks are spelled differently on purpose. `create` is **not** declared
 * on Phaser's `Scene`, so it carries no `override` — it is a hook the framework
 * calls by name (phaser4-runtime G4). `update` **is** declared, so it must carry
 * `override` under `noImplicitOverride`. Exactly opposite, on the same class,
 * and the compiler's message names the keyword rather than the cause either way.
 */
class SceneStage extends Phaser.Scene {
  private readonly announceReady: (stage: SceneStage) => void
  private layer: EntityLayer | null = null
  /**
   * Who wants to hear about frames. Empty whenever nothing is running, which is
   * the whole of "nothing moves in edit mode" — there is no flag to get wrong.
   */
  readonly frames = new Set<(elapsedMs: number) => void>()

  constructor(announceReady: (stage: SceneStage) => void) {
    super('scene-view')
    this.announceReady = announceReady
  }

  create(): void {
    this.layer = createEntityLayer(this)
    this.announceReady(this)
  }

  override update(_time: number, delta: number): void {
    // Copied before iterating: a subscriber that unsubscribes from inside its
    // own callback — which is exactly what a level that stops itself would do —
    // would otherwise be modifying the set being walked.
    for (const tick of [...this.frames]) tick(delta)
  }

  get entities(): EntityLayer {
    if (this.layer === null) throw new Error('the scene stage was used before it was ready')
    return this.layer
  }
}
