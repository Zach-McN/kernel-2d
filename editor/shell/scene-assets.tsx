import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'

import type { AssetMeta, TextureImportSettings } from '../../runtime/formats/meta-schema'
import { metaPathFor } from '../../runtime/formats/meta-schema'
import { spriteOf, type Scene } from '../../runtime/formats/scene-schema'
import type { SceneTexture } from '../../runtime'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { adoptFromDisk, beginRead, useAllDocuments } from '../store/open-documents'
import { findNode } from './asset-kinds'
import { useOpenScene } from './open-scene'
import { useProject } from './project-context'

/**
 * Turning the texture references in a scene into something the renderer can
 * draw, and saying what is wrong with the ones it cannot.
 *
 * **This is the first code to honour D5**, which has been written down since day
 * one and has never had anything to obey it. A reference carries a stable id
 * *and* a readable path, and the two are used differently:
 *
 *   - **the path resolves it.** It is looked up in the project folder, which is
 *     what makes a scene greppable and lets a session understand a level by
 *     reading it;
 *   - **the id is the witness.** Once the file is found, the id in its `.meta`
 *     is compared with the one the scene recorded. Disagreement means the
 *     reference now points at a *different file* than the one it was written
 *     against — somebody swapped two textures, or restored one from a backup.
 *
 * Reconciling the pair after a move is a fixup tool's job and does not exist
 * yet. Until it does, the id's whole value is that the disagreement is said out
 * loud instead of drawn silently, which is the difference between "my sprite
 * looks wrong" and "this reference points somewhere else now". It does not veto
 * the draw: the file at that path is what the scene points at, and refusing to
 * show it would be less informative than showing it and saying so.
 *
 * Settings come from the document store rather than from the served answer, so
 * the picture in the Viewport and the controls in the Texture tab are always
 * describing the same object (`editor-ui` U12).
 */

export type TextureProblem =
  /** No file at that path. Named, rather than drawn as nothing. */
  | { kind: 'missing'; path: string }
  /** The file is there; its import settings are not usable. */
  | { kind: 'no-settings'; path: string; detail: string }
  /** The file is there and is not the one this reference was written against. */
  | { kind: 'different-file'; path: string; expected: string; found: string }

export interface SceneAssets {
  /** Ready to draw, keyed by project-relative path. Handed straight to the renderer. */
  textures: Readonly<Record<string, SceneTexture>>
  /** Why a referenced texture is not in `textures`, keyed by path. */
  problems: Readonly<Record<string, TextureProblem>>
  /** True while at least one referenced texture's settings are still in the air. */
  loading: boolean
}

const EMPTY: SceneAssets = { textures: {}, problems: {}, loading: false }

/** A reference to resolve: where to look, and which file the scene expected. */
interface Wanted {
  path: string
  /** The id the scene recorded. The witness. */
  expectedId: string
  /**
   * When the settings file beside it last changed, or 0 when there is none.
   *
   * Part of the fetch key, so a `.meta` edited in a text editor is asked for
   * again while an unrelated change to the folder is not — the same reason an
   * asset's URL carries its modification time (`editor-kernel` G11).
   */
  settingsVersion: number
}

