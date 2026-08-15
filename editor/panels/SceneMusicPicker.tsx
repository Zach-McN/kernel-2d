import { useState, type ReactElement } from 'react'

import { assetTypeForName } from '../../runtime/formats/meta-schema'
import { SCENE_FORMAT, type AssetRef } from '../../runtime/formats/scene-schema'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { useProject } from '../shell/project-context'
import { editDocument } from '../store/open-documents'

/**
 * Which sound this level plays while it runs — MP3, WAV or OGG from the
 * project folder, looping, chosen on the scene itself because it is a fact
 * about the level rather than about any entity in it.
 *
 * The same D5 shape as the texture picker, for the same reason: a reference
 * carries the stable id as well as the path, and a sound's id lives in its
 * `.meta`, so picking one asks the service for that file's id and writes both
 * halves together. "Nothing" removes the field rather than emptying it — a
 * silent level simply has no music, one state rather than two.
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
  const [problem, setProblem] = useState<string | null>(null)

  const tree: ProjectTree | null = project.state === 'ready' ? project.tree : null
  const sounds = tree === null ? [] : soundsIn(tree)

  const write = (reference: AssetRef | null): void => {
    editDocument(scenePath, { label: 'Music' }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      if (reference === null) delete document.music
      else document.music = reference
    })
  }

  const pick = async (path: string): Promise<void> => {
    setProblem(null)

    if (path === '') {
      write(null)
      return
    }

    try {
      const response = await fetch(`/api/meta?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const view = MetaViewSchema.parse(await response.json())
      if (view.status !== 'ok' || view.meta === null) {
        setProblem(
          `${basename(path)} has no import settings yet, so there is no id to point at. Try again in a moment.`,
        )
        return
      }
      write({ id: view.meta.id, path })
    } catch {
      setProblem('Could not ask the editor service for that sound. Is the editor command still running?')
    }
  }

  return (
    <>
      <div className="inspector__field">
        <span className="inspector__label">Music</span>
        <span className="control-row">
          <select
            className="control control--choice"
            data-testid="scene-music-control"
            value={value?.path ?? ''}
            onChange={(event) => void pick(event.target.value)}
          >
            <option value="">Nothing — this level is silent</option>
            {sounds.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
            {/* A reference to a file that is gone is still the current value,
                or the control would read "silent" while the file disagrees. */}
            {value !== null && !sounds.includes(value.path) && (
              <option value={value.path}>{value.path} — not in the project</option>
            )}
          </select>
        </span>
      </div>
      <p className="inspector__note" data-testid="scene-music-note">
        Plays on a loop while the level runs — behind the Play button and in an exported game. Editing
        stays silent.
      </p>
      {problem !== null && (
        <p className="inspector__note inspector__note--bad" data-testid="scene-music-problem">
          {problem}
        </p>
      )}
    </>
  )
}

/** Every sound in the project, by path, in the order the folder lists them. */
function soundsIn(tree: ProjectTree): string[] {
  const found: string[] = []

  const walk = (node: TreeNode): void => {
    if (node.kind === 'file') {
      if (assetTypeForName(node.name) === 'audio') found.push(node.path)
      return
    }
    for (const child of node.children) walk(child)
  }

  walk(tree.tree)
  return found
}
