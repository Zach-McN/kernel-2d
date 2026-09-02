import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react'

import type { AssetMeta, TextureImportSettings } from '../../runtime/formats/meta-schema'
import { ASSET_META_FORMAT, metaPathFor } from '../../runtime/formats/meta-schema'
import { textureRefsOf, type Entity } from '../../runtime/formats/scene-schema'
import type { SceneTexture } from '../../runtime'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { adoptFromDisk, useAllDocuments } from '../store/open-documents'
import { basename } from './asset-kinds'
import { useProject } from './project-context'
import { useResolvedScene } from './scene-prefabs'
import { referencesTo, useReferences, type Answer } from './useReferences'

/**
 * Turning the texture references in a level into something the renderer can
 * draw, and saying what is wrong with the ones it cannot.
 *
 * It is handed the level's **resolved** entities rather than the scene document,
 * because an instance's picture is named by the prefab it points at — so which
 * textures a level needs cannot be known from the file alone. That is why
 * `scene-prefabs.tsx` sits above this one.
 *
 * **This was the first code to honour D5**, which had been written down since day
 * one and had nothing obeying it. A reference carries a stable id *and* a
 * readable path, and the two are used differently:
 *
 *   - **the path resolves it.** It is looked up in the project folder, which is
 *     what makes a scene greppable and lets a session understand a level by
 *     reading it;
 *   - **the id is the witness.** Once the file is found, the id in its `.meta`
 *     is compared with the one the scene recorded. Disagreement means the
 *     reference now points at a *different file* than the one it was written
 *     against — somebody swapped two textures, or restored one from a backup.
 *
 * `scene-prefabs.tsx` does the same three things for a prefab reference, and the
 * only difference is where the id is read from: a texture's lives in the `.meta`
 * beside it, a prefab's inside the document itself (`editor-kernel` D24).
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

/**
 * The textures a level's entities point at, deduplicated, with the id each
 * recorded.
 *
 * Every `texture`-named reference in every component, not only the sprite's —
 * the same walk the runtime's own loader does (`textureRefsOf`), because the
 * editing picture and the Play picture must want the same set or a texture a
 * game's systems spawn things from would resolve in one and not the other.
 */
function texturesWantedBy(entities: readonly Entity[]): Map<string, string> {
  const byPath = new Map<string, string>()
  for (const entity of entities) {
    for (const ref of textureRefsOf(entity)) {
      if (!byPath.has(ref.path)) byPath.set(ref.path, ref.id)
    }
  }
  return byPath
}

/**
 * Read once per window, shared by every panel that needs it.
 *
 * Three panels ask what a level's textures resolve to — the Viewport draws them,
 * the Outliner marks the entities that cannot be drawn, and the Inspector
 * explains why. Three callers of the hook would be three sets of requests kept
 * on three timers, and a panel a beat behind its neighbour with nothing on
 * screen saying which one is right (`editor-ui` U9). Above the layout, because
 * this fetch also writes into the document store: owned by a panel, closing that
 * tab would stop the other two working for no visible reason.
 */
const SceneAssetsContext = createContext<SceneAssets | null>(null)

export function SceneAssetsProvider({ children }: { children: ReactNode }): ReactElement {
  const resolved = useResolvedScene()
  const project = useProject()

  // The *resolved* entities, not the scene's own: an instance's picture is named
  // by the prefab it points at, so a level's textures cannot be known from the
  // file alone.
  const assets = useResolvedSceneAssets(resolved.entities, project.state === 'ready' ? project.tree : null)

  return <SceneAssetsContext.Provider value={assets}>{children}</SceneAssetsContext.Provider>
}

export function useSceneAssets(): SceneAssets {
  const assets = useContext(SceneAssetsContext)
  if (assets === null) throw new Error('useSceneAssets was called outside the editor shell')
  return assets
}

/**
 * Asking the service for one texture's import settings, and putting them in the
 * store — which is where every reader of them looks, including the Inspector if
 * the human selects this same texture in the Assets panel a moment later.
 */
async function askForSettings(path: string, readStartedAt: number): Promise<Answer> {
  const response = await fetch(`/api/meta?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
  if (!response.ok) return 'the editor service would not answer about it'

  const view = MetaViewSchema.parse(await response.json())
  if (view.status === 'none') return 'it has no import settings yet'
  if (view.status === 'unreadable' || view.meta === null) {
    return view.problem ?? 'its import settings could not be read'
  }

  adoptFromDisk(view.path, view.meta, readStartedAt)
  return null
}

function useResolvedSceneAssets(entities: readonly Entity[], tree: ProjectTree | null): SceneAssets {
  // Keyed on the `.meta` beside each texture rather than on the texture itself:
  // what is being asked for here is the settings, and those change when the
  // sidecar does.
  const wanted = referencesTo(texturesWantedBy(entities), tree, metaPathFor)
  const followed = useReferences(wanted, tree, askForSettings)

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
        problems[one.path] = { kind: 'no-settings', path: one.path, detail: state.detail }
        continue
      }

      const document = documents[one.path]
      if (document === undefined || document.format !== ASSET_META_FORMAT) {
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
      // The texture's own modification time, which is what the renderer uses to
      // notice the bytes changed (`editor-kernel` G11).
      textures[one.path] = { version: state.node.mtimeMs, settings }
    }

    return { textures, problems, loading }
  }, [followed, documents])
}

/** Every texture problem in a scene, most useful first, as one list. */
export function problemsIn(assets: SceneAssets): TextureProblem[] {
  return Object.values(assets.problems).sort((a, b) => a.path.localeCompare(b.path))
}

/** One problem, as the sentence a human reads. */
export function describeProblem(problem: TextureProblem): string {
  const name = basename(problem.path)

  if (problem.kind === 'missing') {
    return `${name} is not in the project folder, so nothing is drawn for it. It is still referenced at ${problem.path}.`
  }

  if (problem.kind === 'no-settings') {
    return `${name} cannot be drawn: ${problem.detail}.`
  }

  return `${name} is not the file this scene was written against — it expected the one with id ${problem.expected} and found ${problem.found}. It is drawn anyway.`
}
