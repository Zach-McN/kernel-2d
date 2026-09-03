import { describedReferencesOf, type ComponentDescription } from '../../runtime/formats/component-schema'
import { PREFAB_FORMAT } from '../../runtime/formats/prefab-schema'
import { PROJECT_FORMAT } from '../../runtime/formats/project-schema'
import {
  COMPONENT_REFERENCE_FIELDS,
  SCENE_FORMAT,
  assetRefsOf,
  isKnownComponentType,
  type ComponentHolder,
} from '../../runtime/formats/scene-schema'
import type { EditorDocument } from '../../sidecar/document-view-schema'
import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema'
import { couldBeDocument } from './asset-kinds'

/**
 * Which documents point at a file, and the same documents with that file's new
 * path written in.
 *
 * The two questions a rename has to answer, and they are one walk: *what would
 * this break* and *what has to change*. Deleting asks the first on its own, which
 * is why they are separate functions over the same rule rather than one function
 * that both reports and rewrites.
 *
 * **Where a reference lives is not decided here.** For the components the kernel
 * owns it is `COMPONENT_REFERENCE_FIELDS` in the scene format, beside the
 * registry that says what a component is, so a genre layer whose component
 * points at a file gets this for free (`text-formats` T12's registry, one use
 * further on). For the components a *game* describes it is the description
 * itself, asked through `describedReferencesOf` — the same fact stated by the
 * other format. So the callers hand in the project's descriptions, and a
 * described `asset` or `scene` field is counted and rewritten exactly as a
 * sprite's texture is. What this file owns is the *document* level: a scene's
 * entities, a prefab's own components, and the one field in the project
 * settings that names a level.
 *
 * Three things that are easy to get wrong and are settled here once.
 *
 *   1. **Only `path` is ever rewritten. `id` never is.** A file moved from inside
 *      the editor takes its `.meta` with it, so the id a reference recorded is
 *      still the id of the file at the new path — the witness is still correct
 *      and rewriting it would be inventing agreement rather than preserving it.
 *
 *   2. **A folder and a file are one rule.** A target matches a reference whose
 *      path *is* it or sits under it, so renaming `assets/textures` rewrites a
 *      hundred references with the same three lines that rewrite one. A file has
 *      nothing under it, so the second half never fires for one.
 *
 *   3. **The rewrite walks the raw values on a copy, and returns null when
 *      nothing changed.** Raw, because the typed readers hand back validated
 *      *copies* and assigning to one of those would change nothing on disk. On a
 *      copy, because the document being rewritten may be the one the store is
 *      holding. Null, because a document with nothing to change must not be
 *      written at all — a needless write would churn a file the human did not
 *      touch, and `editor-verification` V22's fingerprint assertions are exactly
 *      about the neighbour that should not have moved.
 */

/**
 * The new path for a reference, or null when this reference is not about the
 * file that moved.
 *
 * Exported because the shell needs the same rule for what it is *looking* at —
 * the selected file, the open level — not only for what is written in a document.
 */
export function movedPath(path: string, from: string, to: string): string | null {
  if (!pointsAt(path, from)) return null
  return path === from ? to : `${to}${path.slice(from.length)}`
}

/** Whether this path names the target, or something inside it when it is a folder. */
export function pointsAt(path: string, target: string): boolean {
  return path === target || path.startsWith(`${target}/`)
}

/** Every `.json` in the project, in the order the folder lists them. */
export function documentPathsIn(tree: ProjectTree): string[] {
  const found: string[] = []

  const walk = (node: TreeNode): void => {
    if (node.kind === 'file') {
      if (couldBeDocument(node.name)) found.push(node.path)
      return
    }
    for (const child of node.children) walk(child)
  }

  walk(tree.tree)
  return found
}

/** The game's own component descriptions, by type — what says where a described reference is. */
export type Described = Readonly<Record<string, ComponentDescription>>

/**
 * How many times this document points at that file, or at anything under it.
 *
 * A count rather than a boolean because "still used by 2 files" and "used 7
 * times" are both worth saying before something is deleted, and the second
 * cannot be recovered from the first.
 */
export function usesOf(document: EditorDocument, target: string, described: Described = {}): number {
  if (document.format === PROJECT_FORMAT) {
    return document.startupScene !== null && pointsAt(document.startupScene, target) ? 1 : 0
  }

  if (document.format === PREFAB_FORMAT) {
    // The prefab's own components, and every part's.
    return (document.children ?? []).reduce(
      (total, part) => total + usesIn(part, target, described),
      usesIn(document, target, described),
    )
  }

  if (document.format === SCENE_FORMAT) {
    // The level's own music, plus every reference its entities carry.
    const music = document.music !== undefined && pointsAt(document.music.path, target) ? 1 : 0
    return music + document.entities.reduce((total, entity) => total + usesIn(entity, target, described), 0)
  }

  return 0
}

/** The kernel's own references on one component map, plus the described ones. */
function usesIn(holder: ComponentHolder, target: string, described: Described): number {
  return countIn(assetRefsOf(holder), target) + countIn(describedPathsOf(holder, described), target)
}

