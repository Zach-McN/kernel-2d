import { z } from 'zod'

/**
 * A game describing one of its own components, so the editor can draw fields for
 * it.
 *
 * **This is the file that stops a game's vocabulary being a kernel change.** An
 * entity's component map is open — a type the registry knows is validated, and a
 * type it does not know is carried through byte-for-byte
 * (`./scene-schema.ts`) — which has always meant a game could invent `patrol`
 * and have it survive every round trip. What it could not do is have it
 * *authored*: the Inspector named it and offered nothing, so the only way to
 * write one was typing into the level file. One of these beside the level closes
 * that, and the kernel never learns the word `patrol`.
 *
 * ## What describing a component buys, and what it deliberately does not
 *
 * The component registry states the bargain for the four types the kernel owns:
 * a known type whose contents are wrong fails the parse, loudly, at the
 * boundary. **A description buys the inspector half of that and not the
 * validation half**, and the asymmetry is the whole design rather than a corner
 * cut:
 *
 *   - A description is written by a *game*, and a game-authored file must never
 *     be able to stop a level opening. Registering `patrol` for validation would
 *     mean a typo in this file makes every level carrying a patrol refuse to
 *     load — a fault in one folder taking out the whole project, with the panel
 *     that would explain it unreachable behind the same failure.
 *   - So the fields read **leniently**: `readField` reports a value of the wrong
 *     kind rather than throwing, and the panel says so out loud instead of
 *     hiding it. The component map is exactly as open as it was.
 *   - And the reference fix-up is unaffected. Which fields hold a path is
 *     `COMPONENT_REFERENCE_FIELDS`, a fact about the *format*, and describing a
 *     component does not add one — a texture named inside `patrol` is still not
 *     rewritten when its file moves. That is why a reference is not among the
 *     field kinds below yet: the field would work and the rename would not, and
 *     a half-working reference is worse than none.
 *
 * ## One field kind
 *
 * `number`, and nothing else, because the one component this was proved on is
 * three numbers. The dispatch point exists — `kind` is a discriminated union and
 * every reader switches on it — so `text`, a tick box, a file reference and a
 * list are each one case added by the component that first needs one. A language
 * with five kinds and one user would be four guesses about what games want, which
 * is the anticipation this codebase grows by extraction to avoid.
 *
 * Loose at every level like every other format (`text-formats` T9): the editor
 * rewrites this file from the object it parsed, so a key it drops is a key
 * deleted out of a file a human wrote.
 */

export const COMPONENT_FORMAT = 'kernel2d.component'
export const COMPONENT_VERSION = 1

/**
 * One field of a component, and how to show it.
 *
 * `key` is the name in the data — what the game's own system reads — and `label`
 * is what the human sees. They are separate because they answer to different
 * people: renaming the label is a wording change, and renaming the key is a
 * change to every level that carries one.
 */
export interface DescribedNumber {
  kind: 'number'
  key: string
  label: string
  /** What `Add` writes, and what a missing or unreadable value is shown as. */
  default: number
  /** The hover sentence. Optional, and worth writing: it is the only place a unit can be said. */
  title?: string | undefined
  min?: number | undefined
  max?: number | undefined
  /** How far one press of the field's arrows moves it. */
  step?: number | undefined
}

export type ComponentField = DescribedNumber

export interface ComponentDescription {
  format: typeof COMPONENT_FORMAT
  version: typeof COMPONENT_VERSION
  /**
   * The key this component has in an entity's component map — `patrol`.
   *
   * The type is named here rather than taken from the file name, for the reason
   * every other document carries its own identity: a file's name is a thing a
   * human moves and renames, and a component type is a word written into every
   * level that uses it. Two files claiming one type is a state this cannot
   * prevent, so the editor reports it rather than the format forbidding it.
   */
  type: string
  /** What the Inspector's section is called. `patrol` → "Patrol". */
  title: string
  /** A sentence under the fields saying what carrying this does. Optional. */
  note?: string | undefined
  /** In the order they should appear. May be empty — a marker component has no fields. */
  fields: ComponentField[]
  /** Present only on files an AI produced. Read, preserved, never invented. */
  generatedBy?: string | undefined
  /** `YYYY-MM-DD`, alongside `generatedBy`. */
  generatedAt?: string | undefined
}

const DescribedNumberSchema: z.ZodType<DescribedNumber> = z.looseObject({
  kind: z.literal('number'),
  key: z.string().min(1),
  label: z.string().min(1),
  default: z.number().finite(),
  title: z.string().min(1).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
})

// A union of one, written as a union on purpose: the second kind is a line here
// and a case in each switch, rather than a refactor of the shape.
const ComponentFieldSchema: z.ZodType<ComponentField> = DescribedNumberSchema

export const ComponentDescriptionSchema: z.ZodType<ComponentDescription> = z
  .looseObject({
    format: z.literal(COMPONENT_FORMAT),
    version: z.literal(COMPONENT_VERSION),
    type: z.string().min(1),
    title: z.string().min(1),
    note: z.string().min(1).optional(),
    fields: z.array(ComponentFieldSchema),
    generatedBy: z.string().min(1).optional(),
    generatedAt: z.string().min(1).optional(),
  })
  .superRefine((description, ctx) => {
    // Two fields with one key would be two controls writing over each other, and
    // whichever the human typed in last would appear to work until the panel
    // re-rendered. Cheaper to refuse the file.
    const seen = new Set<string>()
    for (const [at, field] of description.fields.entries()) {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `two fields both called ${field.key}`,
          path: ['fields', at, 'key'],
        })
      }
      seen.add(field.key)
    }
  })

/** What a fresh one looks like, defined once for every writer (`text-formats` T5). */
export function defaultComponentDescription(type: string, title: string): ComponentDescription {
  return { format: COMPONENT_FORMAT, version: COMPONENT_VERSION, type, title, fields: [] }
}

/**
 * The component `Add` writes: every described field at its default.
 *
 * Built from the description rather than from an empty object, because a
 * component whose keys are missing is one the game's own system reads as absent
 * — pressing Add would appear to do nothing. It is also the one place the
 * defaults are turned into data, so the panel and any future tool agree.
 */
export function defaultValueFor(description: ComponentDescription): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  for (const field of description.fields) value[field.key] = field.default
  return value
}

/**
 * What one field of a carried component holds, read the way a panel needs it.
 *
 * **Never throws and never refuses.** `wrongKind` is true when the file holds
 * something this field cannot show — a string where a number belongs, most
 * likely typed by hand — and `value` is then the default, so the control has
 * something to draw. Saying which of the two happened is what lets the panel
 * tell the human its number is not the file's number, rather than quietly
 * showing a default as though it were the truth (U10: a panel never says
 * something untrue).
 *
 * A value that is simply absent is not wrong: a component gains a field the day
 * its description does, and every level written before that has none.
 */
export function readField(
  component: unknown,
  field: ComponentField,
): { value: number; wrongKind: boolean } {
  const held = typeof component === 'object' && component !== null
    ? (component as Record<string, unknown>)[field.key]
    : undefined

  if (held === undefined) return { value: field.default, wrongKind: false }
  if (typeof held === 'number' && Number.isFinite(held)) return { value: held, wrongKind: false }
  return { value: field.default, wrongKind: true }
}

/**
 * How a description is written to disk. Two spaces and a trailing newline, the
 * same as every other document, so it reads well in a text editor and diffs a
 * line at a time.
 */
export function serializeComponentDescription(description: ComponentDescription): string {
  return `${JSON.stringify(description, null, 2)}\n`
}
