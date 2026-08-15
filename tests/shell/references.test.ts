import { describe, expect, it } from 'vitest'

import { PREFAB_FORMAT, PREFAB_VERSION, type Prefab } from '../../runtime/formats/prefab-schema'
import { PROJECT_FORMAT, PROJECT_VERSION, type Project } from '../../runtime/formats/project-schema'
import { SCENE_FORMAT, SCENE_VERSION, SceneSchema, type Scene } from '../../runtime/formats/scene-schema'
import { movedPath, rewriteReferences, usesOf } from '../../editor/shell/references'

/**
 * The arithmetic a rename rests on: which references are about the file that
 * moved, and what those references look like afterwards.
 *
 * Two properties carry the whole feature and neither is visible from a screen.
 * **`id` is never rewritten** — a file moved from inside the editor takes its
 * `.meta` with it, so the witness is still correct and changing it would be
 * inventing agreement. And **a document with nothing to change is not written at
 * all**, which is what keeps a rename from churning every level in the project
 * (`editor-verification` V22: the neighbour that should not have moved).
 */

const knight = { id: 'knight-id', path: 'assets/textures/knight.png' }

function sceneWith(...components: Record<string, unknown>[]): Scene {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    entities: components.map((map, index) => ({
      id: `entity-${index}`,
      name: `Entity ${index}`,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      components: map,
    })),
  }
}

const prefab: Prefab = {
  format: PREFAB_FORMAT,
  version: PREFAB_VERSION,
  id: 'slime-id',
  name: 'Slime',
  components: { sprite: { texture: knight } },
}

const project: Project = {
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  startupScene: 'scenes/level-01.json',
}

describe('which references are about the file that moved', () => {
  it('matches the file itself', () => {
    expect(movedPath('assets/knight.png', 'assets/knight.png', 'art/hero.png')).toBe('art/hero.png')
  })

  it('matches anything under a folder that moved', () => {
    expect(movedPath('assets/textures/knight.png', 'assets/textures', 'assets/art')).toBe(
      'assets/art/knight.png',
    )
  })

  it('does not match a neighbour whose name merely starts the same way', () => {
    // `assets/tex` and `assets/textures` are different folders, and a prefix
    // test without the separator would move one when the other was renamed.
    expect(movedPath('assets/textures/knight.png', 'assets/tex', 'assets/pictures')).toBeNull()
  })

  it('does not match something unrelated', () => {
    expect(movedPath('assets/audio/jump.wav', 'assets/textures/knight.png', 'x.png')).toBeNull()
  })
})

describe('what still points at a file', () => {
  it('counts a texture a level draws', () => {
    expect(usesOf(sceneWith({ sprite: { texture: knight } }), knight.path)).toBe(1)
  })

  it('counts every place, not every file', () => {
    const scene = sceneWith({ sprite: { texture: knight } }, { sprite: { texture: knight } })

    expect(usesOf(scene, knight.path)).toBe(2)
  })

  it('counts a prefab a level places from', () => {
    const scene = sceneWith({ prefab: { source: { id: 'slime-id', path: 'prefabs/slime.json' } } })

    expect(usesOf(scene, 'prefabs/slime.json')).toBe(1)
  })

  it('counts a texture a prefab draws', () => {
    expect(usesOf(prefab, knight.path)).toBe(1)
  })

  it('counts the level a game starts on', () => {
    expect(usesOf(project, 'scenes/level-01.json')).toBe(1)
    expect(usesOf(project, 'scenes/level-02.json')).toBe(0)
  })

  it('counts everything under a folder as one answer', () => {
    const scene = sceneWith(
      { sprite: { texture: knight } },
      { sprite: { texture: { id: 'slime-id', path: 'assets/textures/slime.png' } } },
      { sprite: { texture: { id: 'jump-id', path: 'assets/audio/jump.wav' } } },
    )

    expect(usesOf(scene, 'assets/textures')).toBe(2)
  })

  it('counts the music a level plays', () => {
    const theme = { id: 'theme-id', path: 'assets/audio/music/theme.wav' }
    const level: Scene = { ...sceneWith({ sprite: { texture: knight } }), music: theme }

    expect(usesOf(level, 'assets/audio/music/theme.wav')).toBe(1)
    expect(usesOf(level, 'assets/audio')).toBe(1)
  })

  it('says nothing about a component type this editor has never heard of', () => {
    const scene = sceneWith({ patrol: { route: { id: 'route-id', path: 'assets/textures/knight.png' } } })

    expect(usesOf(scene, knight.path)).toBe(0)
  })
})

