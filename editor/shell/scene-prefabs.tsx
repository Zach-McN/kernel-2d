import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react'

import { PREFAB_FORMAT, resolveEntities, type Prefab } from '../../runtime/formats/prefab-schema'
import { prefabRefOf, type Entity, type Scene } from '../../runtime/formats/scene-schema'
import { DocumentViewSchema } from '../../sidecar/document-view-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { adoptFromDisk, useAllDocuments } from '../store/open-documents'
import { basename } from './asset-kinds'
import { useOpenScene } from './open-scene'
import { useProject } from './project-context'
import { referencesTo, useReferences, type Answer } from './useReferences'

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
 * Two halves:
 *
 *   - **the fetch**, which is `useReferences.ts` — the same mechanism the
 *     textures one layer down uses, because following a reference by path and
 *     modification time is one problem however many kinds of file it is about;
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

/** The prefabs a level's entities point at, deduplicated, with the id each recorded. */
function prefabsWantedBy(scene: Scene | null): Map<string, string> {
  const byPath = new Map<string, string>()
  for (const entity of scene?.entities ?? []) {
    const source = prefabRefOf(entity)
    if (source !== null && !byPath.has(source.path)) byPath.set(source.path, source.id)
  }
  return byPath
}

/** Asking the service for one prefab, and putting it in the store. */
async function askForPrefab(path: string, readStartedAt: number): Promise<Answer> {
  const response = await fetch(`/api/document?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
  if (!response.ok) return 'the editor service would not answer about it'

  const view = DocumentViewSchema.parse(await response.json())
  if (view.status === 'none') return 'there is no file there'
  if (view.status === 'unreadable' || view.document === null) return view.problem ?? 'it could not be read'
  if (view.document.format !== PREFAB_FORMAT) return `that file is a ${view.document.format}, not a prefab`

  adoptFromDisk(view.path, view.document, readStartedAt)
  return null
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
  const wanted = referencesTo(prefabsWantedBy(scene), tree)
  const followed = useReferences(wanted, tree, askForPrefab)

  // The whole document map, which is reference-stable until something in it
  // actually changes — so editing a prefab re-runs this and moving an entity
  // does not. This is the line that makes "editing the prefab updates every
  // instance" true: the prefab drawn here and the prefab the Inspector edits are
  // one object.
  const documents = useAllDocuments()

  return useMemo(() => {
    if (scene === null) return EMPTY
    // A level with no instances in it hands back the store's own array, so
    // nothing downstream sees a new list every render.
    if (wanted.length === 0) return { ...EMPTY, path, entities: scene.entities }

    const prefabs: Record<string, Prefab> = {}
    const problems: Record<string, PrefabProblem> = {}
    let loading = false

    for (const one of wanted) {
      const state = followed.states[one.path]

      if (state === undefined || state.kind === 'loading') {
        loading = true
        continue
      }
      if (state.kind === 'missing') {
        problems[one.path] = { kind: 'missing', path: one.path }
        continue
      }
      if (state.kind === 'unusable') {
        problems[one.path] = { kind: 'unreadable', path: one.path, detail: state.detail }
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

      // Used either way: the file at that path is what the level points at, and
      // refusing to show it would be less informative than showing it and
      // saying so.
      prefabs[one.path] = document
    }

    return { path, entities: resolveEntities(scene.entities, prefabs), prefabs, problems, loading }
  }, [path, scene, followed, documents])
}

/** Every prefab problem in a level, most useful first, as one list. */
export function prefabProblemsIn(resolved: ResolvedScene): PrefabProblem[] {
  return Object.values(resolved.problems).sort((a, b) => a.path.localeCompare(b.path))
}

/** One problem, as the sentence a human reads. */
export function describePrefabProblem(problem: PrefabProblem): string {
  const name = basename(problem.path)

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
