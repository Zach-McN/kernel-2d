import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ComponentDescriptionSchema,
  type ComponentDescription,
} from '../../runtime/formats/component-schema.js'
import { AssetMetaSchema } from '../../runtime/formats/meta-schema.js'
import { PrefabSchema, resolveEntity, type Prefab } from '../../runtime/formats/prefab-schema.js'
import { SceneSchema, prefabRefOf, spriteOf, type Scene } from '../../runtime/formats/scene-schema.js'
import { writeSampleProject } from '../../scripts/sample/write.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

const GENERATED_AT = '2026-08-11'

describe('filling a project folder with sample content', () => {
  let project: TempProject

  beforeEach(async () => {
    project = await makeTempProject()
  })

  afterEach(async () => {
    await project.cleanup()
  })

  const build = (): ReturnType<typeof writeSampleProject> =>
    writeSampleProject(project.root, { generatedAt: GENERATED_AT })

  it('writes the range of assets a 2D game actually has', () => {
    build()

    for (const expected of [
      'assets/textures/characters/knight-idle.png',
      'assets/textures/tiles/tileset-grass.png',
      'assets/textures/ui/button-idle.png',
      'assets/audio/sfx/jump.wav',
      'assets/fonts/pixel-8.png',
      'assets/fonts/pixel-8.fnt',
      'assets/source/README.txt',
      'data/waves.json',
      'prefabs/enemy-slime.json',
      'scenes/level-01.json',
      'components/patrol.json',
      'project.json',
    ]) {
      expect(fs.existsSync(project.file(expected)), expected).toBe(true)
    }
  })

  it('leaves the folder clickable, not only openable by typing a path', () => {
    const report = build()

    expect(report.written).toContain('Open editor.cmd')
    expect(fs.existsSync(project.file('Open editor.cmd'))).toBe(true)
    // It carries its marking in a comment, so it must not also get a `.meta` —
    // that would put a launcher in the Assets panel as though it were art.
    expect(fs.existsSync(project.file('Open editor.cmd.meta'))).toBe(false)
  })

  it('writes images a picture viewer can actually open', () => {
    build()

    const png = fs.readFileSync(project.file('assets/textures/characters/knight-idle.png'))

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(16) // width
    expect(png.readUInt32BE(20)).toBe(16) // height
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND')
  })

  it('writes sounds a player can actually open', () => {
    build()

    const wav = fs.readFileSync(project.file('assets/audio/sfx/jump.wav'))

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
  })

  it('marks every generated binary in a sidecar beside it', () => {
    build()

    const meta: unknown = JSON.parse(
      fs.readFileSync(`${project.file('assets/textures/characters/slime.png')}.meta`, 'utf8'),
    )

    expect(meta).toMatchObject({ generatedBy: expect.any(String), generatedAt: GENERATED_AT })
  })

  it('marks every generated JSON file inside itself', () => {
    build()

    const scene: unknown = JSON.parse(fs.readFileSync(project.file('scenes/level-01.json'), 'utf8'))

    expect(scene).toMatchObject({ generatedBy: expect.any(String), generatedAt: GENERATED_AT })
  })

  it('writes import settings the editor can actually open', () => {
    const report = build()

    // Generated content is held to the same schema as anything a human writes:
    // a sample folder the editor could not open would be testing nothing.
    for (const written of report.written) {
      const metaPath = `${project.file(written)}.meta`
      if (!fs.existsSync(metaPath)) continue
      expect(() => AssetMetaSchema.parse(JSON.parse(fs.readFileSync(metaPath, 'utf8'))), written).not.toThrow()
    }
  })

  it('says how the sheets in it are cut up, so there is something to look at', () => {
    build()

    const strip = AssetMetaSchema.parse(
      JSON.parse(fs.readFileSync(`${project.file('assets/textures/characters/knight-run-strip.png')}.meta`, 'utf8')),
    )

    expect(strip.type).toBe('texture')
    expect(strip.importSettings).toMatchObject({
      slice: { mode: 'grid', frameWidth: 16, frameHeight: 16 },
      pivot: { x: 0.5, y: 1 },
    })
  })

  it('gives every asset an id of its own', () => {
    build()

    const idOf = (assetPath: string): string =>
      AssetMetaSchema.parse(JSON.parse(fs.readFileSync(`${project.file(assetPath)}.meta`, 'utf8'))).id

    const ids = [
      idOf('assets/textures/characters/knight-idle.png'),
      idOf('assets/textures/characters/slime.png'),
      idOf('assets/audio/sfx/jump.wav'),
      idOf('assets/fonts/pixel-8.fnt'),
    ]

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces the same bytes every time, so re-running does not churn the folder', () => {
    build()
    const first = fs.readFileSync(project.file('assets/textures/tiles/tileset-grass.png'))
    const firstMeta = fs.readFileSync(`${project.file('assets/textures/tiles/tileset-grass.png')}.meta`)

    build()
    const second = fs.readFileSync(project.file('assets/textures/tiles/tileset-grass.png'))
    const secondMeta = fs.readFileSync(`${project.file('assets/textures/tiles/tileset-grass.png')}.meta`)

    expect(second.equals(first)).toBe(true)
    // Including the ids: minted at random they would change on every run, and
    // the churn would bury every real change in the noise.
    expect(secondMeta.equals(firstMeta)).toBe(true)
  })

  it('leaves a file alone when nothing marks it as generated', () => {
    const humanScene = project.file('scenes/level-01.json')
    fs.mkdirSync(path.dirname(humanScene), { recursive: true })
    fs.writeFileSync(humanScene, '{"handMade":true}')

    const report = build()

    expect(fs.readFileSync(humanScene, 'utf8')).toBe('{"handMade":true}')
    expect(report.skipped).toContain('scenes/level-01.json')
    expect(report.written).not.toContain('scenes/level-01.json')
  })

  it('leaves a binary alone when its sidecar does not claim it', () => {
    const humanArt = project.file('assets/textures/characters/knight-idle.png')
    fs.mkdirSync(path.dirname(humanArt), { recursive: true })
    fs.writeFileSync(humanArt, 'a real drawing')

    const report = build()

    expect(fs.readFileSync(humanArt, 'utf8')).toBe('a real drawing')
    expect(report.skipped).toContain('assets/textures/characters/knight-idle.png')
  })

  it('does overwrite what it wrote itself', () => {
    build()
    fs.writeFileSync(project.file('scenes/level-01.json'), '{"generatedBy":"claude-opus-5"}')

    const report = build()

    expect(report.skipped).toEqual([])
    expect(fs.readFileSync(project.file('scenes/level-01.json'), 'utf8')).toContain('kernel2d.scene')
  })
})

