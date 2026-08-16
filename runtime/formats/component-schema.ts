import { z } from 'zod'

import { AssetRefSchema, type AssetRef } from './scene-schema.js'

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
 *   - The reference fix-up *does* follow a described field, and the way it does
 *     is the honest one: `describedReferencesOf` below says where a described
 *     component's references are, as a fact about this format, and the editor's
 *     rename asks it — the same shape as `COMPONENT_REFERENCE_FIELDS` for the
 *     types the kernel owns.
 *
 * ## Six field kinds, and a seventh that is "whatever comes next"
 *
 * `number`, `text`, `toggle`, `choice`, `asset` and `scene` — the kinds a
 * designer's component actually needs (a door's target level, a tower's role
 * from a list, an on/off, a name, a picture). Each is one member of the
 * discriminated union below and one case in each reader.
 *
 * A kind this editor does not know is **kept, not refused**: a description
 * naming a `colour` field written for a newer editor still opens, and the
 * Inspector shows that one field read-only rather than losing the whole file.
 * That is the same posture the level format takes towards a component it has
 * never heard of, one level in. What is still refused is a *known* kind written
 * wrongly — a `number` with no `default` is a mistake in a file its author is
 * looking at, and saying so is cheaper than guessing.
 *
 * ## Two keys are fixed by name, and it is the walks' fault
 *
 * The runtime preloads every `AssetRef` sitting under a key called `texture`
 * (`textureRefsOf`, `text-formats` T19), and the export ships every level named
 * under a key called `scene` (`sceneRefsOf`, T20). Neither reads descriptions —
 * they cannot, one runs inside an exported game — so a `scene` field called
 * `target` would author perfectly and then be left out of the export, and a
 * texture field called `icon` would be picked in the panel and not loaded when
 * the level runs. So a `scene` field's key **must** be `scene`, and an `asset`
 * field restricted to textures **must** be keyed `texture`. One of each per
 * component; the description is refused by name otherwise, which is the loud
 * failure this format promises for its own mistakes.
 *
 * Loose at every level like every other format (`text-formats` T9): the editor
 * rewrites this file from the object it parsed, so a key it drops is a key
 * deleted out of a file a human wrote.
 */

export const COMPONENT_FORMAT = 'kernel2d.component'
export const COMPONENT_VERSION = 1

/**
 * What every field has, whatever its kind.
 *
 * `key` is the name in the data — what the game's own system reads — and `label`
 * is what the human sees. They are separate because they answer to different
 * people: renaming the label is a wording change, and renaming the key is a
 * change to every level that carries one.
 */
interface DescribedFieldBase {
  key: string
  label: string
  /** The hover sentence. Optional, and worth writing: it is the only place a unit can be said. */
  title?: string | undefined
}

export interface DescribedNumber extends DescribedFieldBase {
  kind: 'number'
  /** What `Add` writes, and what a missing value is shown as. */
  default: number
  min?: number | undefined
  max?: number | undefined
  /** How far one press of the field's arrows moves it. */
  step?: number | undefined
}

/** A single line of text. */
export interface DescribedText extends DescribedFieldBase {
  kind: 'text'
  default: string
}

/** A tick box. */
export interface DescribedToggle extends DescribedFieldBase {
  kind: 'toggle'
  default: boolean
}

export interface ChoiceOption {
  /** What is written into the level, and what the game's system compares against. */
  value: string
  /** What the human sees in the list. */
  label: string
}

/** One of a fixed list. */
export interface DescribedChoice extends DescribedFieldBase {
  kind: 'choice'
  options: ChoiceOption[]
  /** One of the option values. */
  default: string
}

/** The kinds of file an asset field can be narrowed to. */
export type AssetFieldKind = 'texture' | 'audio'

/**
 * A file in the project, held as the same `{ id, path }` pair every reference in
 * the kernel carries, or `null` for nothing chosen yet. There is no default to
 * declare: a fresh one is always empty.
 */
export interface DescribedAsset extends DescribedFieldBase {
  kind: 'asset'
  /** Which files the picker offers. Absent means any file that has import settings. */
  of?: AssetFieldKind | undefined
}

/**
 * A level in the project, held as its project-relative path or `null`, the way
 * every other reference to a level in this kernel is held (`project-schema.ts`):
 * a level is a JSON document with no `.meta`, so its path is its one name and
 * there is no id to witness it with.
 */
export interface DescribedScene extends DescribedFieldBase {
  kind: 'scene'
}

