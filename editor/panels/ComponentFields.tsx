import type { ReactElement } from 'react'

import {
  defaultValueFor,
  isAddableByHand,
  isKnownField,
  heldBy,
  readField,
  type ComponentDescription,
  type ComponentField,
  type FieldValue,
  type KnownComponentField,
} from '../../runtime/formats/component-schema'
import { PREFAB_FORMAT, type Prefab } from '../../runtime/formats/prefab-schema'
import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { useComponentTypes } from '../shell/component-types'
import { useProject } from '../shell/project-context'
import { editPartOverride, overridesOf } from '../shell/part-overrides'
import type { EditIntent } from '../store/documents'
import { editDocument, sealEdits } from '../store/open-documents'
import { AssetRefPicker } from './AssetRefPicker'
import { Field, Note, Row, Section } from './fields'
import { LevelPicker } from './LevelPicker'
import { NumberField } from './NumberField'

/**
 * Fields for the components this *game* invented, drawn from the game's own
 * description of them (`runtime/formats/component-schema.ts`).
 *
 * **Nothing here knows what a patrol or a door is.** It knows how to show a
 * number, a line of text, a tick box, a list, a file and a level, how to put
 * each one back, and how to read a file describing which of those there are.
 * That is the whole of the feature: a game adds a noun by adding a file beside
 * its levels, and the editor grows fields for it without a line of kernel code
 * mentioning it. The alternative — a hand-written panel per component, the way
 * `spin` and `screen` are written next door — closes the hole for one word and
 * leaves every future word needing a session.
 *
 * **It writes through the same door as every other control**: the transaction
 * API, with a merge key per typed field, so a run of keystrokes is one press of
 * Ctrl-Z and nothing here knows undo exists (`editor-kernel` D7). A pick from a
 * list, a tick and a chosen file are one step each.
 *
 * **It draws for two kinds of carrier, and the difference is one function.** An
 * entity in a level and a prefab both hold a component map, and a described
 * component means the same thing on either — so the same fields are drawn on
 * both, and the only thing that changes is *where a write goes*: into the
 * entity re-found by id inside the scene's transaction, or into the prefab
 * document itself. A prefab's change reaches every instance that has not been
 * given its own, which is exactly what editing a prefab means everywhere else
 * in this editor (`PrefabInspector.tsx`). What a prefab does not have is
 * inheritance: there is nothing above it.
 *
 * Three things it does differently from the hand-written controls, all on
 * purpose:
 *
 *   - **Add and Remove are buttons.** `spin` deletes itself when its rate is
 *     typed to zero, which is right for a single number whose zero means "does
 *     not turn". Three numbers have no such value — a patrol from 0 to 0 at 0
 *     units a second is a component that is *there* and does nothing — and
 *     inventing one would be the kernel deciding what a game's component means.
 *   - **A write preserves the keys it does not know about.** `spin` replaces its
 *     whole component object because the kernel owns that shape. A description is
 *     a *view* of a component rather than its schema, so a key the description
 *     does not mention is a key some system reads, and spreading is what keeps it.
 *   - **What it cannot read, it shows and leaves alone.** A value of the wrong
 *     kind — a word where a number belongs, a side not on the list — is shown
 *     exactly as the file has it, with no control, and a line saying why. So is
 *     a field of a kind this editor has never heard of. The panel neither lies
 *     about the file nor "fixes" it (`editor-ui` U10); Remove and Add are the
 *     way back to a value it can draw.
 *
 * And one thing an inherited component gets that a hand-written section does
 * not: **its values are shown, read-only, before Add is pressed.** A placed
 * enemy inheriting its speed from a prefab used to show a sentence saying so
 * and nothing else, so the only way to learn the speed was to press Add and
 * detach it — a question answered by changing the file. Now the number is on
 * screen as text; Add turns it into a box.
 */

