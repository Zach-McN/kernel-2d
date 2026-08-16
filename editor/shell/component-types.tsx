import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react'

import { COMPONENT_FORMAT, type ComponentDescription } from '../../runtime/formats/component-schema'
import { DocumentViewSchema } from '../../sidecar/document-view-schema'
import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema'
import { adoptFromDisk, useAllDocuments } from '../store/open-documents'
import { findNode } from './asset-kinds'
import { useProject } from './project-context'
import { referencesTo, useReferences, type Answer } from './useReferences'

/**
 * What this game's own components are, as the game itself describes them.
 *
 * **The whole vocabulary of the open project, read once per window** (`editor-ui`
 * U9) — the Inspector asks it what fields to draw, and the description file's own
 * panel asks it who else claims a type. Two panels reading the same folder twice
 * would be two answers to "does this game have a patrol", which is exactly the
 * duplication the shell contexts exist to prevent.
 *
 * **They are found by listing a folder, not by being pointed at**, and that is
 * the one way this differs from the prefabs a level places. A level names the
 * prefabs it wants; nothing names a component description, because the whole
 * point is that a level carrying `patrol` says nothing about where `patrol` is
 * described. So the folder is the index: every `.json` directly inside
 * `components/` is asked about, and a file that turns out not to be a
 * description is reported rather than ignored.
 *
 * The *following* is nonetheless the same mechanism (`./useReferences.ts`) that
 * the textures and the prefabs use, with an empty witness. That is honest rather
 * than a shortcut: the id in a reference exists to notice that the file at a path
 * is no longer the file somebody wrote against, and nothing was written against
 * this file's identity — it is found by looking, so there is nothing to witness.
 * What the mechanism is actually for here is the rest of it: asked once per path
 * and modification time, a read token taken before the question, the folder
 * checked before the answer.
 *
 * Nothing here is in a document and nothing is undoable. The descriptions
 * themselves are ordinary documents in the store, so a change to one on disk
 * reaches the Inspector the same way every other file does.
 */

/** Where a game keeps them. One folder, at the top, beside `scenes/` and `prefabs/`. */
export const COMPONENTS_FOLDER = 'components'

export interface ComponentTypes {
  /**
   * Every described component, by the type it describes.
   *
   * The type is the key rather than the path, because the type is what a level
   * carries — the Inspector holds `patrol` and needs the fields for it, and
   * which file they came from is a detail it never has to know.
   */
  byType: Readonly<Record<string, ComponentDescription>>
  /** Which file each described type came from, for a panel that has to name it. */
  fileOf: Readonly<Record<string, string>>
  /**
   * Files in the folder that describe nothing usable, by path, with the reason.
   *
   * Includes the losing half of a type claimed twice — a file that parsed
   * perfectly and is not being used, which is the case most worth saying out
   * loud, because nothing else about it looks wrong.
   */
  problems: Readonly<Record<string, string>>
  /** True while at least one of them is still in the air. */
  loading: boolean
}

const EMPTY: ComponentTypes = { byType: {}, fileOf: {}, problems: {}, loading: false }

const ComponentTypesContext = createContext<ComponentTypes | null>(null)

export function ComponentTypesProvider({ children }: { children: ReactNode }): ReactElement {
  const project = useProject()
  const types = useDescriptions(project.state === 'ready' ? project.tree : null)

  return <ComponentTypesContext.Provider value={types}>{children}</ComponentTypesContext.Provider>
}

export function useComponentTypes(): ComponentTypes {
  const types = useContext(ComponentTypesContext)
  if (types === null) throw new Error('useComponentTypes was called outside the editor shell')
  return types
}

/**
 * Every `.json` directly inside `components/`, sorted.
 *
 * Not recursive, deliberately: a folder inside `components/` is somewhere to put
 * things that are not descriptions — notes, a draft, art for a panel that does
 * not exist yet — and a walker that went looking would report every one of them
 * as a broken description.
 */
function descriptionFilesIn(tree: ProjectTree | null): string[] {
  if (tree === null) return []
  const folder = findNode(tree, COMPONENTS_FOLDER)
  if (folder === null || folder.kind !== 'directory') return []

  return folder.children
    .filter((child: TreeNode): child is Extract<TreeNode, { kind: 'file' }> => child.kind === 'file')
    .filter((child) => child.ext === '.json')
    .map((child) => child.path)
    .sort((a, b) => a.localeCompare(b))
}

/** Asking the service for one description, and putting it in the store. */
async function askForDescription(path: string, readStartedAt: number): Promise<Answer> {
  const response = await fetch(`/api/document?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
  if (!response.ok) return 'the editor service would not answer about it'

  const view = DocumentViewSchema.parse(await response.json())
  if (view.status === 'none') return 'there is no file there'
  if (view.status === 'unreadable' || view.document === null) return view.problem ?? 'it could not be read'
  if (view.document.format !== COMPONENT_FORMAT) {
    return `that file is a ${view.document.format}, not a component description`
  }

  adoptFromDisk(view.path, view.document, readStartedAt)
  return null
}

function useDescriptions(tree: ProjectTree | null): ComponentTypes {
  // An empty expected id: there is nothing to witness (see the header). The
  // version still comes from the file's own modification time, which is what
  // makes a description edited in a text editor arrive without a reload.
  const wanted = referencesTo(new Map(descriptionFilesIn(tree).map((path) => [path, ''])), tree)
  const followed = useReferences(wanted, tree, askForDescription)
  const documents = useAllDocuments()

  return useMemo(() => {
    if (wanted.length === 0) return EMPTY

    const byType: Record<string, ComponentDescription> = {}
    const fileOf: Record<string, string> = {}
    const problems: Record<string, string> = {}
    let loading = false

    for (const one of wanted) {
      const state = followed.states[one.path]

      if (state === undefined || state.kind === 'loading') {
        loading = true
        continue
      }
      if (state.kind === 'missing') {
        // The folder said it was there and it is not: a file deleted between
        // the listing and the question. It will be gone from the next listing.
        continue
      }
      if (state.kind === 'unusable') {
        problems[one.path] = state.detail
        continue
      }

      const document = documents[one.path]
      if (document === undefined || document.format !== COMPONENT_FORMAT) {
        // The gap of one render between the answer arriving and the store
        // settling. Not a problem, just not ready.
        loading = true
        continue
      }

      // Two files claiming one type is a state the format cannot prevent — a
      // type is a word, and words can be written twice. The first by path wins
      // because the list is sorted and something has to, and the loser is
      // reported by name rather than dropped: a description that parsed
      // perfectly and does nothing is the hardest kind of file to debug by
      // staring at it.
      const already = fileOf[document.type]
      if (already !== undefined) {
        problems[one.path] = `${already} already describes ${document.type}, so this file is not being used`
        continue
      }

      byType[document.type] = document
      fileOf[document.type] = one.path
    }

    return { byType, fileOf, problems, loading }
    // `followed.key` rather than `wanted`, which is rebuilt every render.
  }, [followed.key, followed.states, documents])
}
