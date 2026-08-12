import { z } from 'zod'

/**
 * The `.meta` sidecar format: how the editor annotates a file it does not own.
 *
 * A binary lands wherever the human put it from Photoshop or Blender, and the
 * editor's only privilege over it is to write a JSON file beside it
 * (`knight.png` + `knight.png.meta`) holding a stable id and the settings that
 * decide how it is imported (editor-kernel D4). Nothing here ever changes the
 * asset itself.
 *
 * This file is the single source of truth for the shape (editor-kernel D6) and
 * is compiled into the browser as well as the sidecar, so it must never reach
 * for anything Node-only (editor-kernel D16).
 */

export const ASSET_META_FORMAT = 'kernel2d.asset-meta'
export const ASSET_META_VERSION = 1

/**
 * What kind of thing the annotated file is.
 *
 * Only `texture` carries settings in v1. The others are named anyway because
 * "show me every sound in the project" is a question that arrives long before
 * audio has any import settings worth tuning, and a type is what answers it.
 * `other` covers a file the editor has no import settings for at all — it is
 * never minted by the sidecar, only read, because the one thing that produces
 * it is a generator marking a file that cannot carry its provenance inside
 * itself (a `.txt`, say).
 */
export type AssetType = 'texture' | 'audio' | 'font' | 'other'

/** Nearest keeps pixel art crisp, which is what this kernel is for. */
export type TextureFilter = 'nearest' | 'linear'

/**
 * Where the sprite's handle sits, as a fraction of its size, measured from the
 * top-left. `{x: 0.5, y: 1}` is the middle of the bottom edge — a character's
 * feet.
 */
export interface Pivot {
  x: number
  y: number
}

/**
 * How the image is cut into frames. A sheet with no frame size is not a sheet,
 * so the two are one choice rather than a flag plus some optional numbers.
 */
export type Slice =
  | { mode: 'single' }
  | {
      mode: 'grid'
      frameWidth: number
      frameHeight: number
      /** Blank border around the whole sheet, in pixels. */
      margin: number
      /** Blank gap between neighbouring frames, in pixels. */
      spacing: number
    }

export interface TextureImportSettings {
  filter: TextureFilter
  pivot: Pivot
  slice: Slice
}

/**
 * Settings, keyed by what the file is. The three settingless kinds carry only
 * their type on purpose: nothing reads an audio import setting yet, a bitmap
 * font already describes itself in its `.fnt`, and the editor has no settings
 * at all for a file it does not import.
 */
export type ImportSettings =
  | ({ type: 'texture' } & TextureImportSettings)
  | { type: 'audio' }
  | { type: 'font' }
  | { type: 'other' }

export interface AssetMeta {
  format: typeof ASSET_META_FORMAT
  version: typeof ASSET_META_VERSION
  /**
   * Stable across renames and moves; generated once and never changed. Paired
   * with a human-readable path wherever it is referenced (editor-kernel D5).
   */
  id: string
  type: AssetType
  /** Keyed by `type`, so a grid slice without a frame size cannot be written. */
  importSettings: ImportSettings
  /** Present only on files an AI produced. Read, preserved, never invented. */
  generatedBy?: string | undefined
  /** `YYYY-MM-DD`, alongside `generatedBy`. */
  generatedAt?: string | undefined
}

/**
 * Every object here is loose — it keeps keys it does not model rather than
 * stripping them.
 *
 * This is the whole of the promise that a key you added by hand survives the
 * editor changing a setting. A strict schema would parse the file, silently
 * drop your key, and hand back a document that gets written straight over the
 * original; preserving it would then depend on some merge step remembering to
 * put it back, at every level, forever. Loose objects mean the value the editor
 * holds simply *is* the value from disk, so there is nothing to remember and no
 * level at which it can be forgotten. See text-formats F1 for the round-trip
 * test this makes honest.
 */
const PivotSchema: z.ZodType<Pivot> = z.looseObject({
  x: z.number().finite(),
  y: z.number().finite(),
})

const SliceSchema: z.ZodType<Slice> = z.discriminatedUnion('mode', [
  z.looseObject({ mode: z.literal('single') }),
  z.looseObject({
    mode: z.literal('grid'),
    frameWidth: z.number().int().positive(),
    frameHeight: z.number().int().positive(),
    margin: z.number().int().nonnegative(),
    spacing: z.number().int().nonnegative(),
  }),
])

const ImportSettingsSchema: z.ZodType<ImportSettings> = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('texture'),
    filter: z.enum(['nearest', 'linear']),
    pivot: PivotSchema,
    slice: SliceSchema,
  }),
  z.looseObject({ type: z.literal('audio') }),
  z.looseObject({ type: z.literal('font') }),
  z.looseObject({ type: z.literal('other') }),
])

