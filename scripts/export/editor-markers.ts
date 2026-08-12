/**
 * "There is no editor in this folder", as something specific.
 *
 * `editor-kernel` D1 says the editor never ships. The boundary that keeps it true is
 * an import rule, asserted by `tests/architecture/boundaries.test.ts` — nothing under
 * `runtime/` may reach into `editor/`, `sidecar/`, `scripts/` or `tests/`. That is the
 * real guard, and it is checked on the source.
 *
 * This is the second check, on the *output*, and it exists because the two can fail
 * apart. The bundler could pull something in through a path the import test does not
 * model; a later session could point the export at a different entry; somebody could
 * copy a stray file into the folder. All of those are invisible to a rule about
 * `runtime/`'s imports, and every one of them ships.
 *
 * So the built page and game are read back and searched for names that only exist on
 * the far side of the boundary. It is a coarse instrument on purpose: a substring
 * search over unminified output, with each entry named beside what it would mean. The
 * bundle is deliberately not minified partly so this can be trusted — mangled
 * identifiers would turn every one of these into a maybe.
 *
 * **Only what the export generated is searched, never what it copied.** The copied
 * files are the human's own levels, prefabs and import settings, byte for byte; a
 * level whose entity happened to be called something on this list would be refused
 * for a reason nobody could act on, and no amount of a human's data is editor code.
 * Strays are caught by a different rule — the folder listing has to match the
 * manifest — which is the right instrument for that question.
 *
 * **A hit is a refusal, not a warning.** The human asked to be told rather than left
 * to find it, and there is no version of "the game folder has a React panel in it"
 * worth handing to somebody.
 *
 * ## The two ways this went wrong when it was first run, both worth keeping in mind
 *
 * The bundle is *unminified*, which is what makes these names readable — and it also
 * means the game engine's own several thousand lines of prose are in there. The first
 * run refused a perfectly good export twice over: `immer` matched Phaser describing a
 * shader as **immer**sive, and `/api/` matched a documentation link ending
 * `doc/api/jsts_geom_Triangle.js.html`. Both are exactly the failure this check exists
 * to prevent, pointed at the wrong thing — which is worse than not checking, because
 * it makes a working command look broken.
 *
 * So two rules, and they are what keep the list honest:
 *
 *   - **Matched as whole words**, wherever the marker's edges are letters. `immer` no
 *     longer matches `immersive`, and no future one-word package name will either.
 *   - **A marker whose edges are not letters has to be specific enough to survive
 *     prose.** `/api/` became the editor's actual endpoints, because a bare `/api/` is
 *     a string that appears in documentation for a living.
 *
 * Adding to this list is cheap and safe, as long as both rules are kept. Removing from
 * it should be argued for.
 */

export interface EditorMarker {
  /** The text to look for. Matched as a whole word where its edges are letters. */
  text: string
  /** What finding it would mean, said in a sentence the refusal can print. */
  because: string
}

export const EDITOR_MARKERS: readonly EditorMarker[] = [
  { text: 'dockview', because: 'the docking layout is the editor window and never ships' },
  { text: 'zustand', because: 'the document store belongs to the editor' },
  // Immer's own API rather than its name: the name is a whole word that lives inside
  // ordinary English, and the functions are what would actually be bundled.
  { text: 'produceWithPatches', because: 'undo belongs to the editor' },
  { text: 'enablePatches', because: 'undo belongs to the editor' },
  { text: 'react-dom', because: 'the editor is the only React application here' },
  { text: 'createRoot', because: 'the editor is the only React application here' },
  { text: 'useState', because: 'the editor is the only React application here' },
  // The editor's endpoints, spelled out. A bare `/api/` matches documentation links.
  { text: '/api/document', because: 'that is how the editor reads a level from the filesystem service' },
  { text: '/api/meta', because: 'that is how the editor reads import settings from the filesystem service' },
  { text: '/api/tree', because: 'that is how the editor reads the project folder' },
  { text: 'EventSource', because: 'the change feed is a development-only service' },
  { text: 'DocumentViewSchema', because: 'that is the filesystem service’s vocabulary' },
  { text: 'ProjectTree', because: 'the folder tree is the asset browser’s, not the game’s' },
  { text: 'projectReaderFor', because: 'that is the editor’s half of the loader’s seam' },
  { text: '.tsx', because: 'a reference to a React component file means editor code was bundled' },
]

export interface MarkerHit {
  /** Relative to the export folder, forward-slashed. */
  file: string
  marker: EditorMarker
}

/**
 * Every marker found in one file's text.
 *
 * Takes text rather than a path so it is testable without a folder, and so the caller
 * decides which files are worth reading — binary assets are not.
 */
export function markersIn(file: string, text: string): MarkerHit[] {
  return EDITOR_MARKERS.filter((marker) => patternFor(marker.text).test(text)).map((marker) => ({
    file,
    marker,
  }))
}

/**
 * One marker as a regular expression: a whole word wherever its own edges are letters,
 * and a plain search where they are not.
 *
 * `\b` between two non-word characters matches nothing, so applying it blindly to
 * `/api/document` or `.tsx` would silently turn those markers off — which is the worst
 * outcome available here, since the check would keep passing and stop meaning anything.
 */
function patternFor(text: string): RegExp {
  const escaped = text.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const before = /^\w/.test(text) ? '\\b' : ''
  const after = /\w$/.test(text) ? '\\b' : ''
  return new RegExp(`${before}${escaped}${after}`)
}

/** Which of the generated files are text worth searching. */
export function isSearchableName(name: string): boolean {
  return ['.js', '.mjs', '.cjs', '.html', '.css', '.map'].some((suffix) => name.endsWith(suffix))
}