/**
 * A field of a kind this editor does not know. Kept so the rest of the file
 * works, and shown but never written — see the header.
 */
export interface DescribedUnknown extends DescribedFieldBase {
  kind: string
}

export type KnownComponentField =
  | DescribedNumber
  | DescribedText
  | DescribedToggle
  | DescribedChoice
  | DescribedAsset
  | DescribedScene

export type ComponentField = KnownComponentField | DescribedUnknown

export type FieldKind = KnownComponentField['kind']

export const FIELD_KINDS: readonly FieldKind[] = ['number', 'text', 'toggle', 'choice', 'asset', 'scene']

/** Whether this field is one of the kinds the editor can draw and write. */
export function isKnownField(field: ComponentField): field is KnownComponentField {
  return (FIELD_KINDS as readonly string[]).includes(field.kind)
}

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

const base = {
  key: z.string().min(1),
  label: z.string().min(1),
  title: z.string().min(1).optional(),
}

const DescribedNumberSchema: z.ZodType<DescribedNumber> = z.looseObject({
  ...base,
  kind: z.literal('number'),
  default: z.number().finite(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
})

const DescribedTextSchema: z.ZodType<DescribedText> = z.looseObject({
  ...base,
  kind: z.literal('text'),
  default: z.string(),
})

const DescribedToggleSchema: z.ZodType<DescribedToggle> = z.looseObject({
  ...base,
  kind: z.literal('toggle'),
  default: z.boolean(),
})

const ChoiceOptionSchema: z.ZodType<ChoiceOption> = z.looseObject({
  value: z.string().min(1),
  label: z.string().min(1),
})

const DescribedChoiceSchema: z.ZodType<DescribedChoice> = z
  .looseObject({
    ...base,
    kind: z.literal('choice'),
    options: z.array(ChoiceOptionSchema).min(1),
    default: z.string(),
  })
  .superRefine((field, ctx) => {
    // Two options with one value would be two entries in the list that write
    // the same thing, and the control could never show which was picked.
    const seen = new Set<string>()
    for (const [at, option] of field.options.entries()) {
      if (seen.has(option.value)) {
        ctx.addIssue({ code: 'custom', message: `two options both worth ${option.value}`, path: ['options', at, 'value'] })
      }
      seen.add(option.value)
    }
    if (!seen.has(field.default)) {
      ctx.addIssue({ code: 'custom', message: `the default ${field.default} is not one of the options`, path: ['default'] })
    }
  })

const DescribedAssetSchema: z.ZodType<DescribedAsset> = z
  .looseObject({
    ...base,
    kind: z.literal('asset'),
    of: z.enum(['texture', 'audio']).optional(),
  })
  .superRefine((field, ctx) => {
    // The header's rule: the runtime preloads what sits under `texture` and
    // nothing else, and it cannot read this file to learn another name.
    if (field.of === 'texture' && field.key !== 'texture') {
      ctx.addIssue({
        code: 'custom',
        message: `a texture field must be called texture, not ${field.key}, or the level will not load it`,
        path: ['key'],
      })
    }
  })

const DescribedSceneSchema: z.ZodType<DescribedScene> = z
  .looseObject({
    ...base,
    kind: z.literal('scene'),
  })
  .superRefine((field, ctx) => {
    // The export ships what sits under `scene`, and it cannot read this file.
    if (field.key !== 'scene') {
      ctx.addIssue({
        code: 'custom',
        message: `a scene field must be called scene, not ${field.key}, or an export will leave that level out`,
        path: ['key'],
      })
    }
  })

// A kind nobody here has heard of. Refined to *not* be a known kind, so a
// malformed number cannot slip through by failing the number schema and landing
// here — a known kind written wrongly is a mistake, and gets its own message.
const DescribedUnknownSchema: z.ZodType<DescribedUnknown> = z.looseObject({
  ...base,
  kind: z
    .string()
    .min(1)
    .refine((kind) => !(FIELD_KINDS as readonly string[]).includes(kind), {
      message: 'a field of this kind is missing something it needs',
    }),
})

const ComponentFieldSchema: z.ZodType<ComponentField> = z.union([
  DescribedNumberSchema,
  DescribedTextSchema,
  DescribedToggleSchema,
  DescribedChoiceSchema,
  DescribedAssetSchema,
  DescribedSceneSchema,
  DescribedUnknownSchema,
])

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

/** What each known kind holds in a level. */
export type FieldValueOf<F extends KnownComponentField> = F extends DescribedNumber
  ? number
  : F extends DescribedText
    ? string
    : F extends DescribedToggle
      ? boolean
      : F extends DescribedChoice
        ? string
        : F extends DescribedAsset
          ? AssetRef | null
          : F extends DescribedScene
            ? string | null
            : never

export type FieldValue = number | string | boolean | AssetRef | null

/**
 * What a fresh field holds. A file or a level starts as "nothing chosen", which
 * is `null` rather than a missing key: an absent key is a level written before
 * the field existed, and a game's system is entitled to tell the two apart.
 */
export function defaultOf<F extends KnownComponentField>(field: F): FieldValueOf<F> {
  switch (field.kind) {
    case 'number':
    case 'text':
    case 'toggle':
    case 'choice':
      return field.default as FieldValueOf<F>
    case 'asset':
    case 'scene':
      return null as FieldValueOf<F>
  }
}

/**
 * The component `Add` writes: every described field at its default.
 *
 * Built from the description rather than from an empty object, because a
 * component whose keys are missing is one the game's own system reads as absent
 * — pressing Add would appear to do nothing. It is also the one place the
 * defaults are turned into data, so the panel and any future tool agree. A
 * field of a kind this editor does not know is left out: nothing here can say
 * what one starts as.
 */
export function defaultValueFor(description: ComponentDescription): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  for (const field of description.fields) {
    if (isKnownField(field)) value[field.key] = defaultOf(field)
  }
  return value
}

