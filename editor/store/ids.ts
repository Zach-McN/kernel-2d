/**
 * Minting an id in the editor.
 *
 * 16 lowercase hex characters — 64 bits, far past the point where two entities
 * in one scene could collide, and still short enough to read out. The same
 * convention the service uses for asset ids, deliberately: an id is opaque, so
 * the only thing that matters is that everything producing one produces the
 * same *shape* of thing, and a human looking at two ids in a project folder
 * should not have to wonder why they look different.
 *
 * Not shared with the service's minting function, which is `node:crypto` and
 * would drag a Node module into the browser (editor-kernel D16). The sample
 * generator mints differently again, deriving ids from paths so that re-running
 * it produces identical bytes (text-formats T5).
 */
export function mintEntityId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
