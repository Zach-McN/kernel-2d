import fs from 'node:fs'
import path from 'node:path'

import { metaPathFor } from '../../runtime/formats/meta-schema.js'
import { PROJECT_FORMAT, ProjectSchema } from '../../runtime/formats/project-schema.js'
import { prefabRefOf, spriteOf } from '../../runtime/formats/scene-schema.js'
import { describeLoadProblem, loadScene, type LoadProblem } from '../../runtime/scene/load-scene.js'
import { isIgnoredName } from '../../sidecar/ignore.js'
import { nodeProjectReader } from './project-reader.js'

/**
 * What an export would contain, decided before anything is written.
 *
 * Two jobs, and keeping them in one place is the point: deciding **which files the
 * game needs** and deciding **whether this game can be handed to anybody**. They are
 * the same walk of the project — follow the startup level to its prefabs, follow
 * those to their textures — so doing them apart would mean walking twice and
 * disagreeing once.
 *
 * Nothing here touches the output folder. That is what makes every refusal cheap to
 * test (no build, no copy, no cleanup) and what guarantees a refused export leaves no
 * half-written folder behind. The write is next door.
 *
 * ## What is copied
 *
 * Only what the starting level reaches: the level, every prefab it places from, every
 * texture those draw, the `.meta` beside each of those textures, and `project.json`.
 * Not the whole `assets/` folder — which would ship `assets/source`, the `.psd` and
 * `.blend` originals, and the art that was cut from the level last week.
 *
 * Today that set is *complete* rather than merely sufficient, because there is no way
 * for a game to reach a second level: one startup scene, no transitions, no input. The
 * moment a level can name another one, this walk follows it and the export grows with
 * the game rather than with the folder.
 *
 * ## What refuses, and the one thing that does not
 *
 * Anything meaning something would not be drawn refuses, before a folder exists: no
 * project settings, no starting level chosen, a level that is missing or is not a
 * level, a prefab that has gone, a texture with no readable import settings, a texture
 * whose bytes are not there.
 *
 * In the *editor* every one of those except the first two is survivable — it is named
 * under the viewport and the rest of the level runs — and that is right, because you
 * are mid-work and the editor's job is to tell you. An export is the opposite
 * situation: the folder is about to be given to somebody, so the same problem stops
 * being information and becomes a shipped defect. The command is the last place it can
 * be caught by the person who can fix it.
 *
 * The exception is a reference pointing at a file that is no longer the one it was
 * written against. That draws, and the id deliberately does not veto
 * (`editor-kernel` D5): swapping a texture for a different one is something a human
 * does on purpose. It is warned about by name and the export carries on.
 *
 * **The loader does not check that a texture's bytes exist** — it only ever reads the
 * `.meta` beside them — so that check is added here. It is the one thing this file
 * asks that `loadScene` does not, and it is exactly the failure a player would see.
 */

export interface ExportPlan {
  /** The level the game starts on, project-relative. */
  startupScene: string
  /**
   * Every file to copy, project-relative and forward-slashed, sorted — so two
   * exports of one project produce the same list in the same order.
   */
  files: string[]
  /** Problems that do not stop an export, as the sentences a human reads. */
  warnings: string[]
  /**
   * Files in the project that the starting level does not reach, as counts by
   * top-level folder. Reported so "only what the game needs" is a statement
   * somebody can check rather than take on trust.
   */
  leftOut: { path: string; count: number }[]
}

export type ExportPlanResult = { ok: true; plan: ExportPlan } | { ok: false; problem: string }

/** Where the project's settings live. Fixed, and the exported game looks for the same name. */
export const PROJECT_FILE = 'project.json'

