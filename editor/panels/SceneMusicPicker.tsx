import type { ReactElement } from 'react'

import { SCENE_FORMAT, type AssetRef } from '../../runtime/formats/scene-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { useProject } from '../shell/project-context'
import { editDocument } from '../store/open-documents'
import { AssetRefPicker } from './AssetRefPicker'

/**
 * Which sound this level plays while it runs — MP3, WAV or OGG from the
 * project folder, looping, chosen on the scene itself because it is a fact
 * about the level rather than about any entity in it.
 *
 * The picking is `AssetRefPicker`, the same D5 shape as every other reference:
 * a sound's id lives in its `.meta`, so picking one asks the service for that
 * file's id and writes both halves together. "Nothing" removes the field rather
 * than emptying it — a silent level simply has no music, one state rather than
 * two.
 *
 * The edit goes through the transaction API like every other, so choosing a
 * track is one press of Ctrl-Z and the choice is on disk within the second.
 * Nothing plays here: the editor is silent, and the run is what asks
 * (`editor/shell/running-level.ts`).
 */
export function SceneMusicPicker({
  scenePath,
  value,
}: {
  scenePath: string
  /** The reference as the document has it, or null for a silent level. */
  value: AssetRef | null
}): ReactElement {
  const project = useProject()
  const tree: ProjectTree | null = project.state === 'ready' ? project.tree : null

  const write = (reference: AssetRef | null): void => {
    editDocument(scenePath, { label: 'Music' }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      if (reference === null) delete document.music
      else document.music = reference
    })
  }

  return (
    <>
      <AssetRefPicker
        label="Music"
        value={value}
        tree={tree}
        of="audio"
        testId="scene-music-control"
        nothing="Nothing — this level is silent"
        onPick={write}
      />
      <p className="inspector__note" data-testid="scene-music-note">
        Plays on a loop while the level runs — behind the Play button and in an exported game. Editing
        stays silent.
      </p>
    </>
  )
}
