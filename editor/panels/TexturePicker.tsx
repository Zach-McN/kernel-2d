import type { ReactElement } from 'react'

import type { AssetRef } from '../../runtime/formats/scene-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { AssetRefPicker } from './AssetRefPicker'

/**
 * Which texture something draws.
 *
 * The picking itself — offering the textures, fetching the id, handing back
 * both halves — is `AssetRefPicker`, shared with every other reference the
 * editor writes. What this owns is the sentence.
 *
 * Shared by an entity and a prefab rather than written twice. What differs
 * between them is only *where the answer is written* — an entity's sprite
 * component in a scene, or a prefab's in its own file — so the caller supplies
 * the transaction.
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
  return (
    <AssetRefPicker
      label="Texture"
      value={value}
      tree={tree}
      of="texture"
      testId={testId}
      nothing="Nothing — this draws no sprite"
      onPick={onPick}
    />
  )
}
