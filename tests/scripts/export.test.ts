import fs from 'node:fs'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AssetMetaSchema, serializeMeta } from '../../runtime/formats/meta-schema.js'
import { serializeProject } from '../../runtime/formats/project-schema.js'
import { resolveExportConfig } from '../../scripts/export/config.js'
import { EDITOR_MARKERS, markersIn } from '../../scripts/export/editor-markers.js'
import { EXPORT_MANIFEST_FILE, ExportManifestSchema } from '../../scripts/export/manifest-schema.js'
import { planExport } from '../../scripts/export/plan.js'
import { ExportRefused, filesUnder, writeExport } from '../../scripts/export/write.js'
import { writeSampleProject } from '../../scripts/sample/write.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The export command, held to its promises.
 *
 * **Refusals first**, and most of this file is them, because the whole value of a
 * command that hands somebody a folder is that it will not hand over a broken one.
 * The happy path is one assertion; the guards are what stand between the human and a
 * game that fails when somebody else opens it.
 *
 * Every refusal is checked against `planExport`, which decides without writing —
 * which is exactly why deciding and writing are separate functions. A refusal test
 * that had to run a bundler would be a refusal test nobody added the tenth of.
 *
 * The three tests that do build are marked with a longer timeout and named so it is
 * obvious why they are slower: they are the only ones that produce a real folder, and
 * one of them is the "same folder twice" promise, which cannot be checked any other
 * way.
 */

/** Long enough for two real bundles on a loaded machine. */
const BUILD_TIMEOUT = 120_000

const GENERATED_AT = '2026-08-12'
const LEVEL_ONE = 'scenes/level-01.json'
const SLIME_PREFAB = 'prefabs/enemy-slime.json'
const SLIME = 'assets/textures/characters/slime.png'

let project: TempProject
let out: TempProject

beforeEach(async () => {
  project = await makeTempProject()
  writeSampleProject(project.root, { generatedAt: GENERATED_AT })
  // A second temp folder rather than a child of the first: an export inside the
  // project is refused, and rightly (see the test for it).
  out = await makeTempProject()
})

afterEach(async () => {
  await project.cleanup()
  await out.cleanup()
})

/** Where a fresh export goes. Made by the export, not by the fixture. */
function outFolder(name = 'game'): string {
  return path.join(out.root, name)
}

function writeProjectFile(startupScene: string | null): void {
  fs.writeFileSync(
    project.file('project.json'),
    serializeProject({ format: 'kernel2d.project', version: 1, startupScene }),
  )
}

/** Points the starting level's music at a file, with the id its `.meta` holds. */
function setLevelOneMusic(soundPath: string): void {
  const meta = AssetMetaSchema.parse(JSON.parse(fs.readFileSync(project.file(`${soundPath}.meta`), 'utf8')))
  const scene = JSON.parse(fs.readFileSync(project.file(LEVEL_ONE), 'utf8')) as { music?: unknown }
  scene.music = { id: meta.id, path: soundPath }
  fs.writeFileSync(project.file(LEVEL_ONE), JSON.stringify(scene, null, 2))
}

async function exportInto(folder: string): Promise<Awaited<ReturnType<typeof writeExport>>> {
  const planned = await planExport(project.root)
  if (!planned.ok) throw new Error(`the plan refused: ${planned.problem}`)
  return writeExport({
    plan: planned.plan,
    projectPath: project.root,
    outPath: folder,
    generatedAt: GENERATED_AT,
  })
}

// --- what it refuses -------------------------------------------------------

