import { instanceOfPrefab, type Prefab } from '../../runtime/formats/prefab-schema'
import {
  defaultEntity,
  prefabRefOf,
  SCENE_FORMAT,
  spriteOf,
  type AssetRef,
  type Entity,
} from '../../runtime/formats/scene-schema'
import type { Point } from '../../runtime/scene/coordinates'
import type { Document, EditRun } from '../store/documents'
import { editDocument } from '../store/open-documents'
import { mintId } from '../store/ids'
import { freeName, namesIn } from './entity-names'
import { placeOn, type Snap } from './snap'

/**
 * The two ways something new arrives in a level: a copy of a prefab, and an
 * entity that draws a picture.
 *
 * **Here rather than in either caller, because each of them now has two.**
 * Placing a prefab is a button in the Inspector, a mode in the viewport, and a
 * file dropped on the picture; making an entity that draws a texture is the
 * Outliner's Add followed by a pick, and a file dropped on the picture. Two
 * copies of "what a placed instance is" is two chances to write one that copies
 * the prefab's components instead of pointing at it — which would look identical
 * on the day it was written and stop following the prefab the day after
 * (`editor-ui` U24, and the same reasoning as `useDuplicateEntity`).
 *
 * Both are plain functions rather than hooks: everything they need is an
 * argument, so the caller that has a prefab in the document store and the caller
 * that has just read one off disk can both use them. Neither selects what it
 * made — what is selected afterwards is not part of the edit (`editor-ui` U8),
 * and the callers disagree about it: a drop selects, repeat-placing must not.
 *
 * Neither contains any undo code. Both go through the transaction API, so one
 * drop is one press of Ctrl-Z (`editor-kernel` D7).
 *
 * Both land through `placeOn` with the modifier off, which is not a shrug: a
 * drop and a stamp are single presses with no held key to read, so the toggle in
 * the viewport bar is the whole answer for them. Going through the same door as
 * a drag anyway is what makes switching that toggle off change *every* way of
 * putting something down, rather than the one the human happened to test.
 *
 * **A stroke goes through the same two functions, twice over.** A paint stroke
 * (`usePlacePrefab.ts`) stamps one copy per grid cell for as long as the hand
 * is down, and each stamp is this recipe exactly — same name rule, same order,
 * same reference — written through the stroke's open *run* rather than a
 * transaction of its own, so the whole stroke is one press of Ctrl-Z. And a
 * stroke declines to put a second copy of the same thing on a cell that has one
 * (`alreadyPlacedAt`): painting back over your own road must not double it. A
 * different prefab on the same cell still stacks, as it always has — what is
 * skipped is only *the same thing in the same place*.
 */

/** Where a placement is written: a transaction of its own, or a stroke's open run. */
export type PlaceInto = { run: EditRun } | undefined

/**
 * Whether the level already holds this thing at exactly this snapped position:
 * an instance of the same prefab, or a plain sprite of the same texture. Read
 * off the entities the way the panels read them, so it agrees with what is on
 * screen.
 */
export function alreadyPlacedAt(
  entities: readonly Entity[],
  at: Point,
  what: { prefab: AssetRef } | { texture: AssetRef },
): boolean {
  return entities.some((entity) => {
    if (entity.transform.x !== at.x || entity.transform.y !== at.y) return false
    if ('prefab' in what) return prefabRefOf(entity)?.path === what.prefab.path
    // A plain sprite: draws this texture and is not an instance of anything.
    return prefabRefOf(entity) === null && spriteOf(entity)?.texture.path === what.texture.path
  })
}

/** Where a new thing landed and what it is called, for whoever has to say so. */
export interface Placed {
  entity: string
  name: string
}

/**
 * One instance of a prefab, by reference.
 *
 * **It writes a reference and nothing else.** Copying the prefab's components in
 * at placement time would look identical on the day it was placed and stop
 * following the prefab the day after, which is the one thing placing by
 * reference is for.
 */
export function placePrefabInstance({
  scenePath,
  prefabPath,
  prefab,
  at,
  snap,
  into,
  unlessAlreadyThere = false,
}: {
  scenePath: string
  prefabPath: string
  prefab: Prefab
  at: Point
  snap: Snap
  /** A stroke's open run, or nothing for a transaction of its own. */
  into?: PlaceInto
  /** Skip if the level already has this prefab at the landing — a stroke's rule. */
  unlessAlreadyThere?: boolean
}): Placed | null {
  const landing = placeOn(at, snap, false)
  const id = mintId()
  let name = ''
  let placed = false

  write(scenePath, { label: 'Place prefab' }, into, (document) => {
    if (document.format !== SCENE_FORMAT) return
    const source = { id: prefab.id, path: prefabPath }
    if (unlessAlreadyThere && alreadyPlacedAt(document.entities, landing, { prefab: source })) return
    name = nextName(document.entities, prefab.name, 'Instance')
    const entity = instanceOfPrefab(id, name, source)
    entity.transform.x = landing.x
    entity.transform.y = landing.y
    document.entities.push(entity)
    placed = true
  })

  return placed ? { entity: id, name } : null
}

/**
 * A new entity that draws one texture.
 *
 * The sprite component is written exactly as the Inspector's picker writes it —
 * a whole D5 reference, id and path together — because half a reference looks
 * identical today and loses the half that survives a rename.
 */
export function placeSpriteEntity({
  scenePath,
  texture,
  stem,
  at,
  snap,
  into,
  unlessAlreadyThere = false,
}: {
  scenePath: string
  texture: AssetRef
  /** What to call it before a number is added: the file's name, less extension. */
  stem: string
  at: Point
  snap: Snap
  into?: PlaceInto
  unlessAlreadyThere?: boolean
}): Placed | null {
  const landing = placeOn(at, snap, false)
  const id = mintId()
  let name = ''
  let placed = false

  write(scenePath, { label: 'Add entity' }, into, (document) => {
    if (document.format !== SCENE_FORMAT) return
    if (unlessAlreadyThere && alreadyPlacedAt(document.entities, landing, { texture })) return
    name = nextName(document.entities, stem, 'Entity')
    const entity = defaultEntity(id, name)
    entity.transform.x = landing.x
    entity.transform.y = landing.y
    entity.components['sprite'] = { texture }
    document.entities.push(entity)
    placed = true
  })

  return placed ? { entity: id, name } : null
}

/** One door for both: a transaction of its own, or an edit in the stroke's run. */
function write(
  scenePath: string,
  intent: { label: string },
  into: PlaceInto,
  recipe: (document: Document) => void,
): void {
  if (into === undefined) editDocument(scenePath, intent, recipe)
  else into.run.edit(scenePath, recipe)
}

/**
 * What a new thing is called: the name it came with, then a number.
 *
 * Counting within the level rather than across the project, because "Slime 2"
 * should mean the second one here and not the second one ever placed. The bare
 * name is offered first, so the only slime in a level is just "Slime".
 */
function nextName(entities: readonly Entity[], wanted: string, fallback: string): string {
  const stem = wanted.trim() === '' ? fallback : wanted.trim()
  return freeName(namesIn(entities), stem, { bare: true })
}
