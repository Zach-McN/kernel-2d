import { describe, expect, it } from 'vitest'

import { defaultEntity, type Entity } from '../../runtime/formats/scene-schema'
import { CAMERA_ENTITY_ID, aimCamera, cameraIn } from '../../runtime/game/camera'
import { STEP_MS } from '../../runtime/game/loop'
import { runLevel } from '../../runtime/game/run-level'
import type { System } from '../../runtime/game/system'
import { handCrankedFrames } from './hand-cranked-frames.js'

/**
 * The camera seam: a system aims the view, the host is told, and the ask never
 * reaches the picture. Same shape as the door's suite — half of these need no
 * runner, because the ask is an ordinary entity.
 */

function chaser(x: number, y: number): System {
  return {
    id: 'chaser',
    step: (entities) => {
      aimCamera(entities, { x, y })
    },
  }
}

describe('the ask as an entity', () => {
  it('reads back what was aimed', () => {
    const entities: Entity[] = []
    aimCamera(entities, { x: 120, y: 56 })
    expect(cameraIn(entities)).toEqual({ x: 120, y: 56 })
  })

  it('re-aims the standing ask rather than pushing a second one', () => {
    const entities: Entity[] = []
    aimCamera(entities, { x: 1, y: 1 })
    aimCamera(entities, { x: 2, y: 3 })
    expect(entities).toHaveLength(1)
    expect(cameraIn(entities)).toEqual({ x: 2, y: 3 })
  })

  it('answers null when nothing is asking, and for an ask somebody mangled', () => {
    expect(cameraIn([defaultEntity('abc123', 'Slime')])).toBeNull()
    const entities: Entity[] = []
    aimCamera(entities, { x: 1, y: 1 })
    const standing = entities.find((one) => one.id === CAMERA_ENTITY_ID)
    if (standing !== undefined) standing.components['camera'] = { focus: { x: 'here' } }
    expect(cameraIn(entities)).toBeNull()
  })
})

describe('the runner telling the host', () => {
  it('tells the host before the same frame is drawn', () => {
    const frames = handCrankedFrames()
    const order: string[] = []

    runLevel({
      entities: [],
      systems: [chaser(40, 72)],
      onFrame: frames.onFrame,
      camera: (focus) => order.push(`camera ${focus.x},${focus.y}`),
      draw: () => order.push('draw'),
    })
    frames.frame(STEP_MS)

    expect(order).toEqual(['camera 40,72', 'draw'])
  })

  it('follows a moving ask, frame after frame', () => {
    const frames = handCrankedFrames()
    const heard: number[] = []
    let wanted = 10

    runLevel({
      entities: [],
      systems: [
        {
          id: 'walker',
          step: (entities) => {
            wanted += 5
            aimCamera(entities, { x: wanted, y: 0 })
          },
        },
      ],
      onFrame: frames.onFrame,
      camera: (focus) => heard.push(focus.x),
      draw: () => {},
    })
    frames.frame(STEP_MS)
    frames.frame(STEP_MS)

    expect(heard).toEqual([15, 20])
  })

  it('never lets the ask reach the picture', () => {
    const frames = handCrankedFrames()
    let drawnIds: string[] = []

    runLevel({
      entities: [defaultEntity('abc123', 'Slime')],
      systems: [chaser(0, 0)],
      onFrame: frames.onFrame,
      camera: () => {},
      draw: (drawn) => {
        drawnIds = drawn.map((one) => one.id)
      },
    })
    frames.frame(STEP_MS)

    expect(drawnIds).toEqual(['abc123'])
  })

  it('leaves the ask standing in the level when the host takes no camera, for a test to read', () => {
    const frames = handCrankedFrames()

    const level = runLevel({
      entities: [],
      systems: [chaser(40, 72)],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    frames.frame(STEP_MS)

    expect(cameraIn([...level.state().entities])).toEqual({ x: 40, y: 72 })
  })
})