describe('rewriting a reference after a move', () => {
  it('changes the path and leaves the id exactly as it was', () => {
    const scene = sceneWith({ sprite: { texture: knight } })

    const rewritten = rewriteReferences(scene, knight.path, 'assets/art/hero.png') as Scene

    expect(rewritten.entities[0]?.components['sprite']).toEqual({
      texture: { id: 'knight-id', path: 'assets/art/hero.png' },
    })
  })

  it('rewrites everything under a folder that moved', () => {
    const scene = sceneWith(
      { sprite: { texture: knight } },
      { sprite: { texture: { id: 'slime-id', path: 'assets/textures/slime.png' } } },
    )

    const rewritten = rewriteReferences(scene, 'assets/textures', 'assets/art') as Scene

    expect(rewritten.entities.map((entity) => (entity.components['sprite'] as { texture: { path: string } }).texture.path)).toEqual([
      'assets/art/knight.png',
      'assets/art/slime.png',
    ])
  })

  it('follows a level that moved into the settings that start the game on it', () => {
    const rewritten = rewriteReferences(project, 'scenes/level-01.json', 'levels/opening.json') as Project

    expect(rewritten.startupScene).toBe('levels/opening.json')
  })

  it('rewrites a prefab a level places from', () => {
    const scene = sceneWith({ prefab: { source: { id: 'slime-id', path: 'prefabs/slime.json' } } })

    const rewritten = rewriteReferences(scene, 'prefabs/slime.json', 'prefabs/enemies/slime.json') as Scene

    expect(rewritten.entities[0]?.components['prefab']).toEqual({
      source: { id: 'slime-id', path: 'prefabs/enemies/slime.json' },
    })
  })

  it('follows the music a level plays, leaving its id exactly as it was', () => {
    const level: Scene = {
      ...sceneWith(),
      music: { id: 'theme-id', path: 'assets/audio/music/theme.wav' },
    }

    const rewritten = rewriteReferences(level, 'assets/audio', 'assets/sound')

    expect(rewritten).not.toBeNull()
    if (rewritten === null || rewritten.format !== SCENE_FORMAT) throw new Error('expected a scene')
    expect(rewritten.music).toEqual({ id: 'theme-id', path: 'assets/sound/music/theme.wav' })
  })

  it('answers with nothing at all when the document did not point at it', () => {
    // Not merely "an unchanged copy": a document that changed nothing must not
    // be written, or renaming one texture rewrites every level in the project.
    expect(rewriteReferences(sceneWith({ sprite: { texture: knight } }), 'assets/audio/jump.wav', 'x')).toBeNull()
    expect(rewriteReferences(project, 'scenes/level-02.json', 'x.json')).toBeNull()
  })

  it('keeps a key a human added, at the top level and nested inside an entity', () => {
    const scene = {
      ...sceneWith({ sprite: { texture: knight } }),
      notes: 'the boss arrives here',
    } as Scene & { notes: string }
    const entity = scene.entities[0]
    if (entity === undefined) throw new Error('the fixture has no entity in it')
    Object.assign(entity, { colour: 'green' })

    const rewritten = rewriteReferences(scene, knight.path, 'assets/art/hero.png') as Scene & { notes: string }

    expect(rewritten.notes).toBe('the boss arrives here')
    expect(rewritten.entities[0]).toMatchObject({ colour: 'green' })
    // And it is still a scene afterwards, rather than something that happens to
    // have survived the walk.
    expect(() => SceneSchema.parse(rewritten)).not.toThrow()
  })

  it('keeps a component type this editor has never heard of, byte for byte', () => {
    const scene = sceneWith({ sprite: { texture: knight }, patrol: { speed: 3, waypoints: [1, 2] } })

    const rewritten = rewriteReferences(scene, knight.path, 'assets/art/hero.png') as Scene

    expect(rewritten.entities[0]?.components['patrol']).toEqual({ speed: 3, waypoints: [1, 2] })
  })

  it('does not change the document it was handed', () => {
    const scene = sceneWith({ sprite: { texture: knight } })

    rewriteReferences(scene, knight.path, 'assets/art/hero.png')

    expect(scene.entities[0]?.components['sprite']).toEqual({ texture: knight })
  })
})