describe('what an export refuses, before a folder exists', () => {
  it('refuses a project with no settings file, and says where one comes from', async () => {
    fs.rmSync(project.file('project.json'))

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain('no project.json')
    expect(planned.ok === false && planned.problem).toContain('sample-project')
  })

  it('refuses when no starting level has been chosen, and says where to choose one', async () => {
    writeProjectFile(null)

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain('names no starting level')
    expect(planned.ok === false && planned.problem).toContain('Assets panel')
  })

  it('refuses settings that are a different kind of document, naming what they are', async () => {
    fs.copyFileSync(project.file(SLIME_PREFAB), project.file('project.json'))

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain('kernel2d.prefab')
  })

  it('refuses a starting level that is not in the project folder', async () => {
    writeProjectFile('scenes/level-99.json')

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain('scenes/level-99.json')
  })

  it('refuses a starting level that is a prefab, saying which it is', async () => {
    writeProjectFile(SLIME_PREFAB)

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain('prefab')
  })

  it('refuses a level whose prefab has gone, naming the prefab', async () => {
    writeProjectFile('scenes/level-02.json')
    fs.rmSync(project.file(SLIME_PREFAB))

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain('enemy-slime.json')
    // In the editor this is survivable and named under the viewport. In an export it
    // is a shipped defect, so the two situations get different answers on purpose.
    expect(planned.ok === false && planned.problem).toContain('Nothing has been written')
  })

  it('refuses a texture with no import settings beside it, naming the texture', async () => {
    fs.rmSync(project.file(`${SLIME}.meta`))

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain('slime.png')
  })

  /*
   * The loader never reads a texture's bytes — only the `.meta` beside them — so
   * this is the one check the export adds of its own, and it is the failure a player
   * would actually see.
   */
  it('refuses a texture whose picture is missing, even though its settings are there', async () => {
    fs.rmSync(project.file(SLIME))

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain(SLIME)
    expect(planned.ok === false && planned.problem).toContain('moved, renamed or deleted')
  })
})

describe('what a swapped file does instead', () => {
  it('warns and carries on when a reference points at a different file than it was written against', async () => {
    // The id in the `.meta` is what witnesses a reference (editor-kernel D5), and it
    // deliberately does not veto: swapping one texture for another is something a
    // human does on purpose, and it still draws.
    const metaPath = project.file(`${SLIME}.meta`)
    const meta = AssetMetaSchema.parse(JSON.parse(fs.readFileSync(metaPath, 'utf8')))
    fs.writeFileSync(metaPath, serializeMeta({ ...meta, id: 'ffffffffffffffff' }))

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    expect(planned.plan.warnings.join(' ')).toContain('slime.png')
    expect(planned.plan.files).toContain(SLIME)
  })
})

// --- what goes in the folder ----------------------------------------------