/** Whether this value is one the field can hold — the whole of what "the right kind" means. */
export function holds<F extends KnownComponentField>(field: F, value: unknown): value is FieldValueOf<F> {
  switch (field.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'text':
      return typeof value === 'string'
    case 'toggle':
      return typeof value === 'boolean'
    case 'choice':
      return typeof value === 'string' && field.options.some((option) => option.value === value)
    case 'asset':
      return value === null || AssetRefSchema.safeParse(value).success
    case 'scene':
      return value === null || typeof value === 'string'
  }
}

/**
 * What one field of a carried component holds, read the way a panel needs it.
 *
 * **Never throws and never refuses.** `wrongKind` is true when the file holds
 * something this field cannot show — a string where a number belongs, a word not
 * in a choice's list, most likely typed by hand — and `held` is then exactly what
 * the file has, so the panel can show it as it is and leave it alone. `value` is
 * the default in that case, so a control has something to draw if it wants one.
 * Saying which of the two happened is what lets the panel tell the human the
 * truth about the file rather than quietly showing a default as though it were
 * the file's own value (U10: a panel never says something untrue).
 *
 * A value that is simply absent is not wrong: a component gains a field the day
 * its description does, and every level written before that has none.
 */
export function readField<F extends KnownComponentField>(
  component: unknown,
  field: F,
): { value: FieldValueOf<F>; wrongKind: boolean; held: unknown } {
  const held = heldBy(component, field.key)

  if (held === undefined) return { value: defaultOf(field), wrongKind: false, held }
  if (holds(field, held)) return { value: held, wrongKind: false, held }
  return { value: defaultOf(field), wrongKind: true, held }
}

/** The raw thing a component holds under a key, or undefined. */
export function heldBy(component: unknown, key: string): unknown {
  return typeof component === 'object' && component !== null
    ? (component as Record<string, unknown>)[key]
    : undefined
}

/**
 * Where a described component's references are: which of its keys hold a file
 * and which hold a level. **A fact about the format, stated by the format**, so
 * the editor's rename fix-up can follow a described reference the same way it
 * follows the kernel's own through `COMPONENT_REFERENCE_FIELDS` — by asking,
 * rather than by knowing.
 */
export function describedReferencesOf(
  description: ComponentDescription,
): { key: string; kind: 'asset' | 'scene' }[] {
  const found: { key: string; kind: 'asset' | 'scene' }[] = []
  for (const field of description.fields) {
    if (!isKnownField(field)) continue
    if (field.kind === 'asset' || field.kind === 'scene') found.push({ key: field.key, kind: field.kind })
  }
  return found
}

/**
 * How a description is written to disk. Two spaces and a trailing newline, the
 * same as every other document, so it reads well in a text editor and diffs a
 * line at a time.
 */
export function serializeComponentDescription(description: ComponentDescription): string {
  return `${JSON.stringify(description, null, 2)}\n`
}