/** What a described component is drawn on, and so where a write to it goes. */
export type ComponentTarget =
  | {
      kind: 'entity'
      scenePath: string
      /** The entity as the file has it — what every edit here targets (`editor-ui` U23). */
      entity: Entity
      /** The same entity with its prefab's components filled in. Read, never written. */
      resolved: Entity
    }
  | {
      kind: 'prefab'
      path: string
      prefab: Prefab
    }
  | {
      /** One part of a prefab, edited in the prefab's own document. Inherits from nothing. */
      kind: 'prefab-part'
      path: string
      prefab: Prefab
      partId: string
    }
  | {
      /**
       * One part of a *placed* prefab: what this placement gives the part is
       * written on the placement (`editor/shell/part-overrides.ts`), and what
       * the part has otherwise comes from the prefab.
       */
      kind: 'placement-part'
      scenePath: string
      placement: Entity
      partId: string
      /** The part as resolved for this placement — overrides applied. Read, never written. */
      resolved: Entity
    }

/**
 * The four carriers, answered once: what the carrier holds itself, what it
 * inherits, which document a write goes to and how, and how the section names
 * itself. One switch here rather than a dozen ternaries below, so a fifth
 * carrier is one more arm rather than a hunt.
 */
interface Carrier {
  own: Components
  /** What the carrier follows when it has nothing of its own, or null when it inherits from nothing. */
  inherited: Components | null
  /** Test-id prefix and the word a sentence uses for it. */
  prefix: string
  word: string
  /** A prefab (or its part) is offered every described component; an entity only what it can be given. */
  alwaysOffered: boolean
  /** True for a prefab or a prefab's part: a change reaches every instance. */
  shared: boolean
  /** Names the carrier in a merge key, so the same speed typed on two carriers is two edits. */
  who: string
  edit: (intent: EditIntent, recipe: (components: Components) => void) => void
}

function carrierOf(target: ComponentTarget): Carrier {
  switch (target.kind) {
    case 'entity':
      return {
        own: target.entity.components,
        inherited: target.resolved.components,
        prefix: 'entity-component',
        word: 'entity',
        alwaysOffered: false,
        shared: false,
        who: `${target.scenePath}#${target.entity.id}`,
        edit: (intent, recipe) =>
          editDocument(target.scenePath, intent, (document) => {
            if (document.format !== SCENE_FORMAT) return
            // Re-found by id inside the transaction, never closed over (`editor-ui` U23).
            const found = document.entities.find((candidate) => candidate.id === target.entity.id)
            if (found !== undefined) recipe(found.components)
          }),
      }
    case 'prefab':
      return {
        own: target.prefab.components,
        inherited: null,
        prefix: 'prefab-component',
        word: 'prefab',
        alwaysOffered: true,
        shared: true,
        who: target.path,
        edit: (intent, recipe) =>
          editDocument(target.path, intent, (document) => {
            if (document.format === PREFAB_FORMAT) recipe(document.components)
          }),
      }
    case 'prefab-part': {
      const part = target.prefab.children?.find((one) => one.id === target.partId)
      return {
        own: part?.components ?? {},
        inherited: null,
        prefix: `prefab-part-${target.partId}`,
        word: 'part',
        alwaysOffered: true,
        shared: true,
        who: `${target.path}#${target.partId}`,
        edit: (intent, recipe) =>
          editDocument(target.path, intent, (document) => {
            if (document.format !== PREFAB_FORMAT) return
            const found = document.children?.find((one) => one.id === target.partId)
            if (found !== undefined) recipe(found.components)
          }),
      }
    }
    case 'placement-part':
      return {
        own: overridesOf(target.placement, target.partId),
        inherited: target.resolved.components,
        prefix: `entity-part-${target.partId}`,
        word: 'part',
        alwaysOffered: false,
        shared: false,
        who: `${target.scenePath}#${target.placement.id}#${target.partId}`,
        edit: (intent, recipe) =>
          editPartOverride(target.scenePath, target.placement.id, target.partId, intent, recipe),
      }
  }
}