export async function planExport(projectPath: string): Promise<ExportPlanResult> {
  const reader = nodeProjectReader(projectPath)

  const settings = await readProjectSettings(reader)
  if (!settings.ok) return settings

  const startupScene = settings.startupScene

  const level = await loadScene(reader, startupScene)
  if (!level.ok) {
    return { ok: false, problem: `${startupScene} cannot be the starting level. ${level.problem}` }
  }

  const fatal = level.problems.filter((problem) => !isWitnessOnly(problem))
  if (fatal.length > 0) {
    return {
      ok: false,
      problem: [
        `${startupScene} would not draw properly in an exported game:`,
        ...fatal.map((problem) => `  - ${describeLoadProblem(problem)}`),
        'Nothing has been written. Fix these in the editor and export again.',
      ].join('\n'),
    }
  }

  // The resolved entities, not the ones as written: an instance's picture is named
  // by the prefab it points at, so the textures a level needs are only knowable
  // after resolution — which is what the loader has just done.
  const scene = level.request.scene
  const prefabs = [...new Set(scene.entities.map((entity) => prefabRefOf(entity)?.path ?? null))]
    .filter((candidate): candidate is string => candidate !== null)
    .sort()
  const textures = [...new Set(scene.entities.map((entity) => spriteOf(entity)?.texture.path ?? null))]
    .filter((candidate): candidate is string => candidate !== null)
    .sort()

  const missingBytes = textures.filter((texture) => !isFile(projectPath, texture))
  if (missingBytes.length > 0) {
    return {
      ok: false,
      problem: [
        `${startupScene} draws pictures that are not in the project folder:`,
        ...missingBytes.map((texture) => `  - ${texture}`),
        'Their import settings are still there, so this is a file that has been moved, renamed or deleted.',
        'Nothing has been written.',
      ].join('\n'),
    }
  }

  const files = [
    PROJECT_FILE,
    startupScene,
    ...prefabs,
    ...textures,
    ...textures.map((texture) => metaPathFor(texture)),
  ].sort()

  return {
    ok: true,
    plan: {
      startupScene,
      files: [...new Set(files)],
      warnings: level.problems.filter(isWitnessOnly).map(describeLoadProblem),
      leftOut: leftOutOf(projectPath, new Set(files)),
    },
  }
}

/**
 * The two problems that mean "this is a different file from the one the level was
 * written against". They draw, so they warn rather than refuse.
 */
function isWitnessOnly(problem: LoadProblem): boolean {
  return problem.kind === 'prefab-different-file' || problem.kind === 'texture-different-file'
}

type SettingsRead = { ok: true; startupScene: string } | { ok: false; problem: string }

async function readProjectSettings(
  reader: ReturnType<typeof nodeProjectReader>,
): Promise<SettingsRead> {
  let raw: unknown
  try {
    raw = await reader.readJson(PROJECT_FILE)
  } catch (error) {
    return { ok: false, problem: `${PROJECT_FILE} could not be read: ${messageOf(error)}.` }
  }

  if (raw === null || raw === undefined) {
    return {
      ok: false,
      problem:
        `There is no ${PROJECT_FILE} in that folder, so nothing says which level the game starts on.\n` +
        'A project made with `npm run sample-project` has one.',
    }
  }

  const parsed = ProjectSchema.safeParse(raw)
  if (!parsed.success) {
    const format = (raw as { format?: unknown }).format
    const what =
      typeof format === 'string' && format !== PROJECT_FORMAT
        ? `it is a ${format}, not a set of project settings`
        : `it is not a set of project settings this editor can read — ${firstIssue(parsed.error.issues)}`
    return { ok: false, problem: `${PROJECT_FILE} could not be used: ${what}.` }
  }

  if (parsed.data.startupScene === null) {
    return {
      ok: false,
      problem:
        `${PROJECT_FILE} names no starting level, so there is nothing to export.\n` +
        'Open the editor, click project.json in the Assets panel, and choose one.',
    }
  }

  return { ok: true, startupScene: parsed.data.startupScene }
}

/**
 * What is in the project and not in the export, counted by top-level folder.
 *
 * Counted rather than listed: a project with four hundred textures in it would
 * produce four hundred lines nobody reads, and the question this answers is "did it
 * leave out roughly what I expected", which a count answers and a list buries. The
 * `.meta` of a file that was left out is folded into that file's count rather than
 * doubling it.
 *
 * The same names the filesystem service never lists are skipped here too. A human who
 * keeps their game folder in git has a `.git` in it, and reporting "left out .git
 * (2,431)" would bury the line that matters under the one nobody asked about.
 */
function leftOutOf(projectPath: string, taken: ReadonlySet<string>): { path: string; count: number }[] {
  const counts = new Map<string, number>()

  const walk = (relative: string): void => {
    const absolute = path.join(projectPath, relative.replaceAll('/', path.sep))
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (isIgnoredName(entry.name)) continue
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (taken.has(child)) continue
      // A sidecar counts as part of the file it annotates, which is how the asset
      // browser presents it too (`editor-kernel` D4).
      if (child.endsWith('.meta') && taken.has(child.slice(0, -'.meta'.length))) continue
      const top = child.includes('/') ? (child.split('/')[0] ?? child) : child
      counts.set(top, (counts.get(top) ?? 0) + 1)
    }
  }

  walk('')

  return [...counts]
    .map(([where, count]) => ({ path: where, count }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function isFile(projectPath: string, relative: string): boolean {
  const absolute = path.join(projectPath, relative.replaceAll('/', path.sep))
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile()
}

function firstIssue(issues: readonly { message: string; path: readonly PropertyKey[] }[]): string {
  const issue = issues[0]
  if (issue === undefined) return 'it did not match the format'
  const where = issue.path.length === 0 ? '' : ` at ${issue.path.map(String).join('.')}`
  return `${issue.message}${where}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
