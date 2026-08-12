import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'

import {
  PREFAB_FORMAT,
  prefabRefOf,
  resolveEntities,
  type Entity,
  type Prefab,
  type Scene,
} from '../../runtime/formats/scene-schema'
import { DocumentViewSchema } from '../../sidecar/document-view-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { adoptFromDisk, beginRead, useAllDocuments } from '../store/open-documents'
import { findNode } from './asset-kinds'
import { useOpenScene } from './open-scene'
import { useProject } from './project-context'

/**
 * Filling in what a level's instances inherit from the prefabs they point at.
 *
 * This is the step that makes "editing the prefab updates every instance" true,
 * and the whole of the mechanism is that **it reads the document store**. The
 * prefab the Inspector edits and the prefab an instance draws are one object, so
 * a change lands in the picture with nothing told to refresh and nothing
 * recomputed a second way. Reading the service's answer instead would work
 * exactly once, at open, and then quietly stop.
 *
 * Two halves, the same shape as `scene-assets.tsx` one layer down:
 *
 *   - **the fetch**, which asks the service for each prefab a level references
 *     and puts it in the store. Keyed on the file's modification time as well as
 *     its path, so a prefab edited in a text editor is asked for again while an
 *     unrelated change to the folder is not (`editor-kernel` G11);
 *   - **the merge**, which is `resolveEntities` from the format itself rather
 *     than arithmetic invented here — the runtime's scene loader will do the
 *     same sum when play mode arrives, and two derivations of what a level
 *     contains would be the editor and the game disagreeing (D2).
 *
 * A reference is resolved by path and witnessed by id, exactly like a texture's
 * (D5): the path is what finds the file, and the id is what notices that the
 * file at that path is no longer the one this level was written against. It does
 * not veto — the instance is still drawn, and the disagreement is said out loud.
 *
 * **What comes out of here is for drawing and describing, never for writing
 * back.** A resolved entity carries a copy of its prefab's components, and
 * saving one would bake them into the level and sever the link silently. Every
 * writer in this editor re-finds its entity by id inside a transaction, which is
 * what keeps that true by construction rather than by everyone remembering.
 */

export type PrefabProblem =
  /** No file at that path. Named, rather than the instance vanishing. */
  | { kind: 'missing'; path: string }
  /** There is a file and it is not a prefab this editor can read. */
  | { kind: 'unreadable'; path: string; detail: string }
  /** The file is there and is not the one this level was written against. */
  | { kind: 'different-file'; path: string; expected: string; found: string }

export interface ResolvedScene {
  /** The open scene's path, or null when none is open. */
  path: string | null
  /**
   * The open scene's entities with their prefabs' components filled in, in draw
   * order. For drawing and describing only — never write one of these back.
   */
  entities: readonly Entity[]
  /** The prefabs this level points at, by path. */
  prefabs: Readonly<Record<string, Prefab>>
  /** Why a referenced prefab is not in `prefabs`, by path. */
  problems: Readonly<Record<string, PrefabProblem>>
  /** True while at least one referenced prefab is still in the air. */
  loading: boolean
}

const EMPTY: ResolvedScene = { path: null, entities: [], prefabs: {}, problems: {}, loading: false }

/** A reference to resolve: where to look, which file was expected, and when it last changed. */
interface Wanted {
  path: string
  expectedId: string
  version: number
}

