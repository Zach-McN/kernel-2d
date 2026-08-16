import { useState, type ReactElement } from 'react'

import { SCENE_FORMAT } from '../../runtime/formats/scene-schema'
import { DocumentViewSchema } from '../../sidecar/document-view-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { documentPathsIn } from '../shell/references'
import { Row } from './fields'

/**
 * Which level something points at: the game's starting level, or a door's.
 *
 * Lifted out of the project settings panel the day a second owner arrived — a
 * game's own `scene` field (`runtime/formats/component-schema.ts`) — which is
 * the rule for sharing a control (`editor-ui` U25, pointed the usual way): what
 * the two have in common is now known rather than guessed, and it is everything
 * below. What differs is only where the answer is written, so the caller
 * supplies the transaction and this supplies the path.
 *
 * **Picking is checked before it is written, and that is the interesting part.**
 * Nothing about a path says whether the file at it is a level: `.json` covers
 * levels, prefabs, the settings and the data tables, and a folder called
 * `scenes/` is a convention in the folder map that this code is not allowed to
 * rely on (`editor-ui` U11/U22). So the list offers every document in the
 * project and the *pick* reads the file to find out what it is, refusing a
 * prefab by name instead of writing a door the export would later have to
 * complain about. That is the same round trip `AssetRefPicker` makes to fetch a
 * file's id, for a different reason: there is no id to fetch here (a level has
 * never carried one — `runtime/formats/project-schema.ts`), so the read buys the
 * *kind* rather than the reference.
 *
 * "Nothing" hands back `null`; what null means — no starting level, a door to
 * nowhere — is the caller's to say, in the sentence it puts on the option.
 */
export function LevelPicker({
  label,
  title,
  value,
  tree,
  testId,
  nothing,
  cannot = 'it cannot be chosen here',
  exclude,
  problemTestId = `${testId}-problem`,
  onPick,
}: {
  /** The row's label. */
  label: string
  /** The hover sentence, if the caller has one. */
  title?: string | undefined
  /** The path as the document has it, or null for nothing chosen. */
  value: string | null
  tree: ProjectTree | null
  testId: string
  /** What the empty option says — the caller's sentence about what nothing means. */
  nothing: string
  /** The clause after "…is not a level, so": what refusing means for the caller. */
  cannot?: string | undefined
  /** A document not to offer, if there is one — the settings file cannot start itself. */
  exclude?: string | undefined
  problemTestId?: string | undefined
  onPick: (path: string | null) => void
}): ReactElement {
  const [problem, setProblem] = useState<string | null>(null)
  const documents = tree === null ? [] : documentPathsIn(tree).filter((path) => path !== exclude)

  const pick = async (candidate: string): Promise<void> => {
    setProblem(null)

    if (candidate === '') {
      onPick(null)
      return
    }

    const kind = await levelKindOf(candidate)
    if (kind.state === 'unavailable') {
      setProblem('Could not ask the editor service about that file. Is the editor command still running?')
      return
    }
    if (kind.state !== 'level') {
      setProblem(`${basename(candidate)} ${kind.why}, so ${cannot}.`)
      return
    }

    onPick(candidate)
  }

  return (
    <>
      <Row label={label}>
        <select
          className="control control--choice"
          data-testid={testId}
          {...(title === undefined ? {} : { title })}
          value={value ?? ''}
          onChange={(event) => void pick(event.target.value)}
        >
          <option value="">{nothing}</option>
          {documents.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
          {/* A level that has since been moved or deleted still has to appear as
              the current value, or the control would read as "Nothing" while the
              file says otherwise. */}
          {value !== null && !documents.includes(value) && (
            <option value={value}>{value} — not in the project</option>
          )}
        </select>
      </Row>
      {problem !== null && (
        <p className="inspector__note inspector__note--bad" data-testid={problemTestId}>
          {problem}
        </p>
      )}
    </>
  )
}

// --- what a file turns out to be -------------------------------------------

export type LevelKind =
  | { state: 'level' }
  /** Anything else, with the clause that says so. */
  | { state: 'other'; why: string }
  | { state: 'unavailable' }

/**
 * Whether the file at a path is a level, asked of the service.
 *
 * The service's own sentence is used where it has one, because it knows things
 * this panel does not — whether the file parses, and what it says it is.
 * Paraphrasing that here would be two descriptions of one rule, of which one
 * goes stale. Exported for the settings panel's sentence about the level it
 * has, which asks the same question of the same file.
 */
export async function levelKindOf(path: string): Promise<LevelKind> {
  try {
    const response = await fetch(`/api/document?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    const view = DocumentViewSchema.parse(await response.json())

    if (view.status === 'none') return { state: 'other', why: 'is not in the project folder' }
    if (view.status === 'unreadable' || view.document === null) {
      return { state: 'other', why: `cannot be read — ${view.problem ?? 'this editor does not understand it'}` }
    }
    if (view.document.format !== SCENE_FORMAT) return { state: 'other', why: 'is not a level' }
    return { state: 'level' }
  } catch {
    return { state: 'unavailable' }
  }
}
