import { useState, type ReactElement } from 'react'

import { assetTypeForName, type AssetType } from '../../runtime/formats/meta-schema'
import type { AssetRef } from '../../runtime/formats/scene-schema'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { Row } from './fields'

/**
 * Which file something points at, as the `{ id, path }` pair every reference in
 * this kernel carries.
 *
 * **This is the one place a D5 reference is written**, and the reason it is
 * asynchronous: a reference carries the stable id as well as the path, and a
 * file's id lives in its own `.meta`. Picking one therefore asks the service
 * what that file's id is and then hands both halves back together. Writing only
 * the path would look identical today and lose the half of the reference that
 * survives a rename.
 *
 * Shared by everything that picks a file — a sprite's texture, a level's music,
 * and a game's own `asset` fields — rather than written per owner. What differs
 * between them is only *which* files are offered and *where the answer is
 * written*, so the caller supplies the kind and the transaction and this
 * supplies the reference. A third copy of the id lookup would be a third chance
 * to write half a reference, which is what the first two copies' own comments
 * warned about before this file existed.
 *
 * "Nothing" hands back `null`. What null means — no sprite, a silent level, a
 * door with no picture yet — is the caller's to say, on the empty option.
 */
export function AssetRefPicker({
  label,
  title,
  value,
  tree,
  of,
  testId,
  nothing,
  onPick,
}: {
  /** The row's label. */
  label: string
  /** The hover sentence, if the caller has one. */
  title?: string | undefined
  /** The reference as the document has it, or null for nothing chosen. */
  value: AssetRef | null
  tree: ProjectTree | null
  /** Which files to offer. Absent means any file that has import settings. */
  of?: AssetType | undefined
  testId: string
  /** What the empty option says. */
  nothing: string
  onPick: (reference: AssetRef | null) => void
}): ReactElement {
  const [problem, setProblem] = useState<string | null>(null)
  const files = tree === null ? [] : filesIn(tree, of)

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
      setProblem('Could not ask the editor service for that file. Is the editor command still running?')
    }
  }

  return (
    <>
      <Row label={label}>
        <select
          className="control control--choice"
          data-testid={testId}
          {...(title === undefined ? {} : { title })}
          value={value?.path ?? ''}
          onChange={(event) => void pick(event.target.value)}
        >
          <option value="">{nothing}</option>
          {files.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
          {/* A reference to a file that is gone still has to be shown as the
              current value, or the control would silently read as "Nothing"
              while the file it belongs to says otherwise. */}
          {value !== null && !files.includes(value.path) && (
            <option value={value.path}>{value.path} — not in the project</option>
          )}
        </select>
      </Row>
      {problem !== null && (
        <p className="inspector__note inspector__note--bad" data-testid={`${testId}-problem`}>
          {problem}
        </p>
      )}
    </>
  )
}

/**
 * Every file of the kind in the project, by path, in the order the folder lists
 * them — or every file that has a kind at all, when none is asked for.
 */
function filesIn(tree: ProjectTree, of: AssetType | undefined): string[] {
  const found: string[] = []

  const walk = (node: TreeNode): void => {
    if (node.kind === 'file') {
      const type = assetTypeForName(node.name)
      if (type !== null && (of === undefined || type === of)) found.push(node.path)
      return
    }
    for (const child of node.children) walk(child)
  }

  walk(tree.tree)
  return found
}
