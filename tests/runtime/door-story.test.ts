import { describe, expect, it } from 'vitest'

import { defaultEntity, type Entity } from '../../runtime/formats/scene-schema'
import { DOOR_ENTITY_ID, doorIn, openDoor, takeDoor } from '../../runtime/game/door'
import { STEP_MS } from '../../runtime/game/loop'
import { runLevel } from '../../runtime/game/run-level'
import { factOf, factsIn, learn, sceneIn, storyEntity } from '../../runtime/game/story'
import type { System } from '../../runtime/game/system'

/**
 * The two seams a game reaches its host through: the door (asking to be in
 * another scene) and the story (what is remembered between runs). Both cross
 * as entities, exactly as input does, and both are tested here the same way —
 * a hand-cranked clock, no browser, no host beyond a recording function.
 */

function handCrankedFrames(): {
  onFrame: (tick: (elapsedMs: number) => void) => () => void
  frame: (elapsedMs: number) => void
} {
  const ticks = new Set<(elapsedMs: number) => void>()
  return {
    onFrame: (tick) => {
      ticks.add(tick)
      return () => ticks.delete(tick)
    },
    frame: (elapsedMs) => {
      for (const tick of [...ticks]) tick(elapsedMs)
    },
  }
}

describe('the door, on its own', () => {
  it('carries the scene a system asked for', () => {
    const entities: Entity[] = [defaultEntity('a', 'Anything')]
    openDoor(entities, 'scenes/level-02.json')

    expect(doorIn(entities)).toBe('scenes/level-02.json')
  })

  it('a second ask rewrites the first: one door per run', () => {
    const entities: Entity[] = []
    openDoor(entities, 'scenes/level-01.json')
    openDoor(entities, 'scenes/level-02.json')

    expect(doorIn(entities)).toBe('scenes/level-02.json')
    expect(entities.filter((one) => one.id === DOOR_ENTITY_ID)).toHaveLength(1)
  })

  it('taking the door removes it', () => {
    const entities: Entity[] = []
    openDoor(entities, 'scenes/level-02.json')

    expect(takeDoor(entities)).toBe('scenes/level-02.json')
    expect(doorIn(entities)).toBeNull()
    expect(takeDoor(entities)).toBeNull()
  })
})

describe('the door, through a running level', () => {
  /** A system that opens a door on its first step and never again. */
  function leaver(scene: string): System {
    let asked = false
    return {
      id: 'leaver',
      step: (entities) => {
        if (asked) return
        asked = true
        openDoor(entities, scene)
      },
    }
  }

  it('tells the host which scene the game asked for, once', () => {
    const frames = handCrankedFrames()
    const doors: string[] = []

    runLevel({
      entities: [defaultEntity('a', 'Anything')],
      systems: [leaver('scenes/level-02.json')],
      onFrame: frames.onFrame,
      draw: () => {},
      door: (scene) => doors.push(scene),
    })
    frames.frame(STEP_MS)
    frames.frame(STEP_MS)

    expect(doors).toEqual(['scenes/level-02.json'])
  })

  it('never lets the door into the picture', () => {
    const frames = handCrankedFrames()
    let drawn: readonly Entity[] = []

    runLevel({
      entities: [defaultEntity('a', 'Anything')],
      systems: [leaver('scenes/level-02.json')],
      onFrame: frames.onFrame,
      draw: (entities) => {
        drawn = entities
      },
      door: () => {},
    })
    frames.frame(STEP_MS)

    expect(drawn.map((one) => one.id)).toEqual(['a'])
  })

  it('with no handler, the ask stays where a test can read it', () => {
    const frames = handCrankedFrames()

    const level = runLevel({
      entities: [defaultEntity('a', 'Anything')],
      systems: [leaver('scenes/level-02.json')],
      onFrame: frames.onFrame,
      draw: () => {},
    })
    frames.frame(STEP_MS)

    expect(doorIn(level.state().entities)).toBe('scenes/level-02.json')
  })
})

describe('the story, on its own', () => {
  it('says which scene this run is, and what is remembered', () => {
    const entities = [storyEntity('scenes/level-01.json', { greeted: true })]

    expect(sceneIn(entities)).toBe('scenes/level-01.json')
    expect(factOf(entities, 'greeted')).toBe(true)
    expect(factOf(entities, 'never-stated')).toBeUndefined()
  })

  it('learning states a fact a later reader sees', () => {
    const entities = [storyEntity('scenes/level-01.json')]
    learn(entities, 'scenes/level-01.json', { won: true })

    expect(factsIn(entities)).toEqual({ 'scenes/level-01.json': { won: true } })
  })

  it('with no carrier, reading answers nothing and learning is quiet', () => {
    const entities: Entity[] = [defaultEntity('a', 'Anything')]

    expect(sceneIn(entities)).toBeNull()
    expect(factsIn(entities)).toEqual({})
    expect(() => {
      learn(entities, 'anything', 1)
    }).not.toThrow()
  })
})

describe('the story, through a running level', () => {
  it('recalls at the start, remembers when the facts change, and only then', () => {
    const frames = handCrankedFrames()
    const kept: Record<string, unknown>[] = []
    let step = 0

    const learner: System = {
      id: 'learner',
      step: (entities) => {
        step += 1
        // Sees what the host recalled, on the very first step.
        if (step === 1) expect(factOf(entities, 'old')).toBe('news')
        if (step === 2) learn(entities, 'fresh', 'fact')
      },
    }

    runLevel({
      entities: [defaultEntity('a', 'Anything')],
      systems: [learner],
      onFrame: frames.onFrame,
      draw: () => {},
      story: {
        scene: 'scenes/level-01.json',
        recall: () => ({ old: 'news' }),
        remember: (facts) => kept.push(facts),
      },
    })
    for (let count = 0; count < 4; count += 1) frames.frame(STEP_MS)

    // One remembering — the change — not one per frame.
    expect(kept).toEqual([{ old: 'news', fresh: 'fact' }])
  })

  it('never lets the carrier into the picture', () => {
    const frames = handCrankedFrames()
    let drawn: readonly Entity[] = []

    runLevel({
      entities: [defaultEntity('a', 'Anything')],
      systems: [],
      onFrame: frames.onFrame,
      draw: (entities) => {
        drawn = entities
      },
      story: { scene: 'scenes/level-01.json', recall: () => ({}), remember: () => {} },
    })
    // A frame with no systems still steps the clock and draws.
    frames.frame(STEP_MS)

    expect(drawn.map((one) => one.id)).toEqual(['a'])
  })

  it('tells the game which scene it is', () => {
    const frames = handCrankedFrames()
    let heard: string | null = null

    runLevel({
      entities: [defaultEntity('a', 'Anything')],
      systems: [
        {
          id: 'asker',
          step: (entities) => {
            heard = sceneIn(entities)
          },
        },
      ],
      onFrame: frames.onFrame,
      draw: () => {},
      story: { scene: 'scenes/level-02.json', recall: () => ({}), remember: () => {} },
    })
    frames.frame(STEP_MS)

    expect(heard).toBe('scenes/level-02.json')
  })
})