function countIn(refs: readonly { path: string }[], target: string): number {
  return refs.filter((ref) => pointsAt(ref.path, target)).length
}

/**
 * Every path a described component on this map holds: an asset field's `path`,
 * a scene field's string. Read raw off the map, exactly as `assetRefsOf` reads
 * the kernel's, and anything at a described field that is not the shape the
 * description promised is skipped — this answers "what does this point at", and
 * a value the panel would show as wrong points at nothing.
 */
function describedPathsOf(holder: ComponentHolder, described: Described): { path: string }[] {
  const found: { path: string }[] = []
  for (const [type, description] of Object.entries(described)) {
    // A description of a type the kernel owns changes nothing here: those
    // references are already `COMPONENT_REFERENCE_FIELDS`' business.
    if (isKnownComponentType(type)) continue
    const component = holder.components[type]
    if (component === null || typeof component !== 'object') continue
    const held = component as Record<string, unknown>

    for (const reference of describedReferencesOf(description)) {
      const path = pathAt(held[reference.key], reference.kind)
      if (path !== null) found.push({ path })
    }
  }
  return found
}

/** The path a described reference holds, or null when it holds nothing usable. */
function pathAt(value: unknown, kind: 'asset' | 'scene'): string | null {
  if (kind === 'scene') return typeof value === 'string' && value.length > 0 ? value : null
  if (value === null || typeof value !== 'object') return null
  const path = (value as Record<string, unknown>)['path']
  return typeof path === 'string' && path.length > 0 ? path : null
}

/**
 * The same document with every reference to `from` pointing at `to`, or null
 * when it referenced nothing that moved.
 *
 * Deep-copied through JSON rather than `structuredClone` for the reason
 * `copyEntity` is (`editor-kernel` G12): a document is JSON by definition, so the
 * round trip is faithful by construction, and this may be handed a value the
 * store has frozen. Nothing is rebuilt field by field, so a key a human added and
 * a component this kernel has never heard of both survive (`text-formats` T9).
 */
export function rewriteReferences(
  document: EditorDocument,
  from: string,
  to: string,
  described: Described = {},
): EditorDocument | null {
  const copy = JSON.parse(JSON.stringify(document)) as EditorDocument

  if (copy.format === PROJECT_FORMAT) {
    if (copy.startupScene === null) return null
    const moved = movedPath(copy.startupScene, from, to)
    if (moved === null) return null
    copy.startupScene = moved
    return copy
  }

  if (copy.format === PREFAB_FORMAT) {
    let changed = rewriteHolder(copy.components, from, to, described)
    for (const part of copy.children ?? []) {
      if (rewriteHolder(part.components, from, to, described)) changed = true
    }
    return changed ? copy : null
  }

  if (copy.format === SCENE_FORMAT) {
    let changed = false
    if (copy.music !== undefined) {
      const moved = movedPath(copy.music.path, from, to)
      if (moved !== null) {
        // The address moves; the witness never does, exactly as below.
        copy.music.path = moved
        changed = true
      }
    }
    for (const entity of copy.entities) {
      if (rewriteHolder(entity.components, from, to, described)) changed = true
    }
    return changed ? copy : null
  }

  return null
}

/** Rewrites every reference on one component map in place. True if any moved. */
function rewriteHolder(
  components: Record<string, unknown>,
  from: string,
  to: string,
  described: Described,
): boolean {
  let changed = false

  for (const [type, field] of Object.entries(COMPONENT_REFERENCE_FIELDS)) {
    if (field === undefined) continue

    const component = components[type]
    if (component === null || typeof component !== 'object') continue

    if (rewriteAssetRef((component as Record<string, unknown>)[field], from, to)) changed = true
  }

  for (const [type, description] of Object.entries(described)) {
    if (isKnownComponentType(type)) continue

    const component = components[type]
    if (component === null || typeof component !== 'object') continue
    const held = component as Record<string, unknown>

    for (const reference of describedReferencesOf(description)) {
      if (reference.kind === 'asset') {
        if (rewriteAssetRef(held[reference.key], from, to)) changed = true
        continue
      }
      // A scene is its path alone (`text-formats` T15/T20): the whole value moves.
      const scene = held[reference.key]
      if (typeof scene !== 'string') continue
      const moved = movedPath(scene, from, to)
      if (moved === null) continue
      held[reference.key] = moved
      changed = true
    }
  }

  return changed
}

/** Rewrites one `{ id, path }` in place if it points at what moved. True if it did. */
function rewriteAssetRef(reference: unknown, from: string, to: string): boolean {
  if (reference === null || typeof reference !== 'object') return false

  const held = reference as Record<string, unknown>
  if (typeof held['path'] !== 'string') return false

  const moved = movedPath(held['path'], from, to)
  if (moved === null) return false

  // The path is the address and the id is the witness. Only the address moved.
  held['path'] = moved
  return true
}
