import { describe, expect, it } from 'vitest'

import { defaultEntity, type Entity } from '../../runtime/formats/scene-schema'
import { worldTransformOf } from '../../runtime/scene/coordinates'
import { blockOf, labelOf, moveAmongSiblings, moveBlock, outcomeOf, siblingOf } from '../../editor/shell/reparent'

/**
 * Moving a row in the Outliner, held to the three things the Outliner promises
 * about it: a row carries what is attached to it, attaching something never
 * moves it in the picture, and a drop that would change nothing is refused
 * rather than recorded.
 */

function at(id: string, name: string, x: number, y: number, rotation = 0, parent?: string): Entity {
  const entity: Entity = { ...defaultEntity(id, name), transform: { x, y, rotation, scaleX: 1, scaleY: 1 } }
  if (parent !== undefined) entity.parent = parent
  return entity
}

/** Ground, then a block with a coin on it and an arm with a fire on the arm, then a cloud. */
function level(): Entity[] {
  return [
    at('ground', 'Ground', 0, 0),
    at('block', 'Block', 100, 50, 90),
    at('coin', 'Coin', 0, 16, 0, 'block'),
    at('arm', 'Arm', 0, 0, 0, 'block'),
    at('fire', 'Fire', 24, 0, 0, 'arm'),
    at('cloud', 'Cloud', 300, 200),
  ]
}

const order = (list: readonly Entity[]): string[] => list.map((entity) => entity.id)

describe('what a row carries', () => {
  it('is the entity and everything attached to it, in list order', () => {
    expect(order(blockOf(level(), 'block'))).toEqual(['block', 'coin', 'arm', 'fire'])
    expect(order(blockOf(level(), 'arm'))).toEqual(['arm', 'fire'])
    expect(order(blockOf(level(), 'cloud'))).toEqual(['cloud'])
  })
})

describe('attaching', () => {
  it('puts a row let go on another under it, as its last child, and says so', () => {
    const list = level()
    expect(moveBlock(list, 'cloud', { kind: 'into', id: 'block' })).toBe('attached')
    expect(order(list)).toEqual(['ground', 'block', 'coin', 'arm', 'fire', 'cloud'])
    expect(list.find((entity) => entity.id === 'cloud')?.parent).toBe('block')
  })

  it('keeps the entity exactly where it appeared, whatever the parent is turned to', () => {
    const list = level()
    const before = worldTransformOf(list[5] as Entity, list)
    moveBlock(list, 'cloud', { kind: 'into', id: 'block' })
    const cloud = list.find((entity) => entity.id === 'cloud') as Entity
    const after = worldTransformOf(cloud, list)
    expect(after.x).toBeCloseTo(before.x, 3)
    expect(after.y).toBeCloseTo(before.y, 3)
    expect(after.rotation).toBeCloseTo(before.rotation, 3)
    // The stored numbers are now an offset from a block at (100, 50) turned a
    // quarter turn: 150 across becomes 150 up the block's own axis.
    expect(cloud.transform).toEqual({ x: 150, y: -200, rotation: -90, scaleX: 1, scaleY: 1 })
  })

  it('writes readable numbers, not floating-point noise', () => {
    const list = [at('a', 'A', 0.1, 0.2, 37), at('b', 'B', 0.3, 0.4)]
    moveBlock(list, 'b', { kind: 'into', id: 'a' })
    const written = JSON.stringify(list[1]?.transform)
    expect(written).not.toMatch(/\d{7,}/)
  })

  it('takes the children along without touching their offsets', () => {
    const list = level()
    const fireBefore = { ...(list[4] as Entity).transform }
    moveBlock(list, 'arm', { kind: 'into', id: 'ground' })
    expect(order(list)).toEqual(['ground', 'arm', 'fire', 'block', 'coin', 'cloud'])
    expect(list.find((entity) => entity.id === 'fire')?.transform).toEqual(fireBefore)
    expect(list.find((entity) => entity.id === 'fire')?.parent).toBe('arm')
  })

  it('makes a row let go beside a child a child too — the slot says what it belongs to', () => {
    const list = level()
    expect(moveBlock(list, 'cloud', { kind: 'before', id: 'arm' })).toBe('attached')
    expect(order(list)).toEqual(['ground', 'block', 'coin', 'cloud', 'arm', 'fire'])
    expect(list.find((entity) => entity.id === 'cloud')?.parent).toBe('block')
  })

  it('refuses to attach an entity below itself', () => {
    const list = level()
    expect(moveBlock(list, 'block', { kind: 'into', id: 'fire' })).toBeNull()
    expect(moveBlock(list, 'block', { kind: 'before', id: 'coin' })).toBeNull()
    expect(moveBlock(list, 'block', { kind: 'into', id: 'block' })).toBeNull()
    expect(order(list)).toEqual(order(level()))
  })
})

