import { createHash } from 'node:crypto'

/**
 * Ids for generated content, derived from a path rather than minted at random.
 *
 * That is what makes this generator re-runnable: the same folder produces the
 * same bytes every time, so a re-run leaves no diff and the noise of churn
 * never hides a real change (`editor-kernel` G4).
 *
 * The sidecar mints random ids for files a human drops in, and the editor mints
 * random ones for entities. Ids are opaque, so the three ways of making one
 * never have to agree on anything except being unique (text-formats T5).
 */

function digest(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16)
}

/**
 * The id in a generated asset's `.meta`, and in every reference to it.
 *
 * Also the id a generated *document* carries inside itself, where it has one — a
 * prefab has no `.meta` because a document is its own annotation, and one
 * function serving both is the point of ids being opaque.
 */
export function sampleAssetId(projectRelativePath: string): string {
  return digest(projectRelativePath)
}

/** The id of one entity in a generated scene. Stable across re-runs. */
export function sampleEntityId(scenePath: string, index: number): string {
  return digest(`${scenePath}#entity#${index}`)
}
