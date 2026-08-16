import { describe, expect, it } from 'vitest'

import { alreadyPlacedAt } from '../../editor/shell/place-into-scene'
import { instanceOfPrefab } from '../../runtime/formats/prefab-schema'
import { defaultEntity, type Entity } from '../../runtime/formats/scene-schema'

/**
 * The one rule a paint stroke adds to placing: the same thing is not put down
 * twice on one cell. What "the same thing" means is the whole of this file —
 * the same prefab by path, or the same texture on a plain sprite — and what it
 * does *not* mean is the other half: a different prefab, or the same picture
 * on an instance, still stacks.
 */

const ROAD = { id: 'road-id', path: 'prefabs/road.json' }
const WALL = { id: 'wall-id', path: 'prefabs/wall.json' }
const GRASS = { id: 'grass-id', path: 'assets/textures/grass.png' }

function instanceAt(source: { id: string; path: string }, x: number, y: number): Entity {
  const entity = instanceOfPrefab(`i${x}${y}`, 'Road', source)
  entity.transform.x = x
  entity.transform.y = y
  return entity
}

function spriteAt(texture: { id: string; path: string }, x: number, y: number): Entity {
  const entity = defaultEntity(`s${x}${y}`, 'Grass')
  entity.transform.x = x
  entity.transform.y = y
  entity.components['sprite'] = { texture }
  return entity
}

describe('whether a cell already holds the same thing', () => {
  it('finds an instance of the same prefab at exactly that position', () => {
    const level = [instanceAt(ROAD, 24, 8)]
    expect(alreadyPlacedAt(level, { x: 24, y: 8 }, { prefab: ROAD })).toBe(true)
    // Nearby is not there: a stroke stamps on cell centres, and a cell away is another cell.
    expect(alreadyPlacedAt(level, { x: 40, y: 8 }, { prefab: ROAD })).toBe(false)
  })

  it('lets a different prefab stack on the same cell, as it always has', () => {
    const level = [instanceAt(ROAD, 24, 8)]
    expect(alreadyPlacedAt(level, { x: 24, y: 8 }, { prefab: WALL })).toBe(false)
  })

  it('finds a plain sprite of the same texture, and not an instance wearing it', () => {
    const level = [spriteAt(GRASS, 24, 8)]
    expect(alreadyPlacedAt(level, { x: 24, y: 8 }, { texture: GRASS })).toBe(true)
    expect(alreadyPlacedAt(level, { x: 24, y: 8 }, { texture: { id: 'x', path: 'assets/textures/dirt.png' } })).toBe(false)

    // An instance that draws grass because its prefab does is a road, not a grass tile.
    const instance = instanceAt(ROAD, 24, 8)
    instance.components['sprite'] = { texture: GRASS }
    expect(alreadyPlacedAt([instance], { x: 24, y: 8 }, { texture: GRASS })).toBe(false)
    expect(alreadyPlacedAt([spriteAt(GRASS, 24, 8)], { x: 24, y: 8 }, { prefab: ROAD })).toBe(false)
  })

  it('finds nothing in an empty level', () => {
    expect(alreadyPlacedAt([], { x: 0, y: 0 }, { prefab: ROAD })).toBe(false)
  })
})