export function ComponentFields({ target }: { target: ComponentTarget }): ReactElement | null {
  const types = useComponentTypes()
  const project = useProject()
  const tree: ProjectTree | null = project.state === 'ready' ? project.tree : null

  // In type order rather than in folder order, so the panel does not reshuffle
  // itself when somebody renames a description file.
  const described = Object.values(types.byType).sort((a, b) => a.type.localeCompare(b.type))
  if (described.length === 0) return null

  return (
    <>
      {described.map((description) => (
        <DescribedComponent key={description.type} target={target} description={description} tree={tree} />
      ))}
    </>
  )
}

/** A component map, as either carrier holds one. */
type Components = Record<string, unknown>

/**
 * One described component's section, in whichever of its four states the
 * carrier is in: carrying it, inheriting it from a prefab, carrying something
 * the fields cannot show, or not having it at all.
 *
 * The last of those is the one that can come to nothing. A description marked
 * `addable: false` has no business on an entity that neither carries one nor
 * inherits one, and draws no section there at all — see `addable` in
 * `component-schema.ts` for why an entity's own components are the only thing
 * this can be decided from. A prefab is offered every described component
 * regardless: a prefab is *how* an enemy comes to exist, so "give this prefab a
 * walker" is the one place that offer is always the human's business.
 */
