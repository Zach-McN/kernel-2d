import { useEffect, useState, type ReactElement } from 'react'

import { PROJECT_FORMAT, type Project } from '../../runtime/formats/project-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { editDocument } from '../store/open-documents'
import { Note, Section } from './fields'
import { LevelPicker, levelKindOf, type LevelKind } from './LevelPicker'

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
 * The picker itself is `LevelPicker`, shared with a game's own `scene` fields
 * since the day those arrived — one thing in the kernel pointed at a level for a
 * while, and it stayed here until a second owner said what the two had in
 * common (`editor-ui` U25). What is this panel's alone is the exclusion — a game
 * cannot start on its own settings file — and the sentence about what the chosen
 * level turns out to be.
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
  const chosen = project.startupScene

  const setStartupScene = (scene: string | null): void => {
    editDocument(path, { label: scene === null ? 'Clear the starting level' : 'Set the starting level' }, (document) => {
      if (document.format !== PROJECT_FORMAT) return
      document.startupScene = scene
    })
  }

  return (
    <>
      <Section title="Starting level">
        <LevelPicker
          label="Level"
          value={chosen}
          tree={tree}
          testId="project-startup-control"
          problemTestId="project-startup-problem"
          nothing="Nothing — the game has no level to start on"
          cannot="the game cannot start on it"
          exclude={path}
          onPick={setStartupScene}
        />

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
  const [state, setState] = useState<{ forPath: string | null; kind: LevelKind | null }>({
    forPath: null,
    kind: null,
  })

  useEffect(() => {
    if (path === null) return
    let stopped = false
    void levelKindOf(path).then((kind) => {
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