function wantedIn(scene: Scene | null, tree: ProjectTree | null): Wanted[] {
  if (scene === null) return []

  const byPath = new Map<string, string>()
  for (const entity of scene.entities) {
    const sprite = spriteOf(entity)
    if (sprite !== null && !byPath.has(sprite.texture.path)) {
      byPath.set(sprite.texture.path, sprite.texture.id)
    }
  }

  // Sorted so the list is comparable as a string: this drives an effect, and an
  // array in a different order every render would re-fetch the world.
  return [...byPath.entries()]
    .map(([path, expectedId]) => {
      const settings = tree === null ? null : findNode(tree, metaPathFor(path))
      return {
        path,
        expectedId,
        settingsVersion: settings !== null && settings.kind === 'file' ? settings.mtimeMs : 0,
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Read once per window, shared by every panel that needs it.
 *
 * Three panels ask what a scene's textures resolve to — the Viewport draws
 * them, the Hierarchy marks the entities that cannot be drawn, and the Inspector
 * explains why. Three callers of the hook would be three sets of requests kept
 * on three timers, and a panel a beat behind its neighbour with nothing on
 * screen saying which one is right (`editor-ui` U9). Above the layout, because
 * this fetch also writes into the document store: owned by a panel, closing that
 * tab would stop the other two working for no visible reason.
 */
const SceneAssetsContext = createContext<SceneAssets | null>(null)

export function SceneAssetsProvider({ children }: { children: ReactNode }): ReactElement {
  const open = useOpenScene()
  const project = useProject()

  const assets = useResolvedSceneAssets(
    open.state === 'open' ? open.scene : null,
    project.state === 'ready' ? project.tree : null,
  )

  return <SceneAssetsContext.Provider value={assets}>{children}</SceneAssetsContext.Provider>
}

export function useSceneAssets(): SceneAssets {
  const assets = useContext(SceneAssetsContext)
  if (assets === null) throw new Error('useSceneAssets was called outside the editor shell')
  return assets
}

function useResolvedSceneAssets(scene: Scene | null, tree: ProjectTree | null): SceneAssets {
  const wanted = wantedIn(scene, tree)
  const fetchKey = wanted.map((one) => `${one.path}@${one.settingsVersion}`).join('\n')

  /**
   * What asking for one texture's settings came to, keyed the same way the
   * fetch is. `null` means the settings arrived and are in the store; a string
   * is the reason there are none.
   */
  const [answers, setAnswers] = useState<Readonly<Record<string, string | null>>>({})

  useEffect(() => {
    if (wanted.length === 0) return

    let stopped = false
    const fresh = wanted.filter((one) => answers[`${one.path}@${one.settingsVersion}`] === undefined)
    if (fresh.length === 0) return

    void Promise.all(
      fresh.map(async (one): Promise<[string, string | null]> => {
        const at = `${one.path}@${one.settingsVersion}`
        // Taken before the question is asked: a late answer is
        // indistinguishable from a fresh one, and the store is what needs to be
        // able to tell them apart.
        const readStartedAt = beginRead()
        try {
          const response = await fetch(`/api/meta?path=${encodeURIComponent(one.path)}`, {
            cache: 'no-store',
          })
          if (!response.ok) return [at, 'the editor service would not answer about it']

          const view = MetaViewSchema.parse(await response.json())
          if (view.status === 'none') return [at, 'it has no import settings yet']
          if (view.status === 'unreadable' || view.meta === null) {
            return [at, view.problem ?? 'its import settings could not be read']
          }

          // Straight into the store, which is where every reader of these
          // settings looks — including the Inspector, if the human selects this
          // same texture in the Assets panel a moment later.
          adoptFromDisk(view.path, view.meta, readStartedAt)
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
  // actually changes — so editing a texture's filtering re-runs this and moving
  // an entity does not.
  const documents = useAllDocuments()

  return useMemo(() => {
    if (wanted.length === 0) return EMPTY

    const textures: Record<string, SceneTexture> = {}
    const problems: Record<string, TextureProblem> = {}
    let loading = false

    for (const one of wanted) {
      const node = tree === null ? null : findNode(tree, one.path)

      if (tree === null) {
        // Before the folder has been read everything is missing, and saying so
        // would be a lie.
        loading = true
        continue
      }

      if (node === null || node.kind !== 'file') {
        problems[one.path] = { kind: 'missing', path: one.path }
        continue
      }

      const answer = answers[`${one.path}@${one.settingsVersion}`]
      if (answer === undefined) {
        loading = true
        continue
      }
      if (answer !== null) {
        problems[one.path] = { kind: 'no-settings', path: one.path, detail: answer }
        continue
      }

      const document = documents[one.path]
      if (document === undefined || document.format !== 'kernel2d.asset-meta') {
        // The gap of one render between the answer arriving and the store
        // settling. Not a problem, just not ready.
        loading = true
        continue
      }

      const meta: AssetMeta = document
      if (meta.importSettings.type !== 'texture') {
        problems[one.path] = {
          kind: 'no-settings',
          path: one.path,
          detail: `its import settings say it is ${meta.importSettings.type}, not a texture`,
        }
        continue
      }

      if (one.expectedId !== meta.id) {
        problems[one.path] = {
          kind: 'different-file',
          path: one.path,
          expected: one.expectedId,
          found: meta.id,
        }
      }

      const settings: TextureImportSettings = meta.importSettings
      textures[one.path] = { version: node.mtimeMs, settings }
    }

    return { textures, problems, loading }
  }, [fetchKey, answers, documents, tree])
}

/** Every texture problem in a scene, most useful first, as one list. */
export function problemsIn(assets: SceneAssets): TextureProblem[] {
  return Object.values(assets.problems).sort((a, b) => a.path.localeCompare(b.path))
}

/** One problem, as the sentence a human reads. */
export function describeProblem(problem: TextureProblem): string {
  const name = problem.path.split('/').at(-1) ?? problem.path

  if (problem.kind === 'missing') {
    return `${name} is not in the project folder, so nothing is drawn for it. It is still referenced at ${problem.path}.`
  }

  if (problem.kind === 'no-settings') {
    return `${name} cannot be drawn: ${problem.detail}.`
  }

  return `${name} is not the file this scene was written against — it expected the one with id ${problem.expected} and found ${problem.found}. It is drawn anyway.`
}
