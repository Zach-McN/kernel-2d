import { useEffect, useMemo, useState } from 'react'

import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema'
import { beginRead } from '../store/open-documents'
import { findNode } from './asset-kinds'

/**
 * Following the references in a level: which files they point at, whether each
 * one is usable, and putting what arrives into the document store.
 *
 * There are two of these — the textures a level draws and the prefabs it places
 * from — and they were the same ninety lines written twice. The mechanism is
 * identical and the *vocabulary* is not, so this holds the mechanism and each
 * caller keeps its own sentences: "it has no import settings yet" and "that file
 * is not a prefab" are different things to tell a human.
 *
 * The parts that are easy to get subtly wrong, and are now written once:
 *
 *   - **Keyed on the file's modification time as well as its path**, so a file
 *     edited in a text editor is asked for again while an unrelated change to
 *     the folder is not (`editor-kernel` G11).
 *   - **A read token is taken before the question is asked**, not after the
 *     answer arrives: a late answer is indistinguishable from a fresh one, and
 *     the store is what needs to be able to tell them apart.
 *   - **Asked once per key.** A path whose answer is already held is not asked
 *     about again, whatever else re-renders.
 *   - **The folder is checked before the answer is.** Before the tree has been
 *     read, everything looks missing and saying so would be a lie; after it has,
 *     a path with no file at it is missing regardless of what any fetch said.
 *   - **"Not ready" is not a problem.** There is a render between an answer
 *     arriving and the store settling, and reporting that gap as a fault makes
 *     panels flicker a sentence nobody can act on.
 */

/** One reference to follow: where to look, and which file was expected there. */
export interface Reference {
  path: string
  /** The id the level recorded. The witness half of D5. */
  expectedId: string
  /** When the file this depends on last changed, or 0 when there is none. */
  version: number
}

/**
 * What one reference came to. `null` means it arrived and is in the store; a
 * string is the plain-language reason it did not.
 */
export type Answer = string | null

/** What a caller learned about one reference, in the order it should be read. */
export type ReferenceState =
  /** The folder or the answer has not arrived. Not a fault — just not ready. */
  | { kind: 'loading' }
  /** No file at that path. */
  | { kind: 'missing' }
  /** There is a file and it is not usable. The sentence is the caller's. */
  | { kind: 'unusable'; detail: string }
  /** It arrived. `node` is its entry in the folder, for anything that needs its mtime. */
  | { kind: 'ready'; node: Extract<TreeNode, { kind: 'file' }> }

/**
 * Builds the sorted, mtime-keyed reference list a caller hands back to
 * `useReferences`.
 *
 * Sorted because this drives an effect through a joined string key, and an array
 * in a different order every render would re-fetch the world. Deduplicated
 * because fifty slimes pointing at one prefab is one question, not fifty.
 */
export function referencesTo(
  byPath: ReadonlyMap<string, string>,
  tree: ProjectTree | null,
  /** Which file's modification time keys this reference — the target, or something beside it. */
  versionOf: (path: string) => string = (path) => path,
): Reference[] {
  return [...byPath.entries()]
    .map(([path, expectedId]) => {
      const node = tree === null ? null : findNode(tree, versionOf(path))
      return { path, expectedId, version: node !== null && node.kind === 'file' ? node.mtimeMs : 0 }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

export interface Followed {
  /** What is known about each reference, by path. */
  states: Readonly<Record<string, ReferenceState>>
  /** True while at least one of them is still in the air. */
  loading: boolean
  /** The key the fetch is running on. Stable to depend on in a `useMemo`. */
  key: string
}

/**
 * Asks about each reference once and reports what came back.
 *
 * `ask` is the caller's: it fetches, decides whether the answer is usable, and
 * puts it in the document store if it is. It is handed the read token to pass to
 * `adoptFromDisk`, so the ordering rule above stays in one place rather than
 * being remembered at each call site.
 */
export function useReferences(
  wanted: readonly Reference[],
  tree: ProjectTree | null,
  ask: (path: string, readStartedAt: number) => Promise<Answer>,
): Followed {
  const key = wanted.map((one) => `${one.path}@${one.version}`).join('\n')

  const [answers, setAnswers] = useState<Readonly<Record<string, Answer>>>({})

  useEffect(() => {
    if (wanted.length === 0) return

    let stopped = false
    const fresh = wanted.filter((one) => answers[`${one.path}@${one.version}`] === undefined)
    if (fresh.length === 0) return

    void Promise.all(
      fresh.map(async (one): Promise<[string, Answer]> => {
        const at = `${one.path}@${one.version}`
        const readStartedAt = beginRead()
        try {
          return [at, await ask(one.path, readStartedAt)]
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
  }, [key])

  // Memoized so a caller can depend on `states` without recomputing every
  // render — the answers map and the folder are both stable until they change.
  return useMemo(() => {
    const states: Record<string, ReferenceState> = {}
    let loading = false

    for (const one of wanted) {
      // Before the folder has been read everything looks missing, and saying so
      // would be a lie.
      if (tree === null) {
        states[one.path] = { kind: 'loading' }
        loading = true
        continue
      }

      const node = findNode(tree, one.path)
      if (node === null || node.kind !== 'file') {
        states[one.path] = { kind: 'missing' }
        continue
      }

      const answer = answers[`${one.path}@${one.version}`]
      if (answer === undefined) {
        states[one.path] = { kind: 'loading' }
        loading = true
        continue
      }

      states[one.path] = answer === null ? { kind: 'ready', node } : { kind: 'unusable', detail: answer }
    }

    return { states, loading, key }
  }, [key, answers, tree])
}