/**
 * The scenes are the first generated content in a real format the editor both
 * reads and rewrites, so they are held to more than "a file appeared": they have
 * to open, and every reference in them has to point at something.
 */
describe('the sample scenes', () => {
  let project: TempProject

  beforeEach(async () => {
    project = await makeTempProject()
    writeSampleProject(project.root, { generatedAt: GENERATED_AT })
  })

  afterEach(async () => {
    await project.cleanup()
  })

  const sceneAt = (scenePath: string): Scene =>
    SceneSchema.parse(JSON.parse(fs.readFileSync(project.file(scenePath), 'utf8')))

  it.each([['scenes/level-01.json'], ['scenes/level-02.json']])('%s opens as a scene', (scenePath) => {
    expect(sceneAt(scenePath).entities.length).toBeGreaterThan(0)
  })

  it('gives every entity a name and an id of its own', () => {
    const entities = sceneAt('scenes/level-01.json').entities

    expect(new Set(entities.map((entity) => entity.id)).size).toBe(entities.length)
    for (const entity of entities) expect(entity.name).not.toBe('')
  })

  const prefabAt = (prefabPath: string): Prefab =>
    PrefabSchema.parse(JSON.parse(fs.readFileSync(project.file(prefabPath), 'utf8')))

  it('points every texture reference at a file that is actually there', () => {
    for (const scenePath of ['scenes/level-01.json', 'scenes/level-02.json']) {
      for (const entity of sceneAt(scenePath).entities) {
        // Resolved the way the editor resolves it, so an instance is checked
        // through the prefab it points at rather than counted as having no
        // picture. Asking the raw entity would pass this level today and fail
        // the moment anything was placed from a prefab.
        const source = prefabRefOf(entity)
        const resolved = resolveEntity(entity, source === null ? null : prefabAt(source.path))
        const sprite = spriteOf(resolved)

        expect(sprite, `${scenePath}: ${entity.name}`).not.toBeNull()
        expect(fs.existsSync(project.file(sprite?.texture.path ?? '')), sprite?.texture.path).toBe(true)
      }
    }
  })

  /**
   * The sample's one prefab, and the two instances of it.
   *
   * The load-bearing assertion is the last one: an instance carries a reference
   * and *no copy* of what it inherits. A generator that wrote the sprite into
   * both places would produce a sample that looked right, drew right, and
   * stopped following the prefab the first time anybody edited it — which is the
   * one thing prefabs exist to do.
   */
  it('places the slime prefab twice, by reference and nothing else', () => {
    const prefab = prefabAt('prefabs/enemy-slime.json')
    const instances = sceneAt('scenes/level-02.json').entities.filter(
      (entity) => prefabRefOf(entity) !== null,
    )

    expect(instances).toHaveLength(2)
    for (const entity of instances) {
      expect(prefabRefOf(entity)?.path).toBe('prefabs/enemy-slime.json')
      // The witness half of D5: a prefab has no `.meta`, so the id the level
      // records is the one the document itself carries.
      expect(prefabRefOf(entity)?.id, entity.name).toBe(prefab.id)
      expect(spriteOf(entity), `${entity.name} carries its own sprite`).toBeNull()
      expect(Object.keys(entity.components)).toEqual(['prefab'])
    }

    // And where they stand is still the level's: one of them is tilted.
    expect(instances.map((entity) => entity.transform.rotation)).toEqual([0, 20])
  })

  /**
   * The half of D5 that has never had anything to test it: a reference carries
   * the id its texture's `.meta` holds, so the editor can notice when the file
   * at that path is no longer the one the scene was written against.
   */
  it('carries the id the texture actually has, not just its path', () => {
    for (const entity of sceneAt('scenes/level-01.json').entities) {
      const sprite = spriteOf(entity)
      if (sprite === null) continue
      const meta = AssetMetaSchema.parse(
        JSON.parse(fs.readFileSync(`${project.file(sprite.texture.path)}.meta`, 'utf8')),
      )

      expect(sprite.texture.id, sprite.texture.path).toBe(meta.id)
    }
  })

  it('puts everything where a viewport with no camera can see it', () => {
    // Scene space is y-up from the bottom-left and there is nothing to pan
    // with yet, so a sample entity off screen would be a sample nobody can
    // find. Generous bounds: this is about "visible", not about layout.
    for (const scenePath of ['scenes/level-01.json', 'scenes/level-02.json']) {
      for (const entity of sceneAt(scenePath).entities) {
        expect(entity.transform.x, `${scenePath}: ${entity.name} x`).toBeGreaterThanOrEqual(0)
        expect(entity.transform.x, `${scenePath}: ${entity.name} x`).toBeLessThan(600)
        expect(entity.transform.y, `${scenePath}: ${entity.name} y`).toBeGreaterThanOrEqual(0)
        expect(entity.transform.y, `${scenePath}: ${entity.name} y`).toBeLessThan(400)
      }
    }
  })

  /**
   * The sample's `patrol` is the one thing in this folder that has to agree with
   * itself in three places: the level carries the component, `src/systems/`
   * reads three keys off it, and `components/patrol.json` tells the editor which
   * fields to draw. Nothing enforces that correspondence — the kernel has never
   * heard of `patrol` and cannot — so it is asserted here, where a sample that
   * drifted would otherwise ship controls that write fields nothing reads.
   */
  describe('the sample’s own component description', () => {
    const description = (): ComponentDescription =>
      ComponentDescriptionSchema.parse(
        JSON.parse(fs.readFileSync(project.file('components/patrol.json'), 'utf8')),
      )

    it('describes the component the level actually carries', () => {
      const slime = sceneAt('scenes/level-01.json').entities.find((entity) => entity.name === 'Slime')

      expect(description().type).toBe('patrol')
      expect(slime?.components['patrol']).toBeDefined()
    })

    it('names exactly the keys the sample’s own system reads', () => {
      const system = fs.readFileSync(project.file('src/systems/patrol.ts'), 'utf8')

      for (const field of description().fields) {
        expect(system, `${field.key} is read by the system`).toContain(field.key)
      }
      // And the other way round: the three the system narrows are all described,
      // or the human has a field they cannot set.
      expect(description().fields.map((field) => field.key).sort()).toEqual([
        'fromX',
        'toX',
        'unitsPerSecond',
      ])
    })

    it('is marked as generated, inside itself, like every other JSON here', () => {
      expect(description().generatedBy).not.toBe(undefined)
      expect(fs.existsSync(project.file('components/patrol.json.meta'))).toBe(false)
    })
  })

  it('produces the same scene bytes every time', () => {
    const first = fs.readFileSync(project.file('scenes/level-01.json'))
    writeSampleProject(project.root, { generatedAt: GENERATED_AT })
    const second = fs.readFileSync(project.file('scenes/level-01.json'))

    // Entity ids are derived from the scene path and the entity's position in
    // the list; minted at random they would change on every run.
    expect(second.equals(first)).toBe(true)
  })
})