describe('what the folder holds', () => {
  it('holds only what the starting level reaches', async () => {
    const planned = await planExport(project.root)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    expect(planned.plan.files.sort()).toEqual(
      [
        'assets/textures/characters/knight-idle.png',
        'assets/textures/characters/knight-idle.png.meta',
        'assets/textures/characters/knight-run-strip.png',
        'assets/textures/characters/knight-run-strip.png.meta',
        'assets/textures/characters/slime.png',
        'assets/textures/characters/slime.png.meta',
        'assets/textures/tiles/tileset-grass.png',
        'assets/textures/tiles/tileset-grass.png.meta',
        'assets/textures/ui/icon-heart.png',
        'assets/textures/ui/icon-heart.png.meta',
        'project.json',
        LEVEL_ONE,
      ].sort(),
    )
  })

  it('leaves out the art, the audio and the levels the starting level never reaches', async () => {
    const planned = await planExport(project.root)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    const files = new Set(planned.plan.files)
    expect(files.has('assets/audio/sfx/jump.wav')).toBe(false)
    expect(files.has('assets/source/README.txt')).toBe(false)
    expect(files.has('scenes/level-02.json')).toBe(false)
    expect(files.has('data/items.json')).toBe(false)

    // Named rather than dropped in silence, so "only what the game needs" is
    // something the human can check rather than take on trust.
    expect(planned.plan.leftOut.map((one) => one.path)).toContain('assets')
    expect(planned.plan.leftOut.find((one) => one.path === 'scenes')?.count).toBe(1)
  })

  it('follows a door: a level named by any component ships too', async () => {
    // The level select shape: an entity whose component names another scene.
    // The export must ship every place the game can go, transitively.
    const scene = JSON.parse(fs.readFileSync(project.file(LEVEL_ONE), 'utf8')) as {
      entities: { id: string; name: string; transform: object; components: object }[]
    }
    scene.entities.push({
      id: 'aaaaaaaabbbbbbbb',
      name: 'Level 2 banner',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { portal: { scene: 'scenes/level-02.json' } },
    })
    fs.writeFileSync(project.file(LEVEL_ONE), JSON.stringify(scene, null, 2))

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    const files = new Set(planned.plan.files)
    expect(files.has('scenes/level-02.json')).toBe(true)
    expect(planned.plan.leftOut.find((one) => one.path === 'scenes')).toBeUndefined()
  })

  it('ships the music a level plays, with its settings beside it', async () => {
    const theme = 'assets/audio/music/theme-cave.mp3'
    setLevelOneMusic(theme)

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    const files = new Set(planned.plan.files)
    expect(files.has(theme)).toBe(true)
    expect(files.has(`${theme}.meta`)).toBe(true)
  })

  it('refuses music whose file is missing, naming it', async () => {
    const theme = 'assets/audio/music/theme-cave.mp3'
    setLevelOneMusic(theme)
    // The settings survive the file: exactly the moved-or-deleted shape the
    // refusal exists for.
    fs.rmSync(project.file(theme))

    const planned = await planExport(project.root)

    expect(planned.ok).toBe(false)
    expect(planned.ok === false && planned.problem).toContain(theme)
  })

  it('refuses a door to a scene that is not there, and says which door', async () => {
    const scene = JSON.parse(fs.readFileSync(project.file(LEVEL_ONE), 'utf8')) as {
      entities: { id: string; name: string; transform: object; components: object }[]
    }
    scene.entities.push({
      id: 'aaaaaaaacccccccc',
      name: 'Broken banner',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { portal: { scene: 'scenes/never-written.json' } },
    })
    fs.writeFileSync(project.file(LEVEL_ONE), JSON.stringify(scene, null, 2))

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.problem).toContain('scenes/never-written.json')
    expect(planned.problem).toContain('named by a door')
  })

  it('does not count tooling folders among what it left out', async () => {
    // A human who keeps their game folder in git has a `.git` in it. Reporting "left
    // out .git (2,431)" would bury the line that matters under one nobody asked about,
    // so the same names the filesystem service never lists are skipped here.
    fs.mkdirSync(project.file('.git/objects'), { recursive: true })
    fs.writeFileSync(project.file('.git/objects/whatever'), 'not yours')
    fs.mkdirSync(project.file('node_modules'), { recursive: true })
    fs.writeFileSync(project.file('node_modules/index.js'), 'not yours')

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    expect(planned.plan.leftOut.map((one) => one.path)).not.toContain('.git')
    expect(planned.plan.leftOut.map((one) => one.path)).not.toContain('node_modules')
  })

  it('follows a prefab to the picture its instances draw', async () => {
    // Level two places two slimes by reference and names no texture itself, so the
    // slime can only be in the export if the prefab was followed.
    writeProjectFile('scenes/level-02.json')

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    expect(planned.plan.files).toContain(SLIME_PREFAB)
    expect(planned.plan.files).toContain(SLIME)
    expect(planned.plan.files).toContain(`${SLIME}.meta`)
  })
})

// --- the folder on disk ---------------------------------------------------

