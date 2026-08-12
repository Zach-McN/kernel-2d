import type { TextureImportSettings } from '../formats/meta-schema.js'
import type { Scene } from '../formats/scene-schema.js'

/**
 * What a renderer is asked to draw: a scene, and the textures it may draw.
 *
 * These two interfaces sit in a file of their own rather than with the renderer
 * that consumes them, and the reason is a compiler boundary rather than tidiness.
 *
 * The loader (`load-scene.ts`) produces a request, and it needs to be usable
 * **outside a browser**: by its unit tests, and — since the export command — by
 * plain Node, where it validates a project by opening it exactly the way the
 * shipped game will. Taking these types from `scene-view.ts` dragged Phaser and
 * the DOM into that graph, because a type-only import is still resolved and
 * type-checked, so the Node half of the two TypeScript projects (`editor-ui` U4)
 * saw `document` and `HTMLCanvasElement` under `lib: ES2023` and a pile of errors
 * in files nobody had touched.
 *
 * So: **a runtime module the Node project has to compile may reach only other
 * modules the Node project can compile**, and its relative imports carry the
 * `.js` spelling that satisfies both projects (`text-formats` T10/T14). This file
 * and the loader are both on that side of the line; `scene-view.ts` is not, and
 * re-exports these so nothing downstream can tell they moved.
 */

/** What the caller can tell a renderer about one texture the scene refers to. */
export interface SceneTexture {
  /** Changes whenever the file on disk does. Half the cache key. */
  version: number
  settings: TextureImportSettings
}

export interface SceneRequest {
  /** The scene's own path, project-relative. Reported back so the caller can tell what it is looking at. */
  path: string
  scene: Scene
  /**
   * The textures this scene may draw, keyed by project-relative path.
   *
   * Only what the caller could actually supply: a texture missing from here is
   * one the caller already knows it cannot draw — it is not in the project, or
   * its import settings have not arrived — and saying so in words is the
   * caller's job, not the renderer's.
   */
  textures: Readonly<Record<string, SceneTexture>>
}
