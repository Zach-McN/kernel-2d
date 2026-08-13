import { useEffect, useState, type ReactElement } from 'react'

import { PROJECT_FORMAT, type Project } from '../../runtime/formats/project-schema'
import { SCENE_FORMAT } from '../../runtime/formats/scene-schema'
import { DocumentViewSchema } from '../../sidecar/document-view-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { documentPathsIn } from '../shell/references'
import { editDocument } from '../store/open-documents'
import { Note, Section } from './fields'

/**
 * The project's settings: which level the game starts on.
 *
 * The third inspector body, and the one that turns an exported game from a folder
 * of files into a game — an export has to know where to begin, and this is the only
 * place that answer is written down.
 *
 * Built over the document in the store rather than the answer the service gave, for
 * the reason every editable control here is (`editor-ui` U12): the transaction API
 * can only change a document the store is holding, so a control over the served
 * copy would look perfectly correct and quietly do nothing. Because it *is* an
 * ordinary document, choosing a level is one press of Ctrl-Z, is written after the
 * usual quiet period, and survives a reload — none of which is code written here.
 *
 * **Picking is checked before it is written, and that is the interesting part.**
 * Nothing about a path says whether the file at it is a level: `.json` covers
 * levels, prefabs, these settings and the data tables, and a folder called
 * `scenes/` is a convention in the folder map that this code is not allowed to rely
 * on (`editor-ui` U11/U22). So the list offers every document in the project and the
 * *pick* reads the file to find out what it is, refusing a prefab by name instead of
 * writing a startup level the export would later have to complain about. That is
 * the same round trip `TexturePicker` makes to fetch a texture's id, for a different
 * reason: there is no id to fetch here (a level has never carried one — see
 * `runtime/formats/project-schema.ts`), so the read buys the *kind* rather than the
 * reference.
 *
 * The picker is not lifted into a file of its own, deliberately. There is exactly
 * one thing in the kernel that points at a level; sharing it before a second owner
 * exists would be guessing at what the two have in common (`editor-ui` U25's rule,
 * pointed the other way).
 */
export function ProjectInspector({
  path,
  project,
  tree,
}: {
  path: string
  project: Project
  tree: ProjectTree | null
}): ReactElement {
  const [problem, setProblem] = useState<string | null>(null)
  const documents = tree === null ? [] : documentsIn(tree, path)
  const chosen = project.startupScene

  const setStartupScene = (scene: string | null): void => {
    editDocument(path, { label: scene === null ? 'Clear the starting level' : 'Set the starting level' }, (document) => {
      if (document.format !== PROJECT_FORMAT) return
      document.startupScene = scene
    })
  }

  const pick = async (candidate: string): Promise<void> => {
    setProblem(null)

    if (candidate === '') {
      setStartupScene(null)
      return
    }

    const kind = await kindOf(candidate)
    if (kind.state === 'unavailable') {
      setProblem('Could not ask the editor service about that file. Is the editor command still running?')
      return
    }
    if (kind.state !== 'level') {
      setProblem(`${basename(candidate)} ${kind.why}, so the game cannot start on it.`)
      return
    }

    setStartupScene(candidate)
  }

  return (
    <>
      <Section title="Starting level">
        <div className="inspector__field">
          <span className="inspector__label">Level</span>
          <span className="control-row">
            <select
              className="control control--choice"
              data-testid="project-startup-control"
              value={chosen ?? ''}
              onChange={(event) => void pick(event.target.value)}
            >
              <option value="">Nothing — the game has no level to start on</option>
              {documents.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
              {/* A level that has since been moved or deleted still has to appear
                  as the current value, or the control would read as "Nothing"
                  while the file says otherwise. */}
              {chosen !== null && !documents.includes(chosen) && (
                <option value={chosen}>{chosen} — not in the project</option>
              )}
            </select>
          </span>
        </div>

        {problem !== null && (
          <p className="inspector__note inspector__note--bad" data-testid="project-startup-problem">
            {problem}
          </p>
        )}

        <StartupSceneState path={chosen} />
      </Section>

      <Section title="What is in here">
        <Note>
          The starting level is the whole of this file for now. An input map, a window size and everything
          else the game will eventually want arrive with the features that read them.
        </Note>
      </Section>
    </>
  )
}

/**
 * What the chosen level actually is, right now.
 *
 * The point of the sentence is criterion-shaped rather than decorative: a startup
 * level that has been renamed in Explorer should be findable here, before the export
 * command refuses over it. It re-asks whenever the choice changes, which is also
 * whenever the file it names might have.
 */
function StartupSceneState({ path }: { path: string | null }): ReactElement {
  const [state, setState] = useState<{ forPath: string | null; kind: Kind | null }>({
    forPath: null,
    kind: null,
  })

  useEffect(() => {
    if (path === null) return
    let stopped = false
    void kindOf(path).then((kind) => {
      if (!stopped) setState({ forPath: path, kind })
    })
    return () => {
      stopped = true
    }
  }, [path])

  if (path === null) {
    return (
      <Note data-testid="project-startup-note">
        Nothing is chosen, so there is nothing to export. Pick a level above.
      </Note>
    )
  }

  // Compared at render time rather than cleared in an effect, so this can never
  // describe the level chosen a moment ago (`editor-ui` UG5).
  if (state.forPath !== path || state.kind === null) {
    return <Note data-testid="project-startup-note">Reading {basename(path)}…</Note>
  }

  if (state.kind.state === 'level') {
    return (
      <Note data-testid="project-startup-note">
        The game starts on {basename(path)}. Export it with <code>npm run export</code>.
      </Note>
    )
  }

  if (state.kind.state === 'unavailable') {
    return (
      <Note data-testid="project-startup-note">
        Could not ask the editor service about {basename(path)}.
      </Note>
    )
  }

  return (
    <p className="inspector__note inspector__note--bad" data-testid="project-startup-note">
      {basename(path)} {state.kind.why}, so an export will refuse until this is pointed at a level.
    </p>
  )
}

// --- what a file turns out to be -------------------------------------------

type Kind =
  | { state: 'level' }
  /** Anything else, with the clause that says so. */
  | { state: 'other'; why: string }
  | { state: 'unavailable' }

/**
 * Whether the file at a path is a level, asked of the service.
 *
 * The service's own sentence is used where it has one, because it knows things this
 * panel does not — whether the file parses, and what it says it is. Paraphrasing
 * that here would be two descriptions of one rule, of which one goes stale.
 */
async function kindOf(path: string): Promise<Kind> {
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

/**
 * Every document in the project, by path, in the order the folder lists them.
 *
 * Every `.json` rather than every level, because deciding which of them is a level
 * would mean reading all of them — and the pick already reads the one that was
 * chosen, which is the file that matters. The settings file itself is left out: a
 * game cannot start on its own settings, and offering it would be offering a
 * mistake.
 *
 * The walk itself is `documentPathsIn`, shared with the rename fixup the moment a
 * second caller wanted it. What is *not* shared is this exclusion, which is about
 * what a game can start on rather than about which files are documents.
 */
function documentsIn(tree: ProjectTree, exclude: string): string[] {
  return documentPathsIn(tree).filter((path) => path !== exclude)
}
