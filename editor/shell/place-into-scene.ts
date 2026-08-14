import { instanceOfPrefab, type Prefab } from '../../runtime/formats/prefab-schema'
import { defaultEntity, SCENE_FORMAT, type AssetRef, type Entity } from '../../runtime/formats/scene-schema'
import type { Point } from '../../runtime/scene/coordinates'
import { mintId } from '../store/ids'
import { editDocument } from '../store/open-documents'
import { freeName, namesIn } from './entity-names'
import { snapPoint, type Snap } from './snap'

/**
 * The two ways something new arrives in a level: a copy of a prefab, and an
 * entity that draws a picture.
 *
 * **Here rather than in either caller, because each of them now has two.**
 * Placing a prefab is a button in the Inspector, a mode in the viewport, and a
 * file dropped on the picture; making an entity that draws a texture is the
 * Hierarchy's Add followed by a pick, and a file dropped on the picture. Two
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
 */

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
}: {
  scenePath: string
  prefabPath: string
  prefab: Prefab
  at: Point
  snap: Snap
}): Placed {
  const landing = snapPoint(at, snap)
  const id = mintId()
  let name = ''

  editDocument(scenePath, { label: 'Place prefab' }, (document) => {
    if (document.format !== SCENE_FORMAT) return
    name = nextName(document.entities, prefab.name, 'Instance')
    const entity = instanceOfPrefab(id, name, { id: prefab.id, path: prefabPath })
    entity.transform.x = landing.x
    entity.transform.y = landing.y
    document.entities.push(entity)
  })

  return { entity: id, name }
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
}: {
  scenePath: string
  texture: AssetRef
  /** What to call it before a number is added: the file's name, less extension. */
  stem: string
  at: Point
  snap: Snap
}): Placed {
  const landing = snapPoint(at, snap)
  const id = mintId()
  let name = ''

  editDocument(scenePath, { label: 'Add entity' }, (document) => {
    if (document.format !== SCENE_FORMAT) return
    name = nextName(document.entities, stem, 'Entity')
    const entity = defaultEntity(id, name)
    entity.transform.x = landing.x
    entity.transform.y = landing.y
    entity.components['sprite'] = { texture }
    document.entities.push(entity)
  })

  return { entity: id, name }
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
