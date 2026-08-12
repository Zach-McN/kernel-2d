import {
  defaultTextureImportSettings,
  type ImportSettings,
  type Slice,
  type TextureImportSettings,
} from '../../sidecar/meta-schema.js'
import { PixelCanvas, drawSprite, type Colour } from './png.js'
import { decay, encodeWav, sine } from './wav.js'

/**
 * The sample project: what a small 2D game's folder looks like once there is
 * something in it.
 *
 * Chosen to exercise the asset browser rather than to look good — three levels
 * of nesting, several extensions, a paired asset (a bitmap font is a page plus
 * a description), a folder the engine ignores, and a file type nothing
 * recognises.
 *
 * Two things deliberately absent. There is no fake `.psd` or `.aseprite`: a
 * file claiming to be a Photoshop document that is not one is a trap for
 * whoever opens it, and real ones can simply be dropped in. And the scene,
 * prefab and data files carry placeholder contents, because those formats have
 * no schema yet — plausible-looking contents are how a wrong format quietly
 * becomes precedent.
 */

export const GENERATED_BY = 'claude-opus-5'

export interface SampleFile {
  /** Project-relative, forward-slashed. */
  path: string
  contents: Buffer | string
  /**
   * `json` files carry their provenance inside themselves; everything else
   * gets it in a `.meta` sidecar beside it, per the marking rules.
   */
  marking: 'inside' | 'sidecar'
  /**
   * Import settings for the generated `.meta`, where this sample has something
   * to say beyond the defaults. Omitted means defaults, which is most files.
   */
  settings?: ImportSettings
}

/** Everything in this sample is drawn on a 16px grid, sheets included. */
const grid = (frameWidth: number, frameHeight: number): Slice => ({
  mode: 'grid',
  frameWidth,
  frameHeight,
  margin: 0,
  spacing: 0,
})

/** The middle of the bottom edge — where a character stands. */
const FEET = { x: 0.5, y: 1 }

const texture = (over: Partial<TextureImportSettings> = {}): ImportSettings => ({
  type: 'texture',
  ...defaultTextureImportSettings(),
  ...over,
})

