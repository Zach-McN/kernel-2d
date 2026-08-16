import type { AssetType } from '../../runtime/formats/meta-schema'
import { PREFAB_FORMAT } from '../../runtime/formats/prefab-schema'
import { PROJECT_FORMAT } from '../../runtime/formats/project-schema'
import { SCENE_FORMAT } from '../../runtime/formats/scene-schema'
import type { Point } from '../../runtime/scene/coordinates'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import { readDocumentFromDisk } from '../store/document-disk'
import { basename, couldBeDocument } from './asset-kinds'
import { placePrefabInstance, placeSpriteEntity, type Placed } from './place-into-scene'
import { usePlacing } from './placing'
import { useResolvedScene } from './scene-prefabs'
import { useSelection } from './selection'
import type { Snap } from './snap'

/**
 * What happens when a file from the Assets panel is let go over the level.
 *
 * **The drop is what decides what the file is, by reading it.** Nothing about a
 * path says whether a `.json` is a prefab or a level, and the extension on a
 * `.png` is a guess that its own import settings are allowed to overrule
 * (`editor-ui` U11). So a `.json` is read and its `format` answers, and anything
 * else is asked about through its `.meta` — which is the same round trip the
 * Inspector's texture picker makes, and for the same reason: a sprite carries
 * the texture's *id* as well as its path, and only the sidecar knows it (D5).
 *
 * Two things arrive from that read at once, and using both is what keeps this
 * honest: the id to point at, and what the file actually is. Asking the
 * extension would place a sound on a level the moment somebody named one
 * `.png`.
 *
 * **A file that cannot be placed is answered with a sentence, not a refusal to
 * pick it up.** Every file in the panel can be dragged, because the panel does
 * not know what any of them are; a level dropped on a level says so, a sound
 * says so, and both are more use than a row that silently declines to move
 * (`editor-ui` U10).
 *
 * It selects what it made, which a drag has earned and repeat-placing has not:
 * one drop is one deliberate act and the human's next move is to tune the thing
 * they just put down (`editor-ui` U24). Selecting happens out here rather than
 * inside the recipe, because what is selected is never part of the edit
 * (`editor-ui` U8) — and one drop is therefore exactly one press of Ctrl-Z.
 */

export type Dropped =
  | { ok: true; placed: Placed }
  /** Nothing was added. One plain sentence saying why, for the caption. */
  | { ok: false; problem: string }

export interface DropIntoScene {
  /** False when there is no open level for anything to land in. */
  canDrop: boolean
  /** `at` is in the level's own units — the caller inverts the camera. */
  drop: (path: string, at: Point) => Promise<Dropped>
}

export function useDropIntoScene(): DropIntoScene {
  const resolved = useResolvedScene()
  const selection = useSelection()
  const placing = usePlacing()

  const scenePath = resolved.path

  const drop = async (path: string, at: Point): Promise<Dropped> => {
    const name = basename(path)
    if (scenePath === null) {
      return { ok: false, problem: 'No level is open, so there is nowhere to put it.' }
    }

    const placed = couldBeDocument(name)
      ? await placeDocument(scenePath, path, at, placing.snap)
      : await placeAsset(scenePath, path, at, placing.snap)

    if (placed.ok) selection.selectEntity(scenePath, placed.placed.entity)
    return placed
  }

  return { canDrop: scenePath !== null, drop }
}

/** A `.json`: a prefab is placed, and everything else says what it is. */
async function placeDocument(
  scenePath: string,
  path: string,
  at: Point,
  snap: Snap,
): Promise<Dropped> {
  const name = basename(path)
  const read = await readDocumentFromDisk(path)

  if (!read.ok) {
    return { ok: false, problem: `${name} could not be read — ${read.problem}.` }
  }

  if (read.document.format !== PREFAB_FORMAT) {
    return { ok: false, problem: `${name} is ${describeDocument(read.document.format)}, so it cannot be placed in a level.` }
  }

  // A level cannot hold a copy of itself, and a prefab dropped on the level it
  // is defined in is fine — only the first is impossible, and it is impossible
  // by the format rather than by this check.
  // A drop always places: only a stroke skips a cell that already holds one,
  // and a drop is not a stroke. Null therefore cannot happen here, and if the
  // level turned out to be closed between the read and the write there is
  // still nothing to select — said as a sentence rather than crashed on.
  const placed = placePrefabInstance({ scenePath, prefabPath: path, prefab: read.document, at, snap })
  if (placed === null) return { ok: false, problem: `${name} could not be placed: the level is no longer open.` }
  return { ok: true, placed }
}

/** Anything else: its import settings say what it is, and give the id to point at. */
async function placeAsset(
  scenePath: string,
  path: string,
  at: Point,
  snap: Snap,
): Promise<Dropped> {
  const name = basename(path)

  let view
  try {
    const response = await fetch(`/api/meta?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    view = MetaViewSchema.parse(await response.json())
  } catch {
    return { ok: false, problem: `Could not ask the editor service about ${name}. Is the editor command still running?` }
  }

  if (view.status !== 'ok' || view.meta === null) {
    return {
      ok: false,
      problem: `${name} has no import settings yet, so there is no id to point at. Try again in a moment.`,
    }
  }

  if (view.meta.type !== 'texture') {
    return { ok: false, problem: `${name} is ${describeAsset(view.meta.type)}. A level draws textures and places prefabs.` }
  }

  const placed = placeSpriteEntity({
    scenePath,
    texture: { id: view.meta.id, path },
    stem: withoutExtension(name),
    at,
    snap,
  })
  if (placed === null) return { ok: false, problem: `${name} could not be placed: the level is no longer open.` }
  return { ok: true, placed }
}

/** What a document is, in the words the human would use for it. */
function describeDocument(format: string): string {
  if (format === SCENE_FORMAT) return 'a level'
  if (format === PROJECT_FORMAT) return "this project's settings"
  return 'not a prefab'
}

/** The same, for something with import settings. */
function describeAsset(type: AssetType): string {
  if (type === 'audio') return 'a sound'
  if (type === 'font') return 'a font'
  return 'not something the editor draws'
}

/** A file's name without its extension, which is what the entity is called. */
function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}