describe('detaching', () => {
  it('puts a child let go between two top-level rows at the top level, where it appeared', () => {
    const list = level()
    const before = worldTransformOf(list[2] as Entity, list)
    expect(moveBlock(list, 'coin', { kind: 'before', id: 'cloud' })).toBe('detached')
    const coin = list.find((entity) => entity.id === 'coin') as Entity
    expect(coin.parent).toBeUndefined()
    expect('parent' in coin).toBe(false)
    expect(coin.transform.x).toBeCloseTo(before.x, 3)
    expect(coin.transform.y).toBeCloseTo(before.y, 3)
    expect(order(list)).toEqual(['ground', 'block', 'arm', 'fire', 'coin', 'cloud'])
  })

  it('puts a child let go below the last row at the very end, at the top level', () => {
    const list = level()
    expect(moveBlock(list, 'arm', { kind: 'end' })).toBe('detached')
    expect(order(list)).toEqual(['ground', 'block', 'coin', 'cloud', 'arm', 'fire'])
  })
})

describe('reordering', () => {
  it('moves a whole block past another, and keeps every parent', () => {
    const list = level()
    expect(moveBlock(list, 'block', { kind: 'after', id: 'cloud' })).toBe('reordered')
    expect(order(list)).toEqual(['ground', 'cloud', 'block', 'coin', 'arm', 'fire'])
  })

  it('lets go after a row means after that row and everything attached to it', () => {
    const list = level()
    expect(moveBlock(list, 'ground', { kind: 'after', id: 'block' })).toBe('reordered')
    expect(order(list)).toEqual(['block', 'coin', 'arm', 'fire', 'ground', 'cloud'])
  })

  it('answers null, and moves nothing, for a slot that is where the block already is', () => {
    const list = level()
    expect(moveBlock(list, 'block', { kind: 'before', id: 'block' })).toBeNull()
    expect(moveBlock(list, 'block', { kind: 'after', id: 'ground' })).toBeNull()
    expect(moveBlock(list, 'cloud', { kind: 'end' })).toBeNull()
    expect(moveBlock(list, 'fire', { kind: 'into', id: 'arm' })).toBeNull()
    expect(list).toEqual(level())
  })

  it('can be asked about without being done', () => {
    const list = level()
    expect(outcomeOf(list, 'cloud', { kind: 'into', id: 'block' })).toBe('attached')
    expect(outcomeOf(list, 'coin', { kind: 'end' })).toBe('detached')
    expect(outcomeOf(list, 'cloud', { kind: 'end' })).toBeNull()
    expect(list).toEqual(level())
  })
})

describe('the arrows', () => {
  it('move a row past its sibling, block and all', () => {
    const list = level()
    expect(moveAmongSiblings(list, 'arm', -1)).toBe('reordered')
    expect(order(list)).toEqual(['ground', 'block', 'arm', 'fire', 'coin', 'cloud'])
  })

  it('never cross a parent: the first child has nowhere up to go, nor the last child down', () => {
    const list = level()
    expect(siblingOf(list, 'coin', -1)).toBeNull()
    expect(siblingOf(list, 'arm', 1)).toBeNull()
    expect(moveAmongSiblings(list, 'coin', -1)).toBeNull()
    expect(order(list)).toEqual(order(level()))
  })

  it('at the top level are exactly what they always were', () => {
    const list = level()
    expect(siblingOf(list, 'cloud', -1)?.id).toBe('block')
    expect(moveAmongSiblings(list, 'cloud', -1)).toBe('reordered')
    expect(order(list)).toEqual(['ground', 'cloud', 'block', 'coin', 'arm', 'fire'])
  })
})

describe('what a move is called', () => {
  it('names each outcome as one undo step', () => {
    expect(labelOf('attached')).toBe('Attach entity')
    expect(labelOf('detached')).toBe('Detach entity')
    expect(labelOf('reordered')).toBe('Reorder entity')
  })
})