export function sampleFiles(generatedAt: string): SampleFile[] {
  const note = (text: string): string =>
    `${JSON.stringify({ generatedBy: GENERATED_BY, generatedAt, note: text }, null, 2)}\n`

  return [
    // --- textures ---------------------------------------------------------
    {
      path: 'assets/textures/characters/knight-idle.png',
      contents: knight().toPng(),
      marking: 'sidecar',
      settings: texture({ pivot: FEET }),
    },
    {
      path: 'assets/textures/characters/knight-run-strip.png',
      contents: knightRunStrip(),
      marking: 'sidecar',
      settings: texture({ pivot: FEET, slice: grid(16, 16) }),
    },
    {
      path: 'assets/textures/characters/slime.png',
      contents: slime().toPng(),
      marking: 'sidecar',
      settings: texture({ pivot: FEET }),
    },
    {
      path: 'assets/textures/tiles/tileset-grass.png',
      contents: tileset(GRASS_TILES),
      marking: 'sidecar',
      settings: texture({ slice: grid(16, 16) }),
    },
    {
      path: 'assets/textures/tiles/tileset-cave.png',
      contents: tileset(CAVE_TILES),
      marking: 'sidecar',
      settings: texture({ slice: grid(16, 16) }),
    },
    { path: 'assets/textures/ui/button-idle.png', contents: button(false), marking: 'sidecar' },
    { path: 'assets/textures/ui/button-hover.png', contents: button(true), marking: 'sidecar' },
    { path: 'assets/textures/ui/icon-heart.png', contents: heart().toPng(), marking: 'sidecar' },

    // --- audio ------------------------------------------------------------
    {
      path: 'assets/audio/music/theme-menu.wav',
      contents: encodeWav({
        seconds: 2,
        at: (_progress, time) => {
          const note = MENU_NOTES[Math.floor(time * 4) % MENU_NOTES.length] ?? 220
          return 0.25 * sine(note, time) * decay((time * 4) % 1, 2)
        },
      }),
      marking: 'sidecar',
    },
    {
      path: 'assets/audio/sfx/jump.wav',
      contents: encodeWav({
        seconds: 0.25,
        at: (progress, time) => 0.4 * sine(220 + 700 * progress, time) * decay(progress, 5),
      }),
      marking: 'sidecar',
    },
    {
      path: 'assets/audio/sfx/hit.wav',
      contents: encodeWav({
        seconds: 0.2,
        at: (progress, _time, random) => 0.5 * (random() * 2 - 1) * decay(progress, 9),
      }),
      marking: 'sidecar',
    },

    // --- fonts: a page and the description that goes with it --------------
    {
      path: 'assets/fonts/pixel-8.png',
      contents: fontPage(),
      marking: 'sidecar',
      settings: texture({ slice: grid(8, 16) }),
    },
    { path: 'assets/fonts/pixel-8.fnt', contents: FONT_DESCRIPTION, marking: 'sidecar' },

    // --- the folder the engine ignores ------------------------------------
    { path: 'assets/source/README.txt', contents: SOURCE_README, marking: 'sidecar' },

    // --- everything that is not an asset ----------------------------------
    { path: 'data/items.json', contents: note('Placeholder for the item database. No schema for it exists yet.'), marking: 'inside' },
    { path: 'data/waves.json', contents: note('Placeholder for the wave schedule. No schema for it exists yet.'), marking: 'inside' },
    { path: 'prefabs/enemy-slime.json', contents: note('Placeholder prefab. PrefabSchema does not exist yet — do not treat this shape as the format.'), marking: 'inside' },
    { path: 'scenes/level-01.json', contents: note('Placeholder scene. SceneSchema does not exist yet — do not treat this shape as the format.'), marking: 'inside' },
    { path: 'scenes/level-02.json', contents: note('Placeholder scene. SceneSchema does not exist yet — do not treat this shape as the format.'), marking: 'inside' },
    { path: 'project.json', contents: note('Placeholder project settings. The real format lands with the runtime.'), marking: 'inside' },
  ]
}

// --- the pixels -----------------------------------------------------------

const PALETTE: Record<string, Colour> = {
  o: [26, 28, 34, 255], // outline
  h: [184, 192, 204, 255], // steel
  H: [122, 132, 148, 255], // steel, shaded
  f: [232, 185, 138, 255], // face
  b: [74, 111, 165, 255], // tunic
  B: [51, 80, 122, 255], // tunic, shaded
  l: [59, 63, 74, 255], // legs
  g: [126, 200, 110, 255], // slime
  G: [86, 156, 74, 255], // slime, shaded
  k: [26, 28, 34, 255], // eyes
  m: [58, 96, 52, 255], // mouth
  r: [214, 74, 92, 255], // heart
}

function knight(): PixelCanvas {
  return drawSprite(
    [
      '................',
      '.....oooooo.....',
      '....ohhhhhho....',
      '....ohHhhHho....',
      '....offffffo....',
      '....o.ffff.o....',
      '.....offffo.....',
      '...obbbbbbbbo...',
      '..obbbbbbbbbbo..',
      '..obBbbbbbbBbo..',
      '..obbbbbbbbbbo..',
      '..obbbbbbbbbbo..',
      '...obbbbbbbbo...',
      '....ollllllo....',
      '....oll..llo....',
      '....oo....oo....',
    ],
    PALETTE,
  )
}

function slime(): PixelCanvas {
  return drawSprite(
    [
      '................',
      '................',
      '................',
      '................',
      '.....oooooo.....',
      '....oggggggo....',
      '...oggggggggo...',
      '..oggkggggkggo..',
      '..oggggggggggo..',
      '..oggmmmmmmggo..',
      '..oggggggggggo..',
      '..oGgggggggggo..',
      '..oGGgggggggGo..',
      '..oGGGGGGGGGGo..',
      '...oooooooooo...',
      '................',
    ],
    PALETTE,
  )
}

