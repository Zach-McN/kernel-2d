import { descendantsOf, type Entity, type Transform } from '../../runtime/formats/scene-schema'
import { lineageOf, localTransformOf, worldTransformOf } from '../../runtime/scene/coordinates'
import { freely } from './snap'

/**
 * Moving a row in the Outliner — the arithmetic, on its own.
 *
 * `rotate.ts` and `scale.ts` are the pattern: the part with the traps in it is
 * a pure function over plain objects, unit-tested without a browser, and the
 * panel that calls it is left with the events. Imported from the coordinates
 * module directly rather than through `runtime/index.ts`, which would load
 * Phaser and put this out of a unit test's reach.
 *
 * **What a row carries.** An entity's row and the rows of everything attached to
 * it move as one block, in the order the list has them: a parent dragged
 * somewhere else takes its children along, in front of it, exactly as it takes
 * them along in the picture. The block keeps its own internal order, so what was
 * drawn in front of what inside it stays that way.
 *
 * **What a slot means.** Letting go on the upper part of a row puts the block
 * *before* that row as its sibling — attached to whatever that row is attached
 * to. The lower part puts it *after* the row's own block, again as a sibling.
 * The middle attaches it *to* the row, as the last of its children. Below the
 * last row is the top level, at the end. So dragging a child out between two
 * top-level rows detaches it, and dragging a top-level row between two children
 * attaches it — the slot says where the row will sit, and where it sits says
 * what it belongs to. There is no gesture that leaves a row somewhere its
 * indentation would lie about.
 *
 * **Attaching keeps the entity where it appears.** A parent change rewrites the
 * stored transform as the offset that lands the entity on the same spot, at the
 * same angle and size (`localTransformOf`); detaching writes its place in the
 * level back. Nothing jumps, and the children below it are not touched at all —
 * their offsets are from *it*, and it has not moved. The numbers are rounded to
 * the thousandth the gestures already round to, so a level does not fill up
 * with `0.30000000000000004` because somebody attached a coin to a block.
 *
 * **A drop that would change nothing answers null**, and the panel draws no line
 * for it — a line is a promise that something will happen (`editor-ui` U37).
 * That covers a row let go on itself or on one of its own descendants (an
 * entity cannot be attached below itself) as well as a slot that is where the
 * block already is.
 */

/** Where a dragged block would go. `before`/`after` make it a sibling of that row; `into` a child of it. */
export type Slot =
  | { kind: 'before'; id: string }
  | { kind: 'after'; id: string }
  | { kind: 'into'; id: string }
  | { kind: 'end' }

/** What a move did — which is also which undo label it earns. */
export type MoveOutcome = 'attached' | 'detached' | 'reordered'

/** The entity's own row and the rows of everything attached to it, in list order. */
export function blockOf(entities: readonly Entity[], id: string): Entity[] {
  const root = entities.find((entity) => entity.id === id)
  if (root === undefined) return []
  return [root, ...descendantsOf(entities, id)]
}

/**
 * Moves the block at `id` to `slot`, in place, and says what that amounted to —
 * or null, having touched nothing, when the drop would change nothing.
 *
 * Written against a mutable list because the caller's list is an immer draft
 * inside a transaction; asking about a drop without performing it is
 * `outcomeOf`, which runs this on a copy.
 */
