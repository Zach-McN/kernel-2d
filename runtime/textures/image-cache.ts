import type Phaser from 'phaser'

/**
 * One image cache for both renderers: fetched-and-decoded images, evicted least
 * recently used, taking their GPU textures with them.
 *
 * Shared because the texture preview and the scene view had grown byte-identical
 * copies of all three helpers, and an eviction rule that exists twice disagrees
 * the first time either copy changes. The only difference between the callers is
 * what must survive eviction — the preview protects the one key it is showing,
 * the scene every texture the level still draws — so `keep` is a set and the
 * preview passes a set of one.
 */

/** Fetches and decodes an image, or hands back the one already decoded. */
export async function loadImage(
  cache: Map<string, HTMLImageElement>,
  key: string,
  url: string,
): Promise<HTMLImageElement> {
  const cached = cache.get(key)
  if (cached !== undefined) {
    // Re-inserted so the eviction order is "least recently used".
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const image = new Image()
  image.src = url
  await image.decode()

  cache.set(key, image)
  return image
}

/**
 * Drops the least recently used images, and the GPU textures that go with
 * them, once there are more than the cache is meant to hold.
 */
export function forgetOldestBeyond(
  cache: Map<string, HTMLImageElement>,
  textures: Phaser.Textures.TextureManager,
  limit: number,
  keep: ReadonlySet<string>,
): void {
  for (const key of [...cache.keys()]) {
    if (cache.size <= limit) return
    if (keep.has(key)) continue
    cache.delete(key)
    if (textures.exists(key)) textures.remove(key)
  }
}

export function setCanvasStyleSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
}