function heart(): PixelCanvas {
  return drawSprite(
    [
      '................',
      '................',
      '................',
      '...oo......oo...',
      '..orro....orro..',
      '.orrrro..orrrro.',
      '.orrrrrrrrrrrro.',
      '.orrrrrrrrrrrro.',
      '..orrrrrrrrrro..',
      '...orrrrrrrro...',
      '....orrrrrro....',
      '.....orrrro.....',
      '......orro......',
      '.......oo.......',
      '................',
      '................',
    ],
    PALETTE,
  )
}

/** Four frames of the same knight, bobbing, laid out left to right. */
function knightRunStrip(): Buffer {
  const frame = knight()
  const strip = new PixelCanvas(frame.width * 4, frame.height)
  const bob = [0, -1, 0, 1]

  bob.forEach((offset, index) => {
    strip.stamp(frame, index * frame.width, offset)
  })

  return strip.toPng()
}

const GRASS_TILES: readonly Colour[] = [
  [104, 168, 84, 255],
  [126, 200, 110, 255],
  [86, 140, 70, 255],
  [148, 120, 78, 255],
]

const CAVE_TILES: readonly Colour[] = [
  [72, 74, 90, 255],
  [96, 98, 116, 255],
  [54, 56, 70, 255],
  [120, 108, 92, 255],
]

/** Sixteen 16px tiles in a 4×4 sheet, speckled so the grid is visible. */
function tileset(colours: readonly Colour[]): Buffer {
  const canvas = new PixelCanvas(64, 64)
  let seed = 12_345

  for (let tileY = 0; tileY < 4; tileY += 1) {
    for (let tileX = 0; tileX < 4; tileX += 1) {
      const base = colours[(tileX + tileY) % colours.length] ?? colours[0] ?? [0, 0, 0, 255]
      canvas.fill(tileX * 16, tileY * 16, 16, 16, base)

      for (let speck = 0; speck < 18; speck += 1) {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
        const x = tileX * 16 + (seed >>> 8) % 16
        const y = tileY * 16 + (seed >>> 16) % 16
        canvas.set(x, y, shade(base, 0.85))
      }
    }
  }

  return canvas.toPng()
}

function button(hovered: boolean): Buffer {
  const canvas = new PixelCanvas(32, 12)
  const face: Colour = hovered ? [92, 128, 190, 255] : [64, 92, 140, 255]

  canvas.fill(0, 0, 32, 12, face)
  canvas.outline(0, 0, 32, 12, [26, 28, 34, 255])
  canvas.fill(1, 1, 30, 1, shade(face, 1.25))
  canvas.fill(1, 10, 30, 1, shade(face, 0.75))

  return canvas.toPng()
}

/** A stand-in font page: eight cells, each with a different mark. */
function fontPage(): Buffer {
  const canvas = new PixelCanvas(64, 16)
  const ink: Colour = [236, 240, 246, 255]

  for (let cell = 0; cell < 8; cell += 1) {
    const x = cell * 8
    canvas.outline(x + 1, 2, 6, 8, ink)
    canvas.fill(x + 3, 4 + (cell % 4), 2, 2, ink)
  }

  return canvas.toPng()
}

function shade(colour: Colour, factor: number): Colour {
  const channel = (value: number): number => Math.max(0, Math.min(255, Math.round(value * factor)))
  return [channel(colour[0]), channel(colour[1]), channel(colour[2]), colour[3]]
}

const MENU_NOTES = [262, 330, 392, 330]

const FONT_DESCRIPTION = `info face="pixel-8" size=8 bold=0 italic=0 unicode=1
common lineHeight=8 base=7 scaleW=64 scaleH=16 pages=1
page id=0 file="pixel-8.png"
chars count=8
char id=65 x=0 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0
char id=66 x=8 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0
char id=67 x=16 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0
char id=68 x=24 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0
char id=69 x=32 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0
char id=70 x=40 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0
char id=71 x=48 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0
char id=72 x=56 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0
`

const SOURCE_README = `This folder holds the originals the engine never loads:
.psd files from Photoshop, .aseprite files, .blend files.

Keep them here so the whole project stays one folder and one repository.
The asset browser shows them; nothing imports them.
`