function wantedIn(scene: Scene | null, tree: ProjectTree | null): Wanted[] {
  if (scene === null) return []

  const byPath = new Map<string, string>()
  for (const entity of scene.entities) {
    const source = prefabRefOf(entity)
    if (source !== null && !byPath.has(source.path)) byPath.set(source.path, source.id)
  }

  // Sorted so the list is comparable as a string: this drives an effect, and an
  // array in a different order every render would re-fetch the world.
  return [...byPath.entries()]
    .map(([path, expectedId]) => {
      const node = tree === null ? null : findNode(tree, path)
      return { path, expectedId, version: node !== null && node.kind === 'file' ? node.mtimeMs : 0 }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

const ScenePrefabsContext = createContext<ResolvedScene | null>(null)

export function ScenePrefabsProvider({ children }: { children: ReactNode }): ReactElement {
  const open = useOpenScene()
  const project = useProject()

  const resolved = useResolution(
    open.state === 'open' ? open.path : null,
    open.state === 'open' ? open.scene : null,
    project.state === 'ready' ? project.tree : null,
  )

  return <ScenePrefabsContext.Provider value={resolved}>{children}</ScenePrefabsContext.Provider>
}

export function useResolvedScene(): ResolvedScene {
  const resolved = useContext(ScenePrefabsContext)
  if (resolved === null) throw new Error('useResolvedScene was called outside the editor shell')
  return resolved
}

function useResolution(path: string | null, scene: Scene | null, tree: ProjectTree | null): ResolvedScene {
  const wanted = wantedIn(scene, tree)
  const fetchKey = wanted.map((one) => `${one.path}@${one.version}`).join('\n')

  /**
   * What asking for one prefab came to, keyed the same way the fetch is. `null`
   * means it arrived and is in the store; a string is the reason it did not.
   */
  const [answers, setAnswers] = useState<Readonly<Record<string, string | null>>>({})

  useEffect(() => {
    if (wanted.length === 0) return

    let stopped = false
    const fresh = wanted.filter((one) => answers[`${one.path}@${one.version}`] === undefined)
    if (fresh.length === 0) return

    void Promise.all(
      fresh.map(async (one): Promise<[string, string | null]> => {
        const at = `${one.path}@${one.version}`
        // Taken before the question is asked: a late answer is
        // indistinguishable from a fresh one, and the store is what needs to be
        // able to tell them apart.
        const readStartedAt = beginRead()
        try {
          const response = await fetch(`/api/document?path=${encodeURIComponent(one.path)}`, {
            cache: 'no-store',
          })
          if (!response.ok) return [at, 'the editor service would not answer about it']

          const view = DocumentViewSchema.parse(await response.json())
          if (view.status === 'none') return [at, 'there is no file there']
          if (view.status === 'unreadable' || view.document === null) {
            return [at, view.problem ?? 'it could not be read']
          }
          if (view.document.format !== PREFAB_FORMAT) {
            return [at, `that file is a ${view.document.format}, not a prefab`]
          }

          adoptFromDisk(view.path, view.document, readStartedAt)
          return [at, null]
        } catch {
          return [at, 'the editor service could not be reached']
        }
      }),
    ).then((settled) => {
      if (stopped) return
      setAnswers((previous) => ({ ...previous, ...Object.fromEntries(settled) }))
    })

    return () => {
      stopped = true
    }
    // Keyed on the string rather than the array, which is rebuilt every render.
  }, [fetchKey])

  // The whole document map, which is reference-stable until something in it
  // actually changes — so editing a prefab re-runs this and moving an entity
  // does not.
  const documents = useAllDocuments()

  return useMemo(() => {
    if (scene === null) return EMPTY
    // A level with no instances in it hands back the store's own array, so
    // nothing downstream sees a new list every render.
    if (fetchKey === '') return { ...EMPTY, path, entities: scene.entities }

    const prefabs: Record<string, Prefab> = {}
    const problems: Record<string, PrefabProblem> = {}
    let loading = false

    for (const one of wanted) {
      if (tree === null) {
        // Before the folder has been read everything is missing, and saying so
        // would be a lie.
        loading = true
        continue
      }

      const node = findNode(tree, one.path)
      if (node === null || node.kind !== 'file') {
        problems[one.path] = { kind: 'missing', path: one.path }
        continue
      }

      const answer = answers[`${one.path}@${one.version}`]
      if (answer === undefined) {
        loading = true
        continue
      }
      if (answer !== null) {
        problems[one.path] = { kind: 'unreadable', path: one.path, detail: answer }
        continue
      }

      const document = documents[one.path]
      if (document === undefined || document.format !== PREFAB_FORMAT) {
        // The gap of one render between the answer arriving and the store
        // settling. Not a problem, just not ready.
        loading = true
        continue
      }

      if (one.expectedId !== document.id) {
        problems[one.path] = {
          kind: 'different-file',
          path: one.path,
          expected: one.expectedId,
          found: document.id,
        }
      }

      // Drawn either way: the file at that path is what the level points at, and
      // refusing to show it would be less informative than showing it and
      // saying so.
      prefabs[one.path] = document
    }

    return { path, entities: resolveEntities(scene.entities, prefabs), prefabs, problems, loading }
  }, [path, scene, fetchKey, answers, documents, tree])
}

/** Every prefab problem in a level, most useful first, as one list. */
export function prefabProblemsIn(resolved: ResolvedScene): PrefabProblem[] {
  return Object.values(resolved.problems).sort((a, b) => a.path.localeCompare(b.path))
}

/** One problem, as the sentence a human reads. */
export function describePrefabProblem(problem: PrefabProblem): string {
  const name = problem.path.split('/').at(-1) ?? problem.path

  if (problem.kind === 'missing') {
    return `${name} is not in the project folder, so everything placed from it draws nothing. It is still referenced at ${problem.path}.`
  }

  if (problem.kind === 'unreadable') {
    return `${name} cannot be used as a prefab: ${problem.detail}.`
  }

  return `${name} is not the file this level was written against — it expected the one with id ${problem.expected} and found ${problem.found}. It is used anyway.`
}

/** How many entities in this level are instances of one prefab. */
export function instancesOf(entities: readonly Entity[], prefabPath: string): number {
  return entities.filter((entity) => prefabRefOf(entity)?.path === prefabPath).length
}