export const AssetMetaSchema: z.ZodType<AssetMeta> = z
  .looseObject({
    format: z.literal(ASSET_META_FORMAT),
    version: z.literal(ASSET_META_VERSION),
    // Validated as a non-empty string rather than against a pattern. The
    // convention is 16 lowercase hex characters and lives in the one function
    // that mints them; a pattern here would only turn an id somebody typed by
    // hand into a parse failure, and a parse failure is how a human loses a
    // file the editor promised never to touch.
    id: z.string().min(1),
    type: z.enum(['texture', 'audio', 'font', 'other']),
    importSettings: ImportSettingsSchema,
    generatedBy: z.string().min(1).optional(),
    generatedAt: z.string().min(1).optional(),
  })
  // The type is stated twice — once at the top level where it is read, and once
  // inside the settings where it discriminates. This is what keeps them honest.
  .refine((meta) => meta.type === meta.importSettings.type, {
    message: 'type and importSettings.type must agree',
    path: ['importSettings', 'type'],
  })

// --- the vocabulary -------------------------------------------------------

/**
 * Which extensions the editor recognises as assets, and what it calls them.
 *
 * This map is the whole definition of "is this file an asset?" — there is no
 * folder rule beside it. `assets/` is a convention in the folder map, not a
 * law, and a rule that read "assets get settings, except in this folder" is a
 * special case that has to be remembered forever.
 *
 * Anything not listed here is not an asset: the sidecar writes no `.meta` for
 * it, and the Inspector says so plainly.
 */
export const ASSET_TYPE_BY_EXTENSION: Readonly<Record<string, AssetType>> = {
  '.png': 'texture',
  '.jpg': 'texture',
  '.jpeg': 'texture',
  '.webp': 'texture',
  '.gif': 'texture',
  '.bmp': 'texture',

  '.wav': 'audio',
  '.mp3': 'audio',
  '.ogg': 'audio',
  '.m4a': 'audio',
  '.flac': 'audio',

  '.fnt': 'font',
  '.ttf': 'font',
  '.otf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
}

/** The suffix that marks a sidecar. A `.meta` never gets a `.meta` of its own. */
export const META_SUFFIX = '.meta'

export function isMetaFileName(name: string): boolean {
  return name.toLowerCase().endsWith(META_SUFFIX)
}

/** The `.meta` path for a file path. Works on any separator-free path string. */
export function metaPathFor(filePath: string): string {
  return `${filePath}${META_SUFFIX}`
}

/** The file a `.meta` path annotates, or null if it is not a `.meta` path. */
export function annotatedPathFor(metaPath: string): string | null {
  if (!isMetaFileName(metaPath)) return null
  return metaPath.slice(0, -META_SUFFIX.length)
}

/**
 * The asset type for a file name, or null when the editor does not recognise
 * it. Sidecars are never assets, whatever they are named after.
 */
export function assetTypeForName(name: string): AssetType | null {
  if (isMetaFileName(name)) return null
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return ASSET_TYPE_BY_EXTENSION[name.slice(dot).toLowerCase()] ?? null
}

/**
 * The settings a file starts life with. Both writers of this format — the
 * sidecar and the sample-project generator — build their documents from here,
 * so there is one definition of what a default `.meta` looks like rather than
 * two that drift.
 *
 * `id` is passed in because minting one differs by writer: the sidecar wants a
 * random id, the generator wants one derived from the path so that re-running
 * it produces identical bytes. Ids are opaque, so both are fine.
 */
export function defaultTextureImportSettings(): TextureImportSettings {
  return {
    // Nearest, because a pixel-art texture smoothed on import is ruined and no
    // setting further down the pipeline puts it back.
    filter: 'nearest',
    pivot: { x: 0.5, y: 0.5 },
    slice: { mode: 'single' },
  }
}

export function defaultImportSettings(type: AssetType): ImportSettings {
  if (type === 'texture') return { type: 'texture', ...defaultTextureImportSettings() }
  return { type }
}

export function defaultMeta(type: AssetType, id: string): AssetMeta {
  return {
    format: ASSET_META_FORMAT,
    version: ASSET_META_VERSION,
    id,
    type,
    importSettings: defaultImportSettings(type),
  }
}

/**
 * How a `.meta` is written to disk, everywhere. Two spaces and a trailing
 * newline, so the file reads well in a text editor and diffs a line at a time.
 */
export function serializeMeta(meta: AssetMeta): string {
  return `${JSON.stringify(meta, null, 2)}\n`
}