describe('the folder it writes', () => {
  it(
    'writes a page, a game, and the project’s own files byte for byte',
    async () => {
      const folder = outFolder()
      const report = await exportInto(folder)

      expect(report.generated).toContain('index.html')
      expect(report.generated).toContain('game.js')

      // The human's files are copied, never reserialised: an export contains the
      // level that is in the project, not this command's idea of it.
      for (const file of ['project.json', LEVEL_ONE, SLIME, `${SLIME}.meta`]) {
        const before = fs.readFileSync(project.file(file))
        const after = fs.readFileSync(path.join(folder, file.replaceAll('/', path.sep)))
        expect(after.equals(before), file).toBe(true)
      }

      const manifest = ExportManifestSchema.parse(
        JSON.parse(fs.readFileSync(path.join(folder, EXPORT_MANIFEST_FILE), 'utf8')),
      )
      expect(manifest.startupScene).toBe(LEVEL_ONE)
      expect(manifest.generatedAt).toBe(GENERATED_AT)
      // The manifest lists everything in the folder except itself, which is what the
      // "no file the export did not write" check is made of.
      expect([...manifest.files, EXPORT_MANIFEST_FILE].sort()).toEqual(filesUnder(folder))
    },
    BUILD_TIMEOUT,
  )

  it(
    'exports twice with nothing changed and produces the same folder both times',
    async () => {
      const first = outFolder('once')
      const second = outFolder('twice')

      await exportInto(first)
      await exportInto(second)

      const listing = filesUnder(first)
      expect(listing).toEqual(filesUnder(second))

      for (const file of listing) {
        const a = fs.readFileSync(path.join(first, file.replaceAll('/', path.sep)))
        const b = fs.readFileSync(path.join(second, file.replaceAll('/', path.sep)))
        expect(a.equals(b), file).toBe(true)
      }
    },
    BUILD_TIMEOUT,
  )

  it(
    'clears out a file a previous export wrote that the game no longer needs',
    async () => {
      const folder = outFolder()
      await exportInto(folder)
      expect(fs.existsSync(path.join(folder, 'assets', 'textures', 'ui', 'icon-heart.png'))).toBe(true)

      // The heart is the only thing level one draws from `ui/`, so dropping it from
      // the level should take it — and its settings, and the empty folder — out of
      // the next export rather than leaving them behind for ever.
      const level = JSON.parse(fs.readFileSync(project.file(LEVEL_ONE), 'utf8')) as {
        entities: { name: string }[]
      }
      level.entities = level.entities.filter((entity) => entity.name !== 'Health icon')
      fs.writeFileSync(project.file(LEVEL_ONE), `${JSON.stringify(level, null, 2)}\n`)

      const again = await exportInto(folder)

      expect(again.removed).toContain('assets/textures/ui/icon-heart.png')
      expect(again.removed).toContain('assets/textures/ui/icon-heart.png.meta')
      expect(fs.existsSync(path.join(folder, 'assets', 'textures', 'ui'))).toBe(false)
      // And nothing is left behind that the manifest does not account for.
      expect(filesUnder(folder)).toEqual([...again.files, EXPORT_MANIFEST_FILE].sort())
    },
    BUILD_TIMEOUT,
  )

  it('refuses a folder holding something no export put there, and leaves it alone', async () => {
    const folder = outFolder()
    fs.mkdirSync(folder, { recursive: true })
    const mine = path.join(folder, 'my-notes.txt')
    fs.writeFileSync(mine, 'not yours')
    const before = fs.statSync(mine)

    const planned = await planExport(project.root)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    await expect(
      writeExport({
        plan: planned.plan,
        projectPath: project.root,
        outPath: folder,
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toBeInstanceOf(ExportRefused)

    // Bytes *and* timestamp: identical contents alone would also pass for a file
    // that had been rewritten with the same text (editor-verification V12).
    expect(fs.readFileSync(mine, 'utf8')).toBe('not yours')
    expect(fs.statSync(mine).mtimeMs).toBe(before.mtimeMs)
    expect(filesUnder(folder)).toEqual(['my-notes.txt'])
  })
})

// --- where it will and will not write -------------------------------------

describe('where an export is allowed to go', () => {
  const env: Record<string, string | undefined> = {}

  it('defaults to a folder named after the project, outside it', () => {
    const result = resolveExportConfig([project.root], env, process.cwd(), GENERATED_AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(path.basename(result.config.outPath)).toBe(path.basename(project.root))
    expect(result.config.outPath.startsWith(project.root)).toBe(false)
  })

  /*
   * Not tidiness: the filesystem service watches the project folder and writes a
   * `.meta` beside every asset in it, so an export kept in there would be modified
   * behind the human's back and two exports of one game would stop being the same
   * folder.
   */
  it('refuses to write inside the project folder, and says why', () => {
    const result = resolveExportConfig(
      [project.root, '--out', path.join(project.root, 'web')],
      env,
      process.cwd(),
      GENERATED_AT,
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('inside the project folder')
    expect(result.ok === false && result.message).toContain('import settings')
  })

  it('refuses to write to the project folder itself', () => {
    const result = resolveExportConfig([project.root, '--out', project.root], env, process.cwd(), GENERATED_AT)
    expect(result.ok).toBe(false)
  })

  it('refuses a folder that would contain the project', () => {
    const result = resolveExportConfig(
      [project.root, '--out', path.dirname(project.root)],
      env,
      process.cwd(),
      GENERATED_AT,
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('delete your game')
  })

  it('refuses a project folder that is not there, naming it', () => {
    const missing = path.join(project.root, 'nowhere')
    const result = resolveExportConfig([missing], env, process.cwd(), GENERATED_AT)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('nowhere')
  })

  it('refuses a date that is not a date, and takes one that is', () => {
    expect(resolveExportConfig([project.root, '--date', 'yesterday'], env, process.cwd(), GENERATED_AT).ok).toBe(
      false,
    )

    const pinned = resolveExportConfig([project.root, '--date', '2026-01-02'], env, process.cwd(), GENERATED_AT)
    expect(pinned.ok && pinned.config.generatedAt).toBe('2026-01-02')
  })

  it('refuses an unknown option rather than ignoring it', () => {
    expect(resolveExportConfig([project.root, '--minify'], env, process.cwd(), GENERATED_AT).ok).toBe(false)
  })
})

// --- no editor in there ---------------------------------------------------

describe('the "no editor in here" search', () => {
  it('finds a marker, and names what finding it would mean', () => {
    const hits = markersIn('game.js', 'function useState(){}')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.marker.because).toContain('React')
  })

  /*
   * The two false positives the first real run produced, kept as tests.
   *
   * Both came from the game engine's own prose, which is in the bundle because the
   * bundle is deliberately unminified — and a check that refuses a good export is
   * worse than no check, because it makes a working command look broken.
   */
  it('does not match a marker buried inside an ordinary word', () => {
    expect(markersIn('game.js', 'a more immersive and visually appealing scene')).toEqual([])
  })

  it('does not match a documentation link that happens to contain an endpoint-shaped path', () => {
    expect(markersIn('game.js', 'https://example.com/doc/api/jsts_geom_Triangle.js.html')).toEqual([])
  })

  it('still matches every marker against the thing it is actually looking for', () => {
    // Without this, tightening a marker into something unmatchable would go
    // unnoticed and the whole check would quietly stop meaning anything.
    for (const marker of EDITOR_MARKERS) {
      expect(markersIn('game.js', `before ${marker.text} after`), marker.text).toHaveLength(1)
    }
  })

  it(
    'passes on a real export, which is the assertion that matters',
    async () => {
      // `writeExport` refuses on a hit, so getting here is the assertion. Made
      // explicit anyway, because a silent pass is indistinguishable from a check
      // that never ran.
      const folder = outFolder()
      const report = await exportInto(folder)

      const hits = report.generated.flatMap((file) => {
        const absolute = path.join(folder, file.replaceAll('/', path.sep))
        if (!file.endsWith('.js') && !file.endsWith('.html') && !file.endsWith('.css')) return []
        return markersIn(file, fs.readFileSync(absolute, 'utf8'))
      })

      expect(hits).toEqual([])
    },
    BUILD_TIMEOUT,
  )
})