function DescribedComponent({
  target,
  description,
  tree,
}: {
  target: ComponentTarget
  description: ComponentDescription
  tree: ProjectTree | null
}): ReactElement | null {
  const type = description.type
  const carrier = carrierOf(target)
  const onPrefab = carrier.shared
  const carried = carrier.own[type]
  const has = carried !== undefined
  // Only worth asking about when the carrier has none of its own: what it
  // carries wins over what it inherits per component type, whole, so an own
  // component means nothing is inherited (`runtime/formats/prefab-schema.ts`).
  // A prefab, and a prefab's part, inherit from nothing.
  const inherited = has || carrier.inherited === null ? undefined : carrier.inherited[type]

  // Nothing to say about a component this entity is not and cannot be given.
  // Checked before any of the reading below, so a hidden section costs nothing.
  if (!carrier.alwaysOffered && !has && inherited === undefined && !isAddableByHand(description)) return null

  const prefix = carrier.prefix
  const carrierWord = carrier.word

  /** One edit to whichever document holds the carrier, however it is held. */
  const edit = (label: string, merge: string | undefined, recipe: (components: Components) => void): void => {
    carrier.edit(merge === undefined ? { label } : { label, merge }, recipe)
  }

  /**
   * One field's value into the document. Typed fields (a number, a line of text)
   * merge, so a run of keystrokes is one undo step; everything else is a single
   * gesture and a single step. The merge key names the carrier, so a speed typed
   * on a prefab and the same speed typed on one of its instances are two edits.
   */
  const write = (field: KnownComponentField, value: FieldValue): void => {
    const typed = field.kind === 'number' || field.kind === 'text'
    const merge = typed ? `${carrier.who}#${type}.${field.key}` : undefined
    edit(description.title, merge, (components) => {
      const standing = components[type]
      // Spread rather than replace: the description names the fields it knows,
      // and a key it does not name is one this game's own system may read.
      const kept = typeof standing === 'object' && standing !== null ? standing : {}
      components[type] = { ...kept, [field.key]: value }
    })
  }

  const mismatched = description.fields
    .filter((field): field is KnownComponentField => isKnownField(field))
    .filter((field) => readField(carried, field).wrongKind)

  return (
    <Section title={description.title}>
      {has &&
        description.fields.map((field) => (
          <DescribedField
            key={field.key}
            prefix={prefix}
            type={type}
            field={field}
            carried={carried}
            tree={tree}
            onWrite={write}
          />
        ))}

      {/* What the prefab gives this placement, as text: readable without
          detaching it. The same renderer, told not to draw controls. */}
      {inherited !== undefined &&
        description.fields.map((field) => (
          <DescribedField
            key={field.key}
            prefix={prefix}
            type={type}
            field={field}
            carried={inherited}
            tree={tree}
            readOnly
            onWrite={write}
          />
        ))}

      {has && description.fields.length === 0 && (
        <Note>This one is carried or not carried; there is nothing to set on it.</Note>
      )}

      {/* Said rather than hidden. A field the file disagrees with is shown as the
          file has it and left alone, and the line underneath says why there is no
          control (`editor-ui` U10). */}
      {mismatched.length > 0 && (
        <Note data-testid={`${prefix}-${type}-mismatch`}>
          {mismatched.length === 1
            ? `${mismatched[0]?.label ?? ''} in this file is not a ${KIND_WORDS[mismatched[0]?.kind ?? 'number']}, so it is shown as the file has it and left alone.`
            : `${mismatched.map((field) => field.label).join(' and ')} in this file are not what these fields can show (${mismatched.map((field) => `a ${KIND_WORDS[field.kind]}`).join(', ')}), so they are shown as the file has them and left alone.`}{' '}
          Remove and then Add starts again from the description&apos;s values.
        </Note>
      )}

      {inherited !== undefined && (
        <Note data-testid={`${prefix}-${type}-inherited`}>
          These are the prefab&apos;s values, and this placement follows them. Adding one here gives this
          placement its own copy to change, and it stops following the prefab.
        </Note>
      )}

      {onPrefab && has && (
        <Note data-testid={`${prefix}-${type}-shared`}>
          Every instance of this prefab carries this, unless it has been given a {type} of its own.
        </Note>
      )}

      {/* The game's own sentence about what carrying this does, in both states.
          Always shown, like the hand-written sections' notes: it is as useful to
          somebody deciding whether to add one as to somebody tuning one. */}
      {description.note !== undefined && <Note>{description.note}</Note>}

      <div className="inspector__actions">
        {has ? (
          <button
            type="button"
            className="control control--action"
            data-testid={`${prefix}-${type}-remove`}
            title={
              onPrefab
                ? `Take the ${type} off this prefab — and off every instance that has not got one of its own. Ctrl-Z puts it back.`
                : `Take the ${type} off this entity. Ctrl-Z puts it back.`
            }
            onClick={() =>
              edit(`Remove ${type}`, undefined, (components) => {
                delete components[type]
              })
            }
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            className="control control--action"
            data-testid={`${prefix}-${type}-add`}
            title={
              onPrefab
                ? `Give this prefab a ${type}, with the values ${description.title} starts at. Every instance placed from it will carry one.`
                : inherited === undefined
                  ? `Give this ${carrierWord} a ${type}, with the values ${description.title} starts at.`
                  : `Give this placement its own ${type} — a copy of the one its prefab gives it — so it can be tuned on its own.`
            }
            onClick={() =>
              edit(`Add ${type}`, undefined, (components) => {
                // **A placement that inherits one gets a copy of what it inherits,
                // whole — not the description's defaults.** "Its own" has to mean
                // the thing it already has, or pressing Add changes the entity:
                // an enemy inheriting `{ speed, squashed: { texture } }` from its
                // prefab would be written as `{ speed }` alone, and the level's
                // own reading (an entity's component wins over its prefab's, per
                // type, whole — `prefab-schema.ts`) then loses the squashed art
                // the description never knew about. Copied deep, so the nested
                // keys the description cannot see come along too.
                components[type] =
                  inherited === undefined ? defaultValueFor(description) : structuredClone(inherited)
              })
            }
          >
            Add {type}
          </button>
        )}
      </div>
    </Section>
  )
}

/** What each kind is called in a sentence about a value that is not one. */
const KIND_WORDS: Record<KnownComponentField['kind'], string> = {
  number: 'number',
  text: 'line of text',
  toggle: 'yes or no',
  choice: 'choice on the list',
  asset: 'file',
  scene: 'level',
}

