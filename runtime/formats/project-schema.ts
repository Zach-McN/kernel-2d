import { z } from 'zod'

/**
 * The project format: which game this folder is, as text.
 *
 * It holds **one field that works** rather than five that half do. That was a
 * deliberate choice and it is worth stating, because the folder map has always
 * promised more here (a startup scene, an input map, a window size) and the
 * temptation is to write the field names down now and fill them in later. A field
 * nothing reads is a field that looks authoritative and does nothing — and the
 * first person it misleads is the human who sets it.
 *
 * So: the starting level, because an exported game cannot begin without knowing
 * where to begin. Everything else lands with the feature that reads it.
 *
 * It lives in `runtime/` because the shipping layer reads it: the exported game's
 * first act is to open this file (editor-kernel D20, text-formats T10). The editor
 * rewrites it, so every object here is loose (T9) — a key a human added survives
 * the round trip because it never left.
 *
 * **`startupScene` is a path and only a path**, which makes it the one reference
 * in the kernel that is not a path plus a stable id (editor-kernel D5). The reason
 * is not economy: a level has no id to carry. Prefabs and textures have one
 * because they are pointed at from *inside* a level and something has to notice
 * when the file at a path is no longer the file the level was written against
 * (D24). Nothing has ever pointed at a level until now, so there is nothing to
 * witness with — and inventing an id for levels to make this reference look like
 * the others would be a format change to every level ever saved, in exchange for a
 * warning nothing else in the kernel needs yet. The honest version is the path,
 * said out loud here. If levels gain ids for another reason, this is the first
 * place that should start carrying one.
 *
 * `null` means no starting level has been chosen. A real state — a folder can have
 * project settings before it has a level — and one the export refuses on by name
 * rather than guessing at.
 */

export const PROJECT_FORMAT = 'kernel2d.project'
export const PROJECT_VERSION = 1

export interface Project {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  /**
   * The level the game starts on, project-relative and forward-slashed
   * (text-formats T3), or null when none has been chosen.
   */
  startupScene: string | null
  /** Present only on files an AI produced. Read, preserved, never invented. */
  generatedBy?: string | undefined
  /** `YYYY-MM-DD`, alongside `generatedBy`. */
  generatedAt?: string | undefined
}

export const ProjectSchema: z.ZodType<Project> = z.looseObject({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  // Nullable rather than optional: an absent key and a key set to null would be
  // two spellings of one state, and the editor would have to pick one to write.
  startupScene: z.string().min(1).nullable(),
  generatedBy: z.string().min(1).optional(),
  generatedAt: z.string().min(1).optional(),
})

/** What a fresh one looks like, defined once for every writer (text-formats T5). */
export function defaultProject(): Project {
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, startupScene: null }
}

/**
 * How project settings are written to disk, everywhere. Two spaces and a trailing
 * newline, the same as a scene and a `.meta`, so the file reads well in a text
 * editor and diffs a line at a time.
 */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`
}