export function moveBlock(list: Entity[], id: string, slot: Slot): MoveOutcome | null {
  const dragged = list.find((entity) => entity.id === id)
  if (dragged === undefined) return null

  const block = blockOf(list, id)
  const carried = new Set(block.map((entity) => entity.id))

  const target = slot.kind === 'end' ? null : (list.find((entity) => entity.id === slot.id) ?? null)
  if (slot.kind !== 'end' && (target === null || carried.has(target.id))) return null

  const newParent = slot.kind === 'into' ? (target as Entity).id : slot.kind === 'end' ? undefined : target?.parent
  const parentChanged = newParent !== dragged.parent

  // Where the entity is, and where its new parent is, measured before anything
  // moves: neither depends on list order, and the parent is not in the block.
  const worldBefore = worldTransformOf(dragged, list)
  const parentEntity = newParent === undefined ? null : (list.find((entity) => entity.id === newParent) ?? null)
  const parentWorld = parentEntity === null ? null : worldTransformOf(parentEntity, list)

  const before = list.map((entity) => entity.id)

  // Out, then back in at the slot as it reads once the block is out of the way.
  const remaining = list.filter((entity) => !carried.has(entity.id))
  let at: number
  if (slot.kind === 'end') {
    at = remaining.length
  } else if (slot.kind === 'before') {
    at = remaining.findIndex((entity) => entity.id === slot.id)
  } else {
    // After the row's whole block — `into` is "after the last child", which is
    // the same place.
    const rows = blockOf(remaining, slot.id)
    const last = rows[rows.length - 1] as Entity
    at = remaining.findIndex((entity) => entity.id === last.id) + 1
  }
  remaining.splice(at, 0, ...block)

  const after = remaining.map((entity) => entity.id)
  const orderChanged = before.some((one, index) => one !== after[index])
  if (!orderChanged && !parentChanged) return null

  list.splice(0, list.length, ...remaining)

  if (parentChanged) {
    if (newParent === undefined) delete dragged.parent
    else dragged.parent = newParent
    dragged.transform = rounded(parentWorld === null ? worldBefore : localTransformOf(worldBefore, parentWorld))
  }

  if (!parentChanged) return 'reordered'
  return newParent === undefined ? 'detached' : 'attached'
}

/** What `moveBlock` would do, without doing it. */
export function outcomeOf(entities: readonly Entity[], id: string, slot: Slot): MoveOutcome | null {
  return moveBlock(
    entities.map((entity) => ({ ...entity })),
    id,
    slot,
  )
}

/**
 * The arrows: the block past its previous or next sibling's block. Never across
 * a parent — an arrow reorders, it does not attach — so the first child pressing
 * ↑ goes nowhere, exactly as the first row always has.
 */
export function moveAmongSiblings(list: Entity[], id: string, by: -1 | 1): MoveOutcome | null {
  const neighbour = siblingOf(list, id, by)
  if (neighbour === null) return null
  return moveBlock(list, id, by < 0 ? { kind: 'before', id: neighbour.id } : { kind: 'after', id: neighbour.id })
}

/** The sibling an arrow would move past, or null when there is none that way. */
export function siblingOf(entities: readonly Entity[], id: string, by: -1 | 1): Entity | null {
  const entity = entities.find((one) => one.id === id)
  if (entity === undefined) return null
  const siblings = entities.filter((one) => one.parent === entity.parent)
  const at = siblings.findIndex((one) => one.id === id)
  return siblings[at + by] ?? null
}

/** The undo label a move earns. */
export function labelOf(outcome: MoveOutcome): string {
  switch (outcome) {
    case 'attached':
      return 'Attach entity'
    case 'detached':
      return 'Detach entity'
    case 'reordered':
      return 'Reorder entity'
  }
}

// --- a gesture on a child ---------------------------------------------------

/**
 * Which members of a group a gesture writes: those with no *other* member above
 * them. A child whose parent is also selected rides its parent — writing it too
 * would move it twice, once for itself and once for being carried.
 */
export function writtenOf(entities: readonly Entity[], ids: readonly string[]): Entity[] {
  const group = new Set(ids)
  return entities.filter((entity) => {
    if (!group.has(entity.id)) return false
    const above = lineageOf(entity, entities).slice(1)
    return !above.some((ancestor) => group.has(ancestor.id))
  })
}

/** Where an entity's parent is in the level, or null when it has none it can follow. */
export function parentWorldOf(entity: Entity, entities: readonly Entity[]): Transform | null {
  const parent = lineageOf(entity, entities)[1]
  return parent === undefined ? null : worldTransformOf(parent, entities)
}

/**
 * The numbers to store so that an entity lands *here* in the level: the place
 * itself for a root, and the offset under its parent for a child — rounded, as
 * every gesture's write is.
 */
export function storedFor(world: Transform, parentWorld: Transform | null): Transform {
  return rounded(parentWorld === null ? world : localTransformOf(world, parentWorld))
}

function rounded(transform: Transform): Transform {
  return {
    x: freely(transform.x),
    y: freely(transform.y),
    rotation: freely(transform.rotation),
    scaleX: freely(transform.scaleX),
    scaleY: freely(transform.scaleY),
  }
}