/**
 * One field, as whichever control its kind calls for — or as a value the human
 * reads and cannot change: when the file holds something the control cannot
 * show, when the kind is one this editor does not know, or when the value is
 * the prefab's and this placement has not been given its own yet.
 */
function DescribedField({
  prefix,
  type,
  field,
  carried,
  tree,
  readOnly = false,
  onWrite,
}: {
  prefix: string
  type: string
  field: ComponentField
  carried: unknown
  tree: ProjectTree | null
  /** Show the value as text, with nothing to type into. */
  readOnly?: boolean
  onWrite: (field: KnownComponentField, value: FieldValue) => void
}): ReactElement {
  const testId = `${prefix}-${type}-${field.key}`
  const title = field.title ?? `${field.label}, on this ${type}`

  if (!isKnownField(field)) {
    return (
      <>
        <Field label={field.label} value={shown(heldBy(carried, field.key))} testId={testId} />
        <Note data-testid={`${testId}-uneditable`}>
          {field.label} is a {field.kind} field, which this editor cannot edit. It is kept exactly as it is in
          the file.
        </Note>
      </>
    )
  }

  const read = readField(carried, field)
  if (read.wrongKind) {
    // As the file has it, and nothing to type into: the note under the section
    // says why.
    return <Field label={field.label} value={shown(read.held)} testId={testId} />
  }

  if (readOnly) {
    return <Field label={field.label} value={describeValue(field, read.value)} testId={testId} />
  }

  switch (field.kind) {
    case 'number':
      return (
        <Row label={field.label}>
          <NumberField
            testId={testId}
            title={title}
            value={readField(carried, field).value}
            {...(field.min === undefined ? {} : { min: field.min })}
            {...(field.max === undefined ? {} : { max: field.max })}
            {...(field.step === undefined ? {} : { step: field.step })}
            onCommit={(value) => onWrite(field, value)}
          />
        </Row>
      )

    case 'text':
      return (
        <Row label={field.label}>
          <input
            type="text"
            className="control control--text"
            data-testid={testId}
            title={title}
            value={readField(carried, field).value}
            onBlur={sealEdits}
            onChange={(event) => onWrite(field, event.target.value)}
          />
        </Row>
      )

    case 'toggle':
      return (
        <Row label={field.label}>
          <input
            type="checkbox"
            className="control control--tick"
            data-testid={testId}
            title={title}
            checked={readField(carried, field).value}
            onChange={(event) => onWrite(field, event.target.checked)}
          />
        </Row>
      )

    case 'choice':
      return (
        <Row label={field.label}>
          <select
            className="control control--choice"
            data-testid={testId}
            title={title}
            value={readField(carried, field).value}
            onChange={(event) => onWrite(field, event.target.value)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Row>
      )

    case 'asset':
      return (
        <AssetRefPicker
          label={field.label}
          title={title}
          value={readField(carried, field).value}
          tree={tree}
          of={field.of}
          testId={testId}
          nothing="Nothing — no file chosen"
          onPick={(reference) => onWrite(field, reference)}
        />
      )

    case 'scene':
      return (
        <LevelPicker
          label={field.label}
          title={title}
          value={readField(carried, field).value}
          tree={tree}
          testId={testId}
          nothing="Nothing — no level chosen"
          onPick={(path) => onWrite(field, path)}
        />
      )
  }
}

/** A field's value as the words its control would show, for reading without one. */
function describeValue(field: KnownComponentField, value: FieldValue): string {
  switch (field.kind) {
    case 'number':
      return String(value)
    case 'text':
      return typeof value === 'string' && value !== '' ? value : '—'
    case 'toggle':
      return value === true ? 'yes' : 'no'
    case 'choice':
      return field.options.find((option) => option.value === value)?.label ?? String(value)
    case 'asset':
      return value !== null && typeof value === 'object' ? value.path : 'Nothing'
    case 'scene':
      return typeof value === 'string' ? value : 'Nothing'
  }
}

/** A value the panel can only show, as text. A file's reference reads as its path. */
function shown(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
