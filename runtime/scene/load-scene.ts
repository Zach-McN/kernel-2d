import type { z } from 'zod'

import { ASSET_META_FORMAT, AssetMetaSchema, metaPathFor, type AssetMeta } from '../formats/meta-schema.js'
import { PREFAB_FORMAT, PrefabSchema, resolveEntities, type Prefab } from '../formats/prefab-schema.js'
import {
  SCENE_FORMAT,
  SceneSchema,
  prefabRefOf,
  spriteOf,
  type Entity,
  type Scene,
} from '../formats/scene-schema.js'
import type { SceneRequest, SceneTexture } from './scene-request.js'

/**
 * Opening a level and turning it into something the renderer can draw — the
 * runtime doing it for itself.
 *
 * This is the second sentence of `editor-kernel` D2 finally being spent. Until
 * this file existed the *editor* read every level: it followed the prefab
 * references, followed the texture references, read the `.meta` beside each one,
 * and handed the renderer a finished request. The renderer was real and nothing
 * that fed it was, so "the preview is the actual game" was a claim about an
 * arrangement nobody had ever tested, and an exported game had no way to start.
 *
 * Three things this file is deliberately not:
 *
 *   - **It is not a game loop.** It reads a level and answers with a request.
 *     Nothing here updates, moves, or handles input; those arrive with the first
 *     real game.
 *   - **It is not a filesystem.** Where the bytes come from arrives as a
 *     `ProjectReader`, so the editor can answer out of its development service
 *     and a shipped game can answer out of `fetch` — with the same loader
 *     between them and no editor code inside it (D1).
 *   - **It is not a second opinion about what a level contains.** Prefab
 *     resolution is `resolveEntities` from the format, the pivot and the slicing
 *     come from `AssetMetaSchema`, and the draw order is list order. Every one of
 *     those is the function the editor already calls. Two derivations of what a
 *     level *is* would be the editor and the shipped game disagreeing about the
 *     game, which is D2's failure with a longer fuse.
 *
 * **This file is compiled by both TypeScript projects, so it may reach only
 * modules that are** — no Phaser, no DOM, and relative imports spelled `./x.js`
 * (`text-formats` T10/T14). That is not housekeeping: the export command opens a
 * project by calling this loader in plain Node, which is the only way "the folder
 * I am about to hand over will load" can be checked with the same code that will
 * load it. The two types it needs from the renderer live in `scene-request.ts`
 * for exactly this reason.
 *
 * **What fails the whole load, and what is merely named.** Only the level itself
 * is fatal: no file, or a file that will not parse. A prefab that has gone, a
 * texture with no import settings beside it, a reference pointing at a file that
 * is no longer the one it was written against — each of those is reported by
 * name and the rest of the level still runs. That is not leniency for its own
 * sake: it is the same choice the editor's own resolution makes, and the two
 * pictures are only comparable if both halves fail the same way.
 *
 * **A reference is resolved by path and witnessed by id** (D5), here exactly as
 * in the editor: the path is what finds the file, the recorded id is compared
 * with the one the file carries, and a disagreement is said out loud without
 * vetoing the draw. A prefab's id is inside the document; a texture's is in the
 * `.meta` beside it (D24). Nothing downstream can tell the difference.
 */

export interface ProjectReader {
  /**
   * One JSON file, by project-relative path.
   *
   * Resolves `null` when there is nothing at that path — a missing file is an
   * ordinary answer here, not a fault. Rejects when there is something and it
   * could not be read; the rejection's message is shown to a human, so it should
   * be a sentence rather than a stack trace.
   */
  readJson: (path: string) => Promise<unknown | null>
  /**
   * A token that changes whenever an asset's bytes do. It is half the renderer's
   * texture cache key, so it has to be the *same* answer the rest of the host
   * gives or one file is uploaded to the graphics card twice.
   *
   * The editor answers with the file's modification time, because a texture can
   * be re-saved from Photoshop while the editor is open. A shipped game answers
   * with its build number, because nothing changes underneath it.
   */
  assetVersion: (path: string) => number
}

/** Something in a level that could not be resolved. None of these stop it running. */
export type LoadProblem =
  /** No file at the path this level places instances from. */
  | { kind: 'prefab-missing'; path: string }
  /** There is a file and it is not a prefab. */
  | { kind: 'prefab-unreadable'; path: string; detail: string }
  /** There is a prefab and it is not the one this level was written against. */
  | { kind: 'prefab-different-file'; path: string; expected: string; found: string }
  /** No `.meta` beside the texture, so nothing knows its pivot or its frames. */
  | { kind: 'texture-unannotated'; path: string }
  /** There is a `.meta` and it could not be read. */
  | { kind: 'texture-unreadable'; path: string; detail: string }
  /** The `.meta` is readable and says the file is something other than a texture. */
  | { kind: 'texture-not-a-texture'; path: string; type: string }
  /** The `.meta` is fine and belongs to a different file than the one referenced. */
  | { kind: 'texture-different-file'; path: string; expected: string; found: string }

