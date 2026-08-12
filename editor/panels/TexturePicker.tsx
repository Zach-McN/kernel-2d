import { useState, type ReactElement } from 'react'

import { assetTypeForName } from '../../runtime/formats/meta-schema'
import type { AssetRef } from '../../runtime/formats/scene-schema'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'

/**
 * Which texture something draws.
 *
 * **This is the one place a D5 reference is written**, and the reason it is
 * asynchronous: a reference carries the stable id as well as the path, and a
 * texture's id lives in its own `.meta`. Picking one therefore asks the service
 * what that file's id is and then hands both halves back together. Writing only
 * the path would look identical today and lose the half of the reference that
 * survives a rename.
 *
 * Shared by an entity and a prefab rather than written twice. What differs
 * between them is only *where the answer is written* — an entity's sprite
 * component in a scene, or a prefab's in its own file — so the caller supplies
 * the transaction and this supplies the reference. Two copies of the id lookup
 * would be two chances to write half a reference.
 *
 * "Nothing" removes the whole sprite rather than emptying a field, which is why
 * `onPick` is handed `null` rather than an empty path. A sprite component that
 * draws nothing is a shape the format does not need, and removing it is what
 * makes "has no picture" one thing rather than two.
 */
export function TexturePicker({
  value,
  tree,
  testId,
  onPick,
}: {
  /** The reference as it stands, or null when there is no sprite. */
  value: AssetRef | null
  tree: ProjectTree | null
  testId: string
  onPick: (reference: AssetRef | null) => void
}): ReactElement {
  const [problem, setProblem] = useState<string | null>(null)
  const textures = tree === null ? [] : texturesIn(tree)

  const pick = async (path: string): Promise<void> => {
    setProblem(null)

    if (path === '') {
      onPick(null)
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
      onPick({ id: view.meta.id, path })
    } catch {
      setProblem('Could not ask the editor service for that texture. Is the editor command still running?')
    }
  }

  return (
    <>
      <div className="inspector__field">
        <span className="inspector__label">Texture</span>
        <span className="control-row">
          <select
            className="control control--choice"
            data-testid={testId}
            value={value?.path ?? ''}
            onChange={(event) => void pick(event.target.value)}
          >
            <option value="">Nothing — this draws no sprite</option>
            {textures.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
            {/* A reference to a file that is gone still has to be shown as the
                current value, or the control would silently read as "Nothing"
                while the file it belongs to says otherwise. */}
            {value !== null && !textures.includes(value.path) && (
              <option value={value.path}>{value.path} — not in the project</option>
            )}
          </select>
        </span>
      </div>
      {problem !== null && (
        <p className="inspector__note inspector__note--bad" data-testid={`${testId}-problem`}>
          {problem}
        </p>
      )}
    </>
  )
}

/** Every texture in the project, by path, in the order the folder lists them. */
function texturesIn(tree: ProjectTree): string[] {
  const found: string[] = []

  const walk = (node: TreeNode): void => {
    if (node.kind === 'file') {
      if (assetTypeForName(node.name) === 'texture') found.push(node.path)
      return
    }
    for (const child of node.children) walk(child)
  }

  walk(tree.tree)
  return found
}