export type SceneLoadResult =
  | {
      ok: true
      /** Ready for `SceneView.show`. */
      request: SceneRequest
      /** What could not be resolved. The level runs regardless. */
      problems: LoadProblem[]
    }
  /** The level itself could not be opened. One plain sentence saying why. */
  | { ok: false; problem: string }

export async function loadScene(reader: ProjectReader, path: string): Promise<SceneLoadResult> {
  const level = await readDocument(reader, path, SceneSchema, SCENE_FORMAT, 'level')

  if (level.kind === 'missing') return { ok: false, problem: `There is no file at ${path}.` }
  if (level.kind === 'unreadable') {
    return { ok: false, problem: `${nameOf(path)} could not be loaded: ${level.detail}.` }
  }

  const scene = level.value
  const problems: LoadProblem[] = []

  const prefabs = await readPrefabs(reader, scene, problems)
  // The format's own function, not arithmetic invented here: the editor calls
  // this same one, which is the whole reason the two pictures can be compared.
  const entities = resolveEntities(scene.entities, prefabs)
  const textures = await readTextures(reader, entities, problems)

  return {
    ok: true,
    request: { path, scene: { ...scene, entities }, textures },
    problems: problems.sort(byUsefulness),
  }
}

/**
 * The prefabs this level places from, by path.
 *
 * Deduplicated first: fifty slimes pointing at one prefab is one question, not
 * fifty. A prefab that could not be read is left out and named — `resolveEntities`
 * then leaves those entities exactly as the file has them, which is what makes
 * "the instance draws nothing and we say why" fall out rather than be arranged.
 */
async function readPrefabs(
  reader: ProjectReader,
  scene: Scene,
  problems: LoadProblem[],
): Promise<Record<string, Prefab>> {
  const wanted = new Map<string, string>()
  for (const entity of scene.entities) {
    const source = prefabRefOf(entity)
    if (source !== null && !wanted.has(source.path)) wanted.set(source.path, source.id)
  }

  const prefabs: Record<string, Prefab> = {}

  await Promise.all(
    [...wanted].map(async ([path, expectedId]) => {
      const found = await readDocument(reader, path, PrefabSchema, PREFAB_FORMAT, 'prefab')

      if (found.kind === 'missing') {
        problems.push({ kind: 'prefab-missing', path })
        return
      }
      if (found.kind === 'unreadable') {
        problems.push({ kind: 'prefab-unreadable', path, detail: found.detail })
        return
      }

      // Witnessed, not vetoed (D5). The file at that path *is* what the level
      // points at, and refusing to use it would be less informative than using
      // it and saying so.
      if (found.value.id !== expectedId) {
        problems.push({ kind: 'prefab-different-file', path, expected: expectedId, found: found.value.id })
      }

      prefabs[path] = found.value
    }),
  )

  return prefabs
}

/**
 * The textures the *resolved* entities draw, with the import settings that say
 * how.
 *
 * Resolved rather than as-written, because an instance's picture is named by the
 * prefab it points at — which is why this runs after prefab resolution and not
 * beside it.
 *
 * A texture with no readable `.meta` is left out rather than drawn with defaults.
 * Defaults would put the pivot in the middle and treat a sprite sheet as one
 * image, and a sprite silently drawn in the wrong place with the wrong frame is
 * worse than one that is missing and named.
 */
async function readTextures(
  reader: ProjectReader,
  entities: readonly Entity[],
  problems: LoadProblem[],
): Promise<Record<string, SceneTexture>> {
  const wanted = new Map<string, string>()
  for (const entity of entities) {
    const sprite = spriteOf(entity)
    if (sprite !== null && !wanted.has(sprite.texture.path)) wanted.set(sprite.texture.path, sprite.texture.id)
  }

  const textures: Record<string, SceneTexture> = {}

  await Promise.all(
    [...wanted].map(async ([path, expectedId]) => {
      const found = await readDocument(
        reader,
        metaPathFor(path),
        AssetMetaSchema,
        ASSET_META_FORMAT,
        'set of import settings',
      )

      if (found.kind === 'missing') {
        problems.push({ kind: 'texture-unannotated', path })
        return
      }
      if (found.kind === 'unreadable') {
        problems.push({ kind: 'texture-unreadable', path, detail: found.detail })
        return
      }

      const meta: AssetMeta = found.value
      if (meta.importSettings.type !== 'texture') {
        problems.push({ kind: 'texture-not-a-texture', path, type: meta.importSettings.type })
        return
      }

      if (meta.id !== expectedId) {
        problems.push({ kind: 'texture-different-file', path, expected: expectedId, found: meta.id })
      }

      textures[path] = { version: reader.assetVersion(path), settings: meta.importSettings }
    }),
  )

  return textures
}

// --- reading one document --------------------------------------------------

type Read<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'missing' }
  /** There is a file and this runtime cannot use it. One sentence, no punctuation. */
  | { kind: 'unreadable'; detail: string }

/**
 * One JSON file, parsed against the schema it is supposed to match.
 *
 * The format literal is checked *before* the schema's own message is reported,
 * because "that file is a prefab, not a level" is a sentence somebody can act on
 * and "expected 'kernel2d.scene'" is not — the same ordering the editor already
 * uses when it follows a reference. Everything else falls through to the first
 * validation issue, which is where a file broken by hand gets described.
 */
async function readDocument<T>(
  reader: ProjectReader,
  path: string,
  schema: z.ZodType<T>,
  expectedFormat: string,
  what: string,
): Promise<Read<T>> {
  let raw: unknown
  try {
    raw = await reader.readJson(path)
  } catch (error) {
    return { kind: 'unreadable', detail: messageOf(error) }
  }

  if (raw === null || raw === undefined) return { kind: 'missing' }

  const format = formatOf(raw)
  if (format !== null && format !== expectedFormat) {
    return { kind: 'unreadable', detail: `that file is a ${format}, not a ${what}` }
  }

  const parsed = schema.safeParse(raw)
  if (parsed.success) return { kind: 'ok', value: parsed.data }

  return { kind: 'unreadable', detail: `it is not a ${what} this runtime can read — ${firstIssueIn(parsed.error)}` }
}

/** What a document says it is, if it says anything. What a file *is* beats where it sits. */
function formatOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const format = (raw as { format?: unknown }).format
  return typeof format === 'string' ? format : null
}

function firstIssueIn(error: z.ZodError): string {
  const issue = error.issues[0]
  if (issue === undefined) return 'it did not match the format'
  const where = issue.path.length === 0 ? '' : ` at ${issue.path.join('.')}`
  return `${issue.message}${where}`
}

// --- saying what went wrong ------------------------------------------------

/**
 * One problem, as the sentence a human reads.
 *
 * It lives here rather than in the editor because a shipped game that cannot
 * find one of its own textures should be able to say so too — this is the
 * runtime describing its own trouble, not editor chrome.
 */
export function describeLoadProblem(problem: LoadProblem): string {
  const name = nameOf(problem.path)

  switch (problem.kind) {
    case 'prefab-missing':
      return `${name} is not in the project folder, so everything placed from it draws nothing. It is still referenced at ${problem.path}.`
    case 'prefab-unreadable':
      return `${name} could not be used as a prefab: ${problem.detail}.`
    case 'prefab-different-file':
      return `${name} is not the file this level was written against — it expected the one with id ${problem.expected} and found ${problem.found}. It is used anyway.`
    case 'texture-unannotated':
      return `${name} has no import settings beside it, so nothing knows its pivot or how it is cut into frames. Nothing is drawn for it.`
    case 'texture-unreadable':
      return `${name} cannot be drawn: ${problem.detail}.`
    case 'texture-not-a-texture':
      return `${name} cannot be drawn: its import settings say it is ${problem.type}, not a texture.`
    case 'texture-different-file':
      return `${name} is not the file this level was written against — it expected the one with id ${problem.expected} and found ${problem.found}. It is drawn anyway.`
  }
}

/**
 * Prefabs before textures, then by path.
 *
 * The order is prose rather than tidiness: an instance whose prefab has gone has
 * no texture *because of that*, so naming the texture first would send somebody
 * looking at the wrong file.
 */
function byUsefulness(a: LoadProblem, b: LoadProblem): number {
  const rank = (problem: LoadProblem): number => (problem.kind.startsWith('prefab-') ? 0 : 1)
  return rank(a) - rank(b) || a.path.localeCompare(b.path)
}

function nameOf(path: string): string {
  return path.split('/').at(-1) ?? path
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
