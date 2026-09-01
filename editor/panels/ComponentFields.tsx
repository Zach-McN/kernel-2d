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
import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { useComponentTypes } from '../shell/component-types'
import { useProject } from '../shell/project-context'
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
 */

export function ComponentFields({
  scenePath,
  entity,
  resolved,
}: {
  scenePath: string
  /** The entity as the file has it — what every edit here targets (`editor-ui` U23). */
  entity: Entity
  /** The same entity with its prefab's components filled in. Read, never written. */
  resolved: Entity
}): ReactElement | null {
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
        <DescribedComponent
          key={description.type}
          scenePath={scenePath}
          entity={entity}
          resolved={resolved}
          description={description}
          tree={tree}
        />
      ))}
    </>
  )
}

/**
 * One described component's section, in whichever of its four states this entity
 * is in: carrying it, inheriting it from a prefab, carrying something the fields
 * cannot show, or not having it at all.
 *
 * The last of those is the one that can come to nothing. A description marked
 * `addable: false` has no business on an entity that neither carries one nor
 * inherits one, and draws no section there at all — see `addable` in
 * `component-schema.ts` for why an entity's own components are the only thing
 * this can be decided from.
 */
function DescribedComponent({
  scenePath,
  entity,
  resolved,
  description,
  tree,
}: {
  scenePath: string
  entity: Entity
  resolved: Entity
  description: ComponentDescription
  tree: ProjectTree | null
}): ReactElement | null {
  const type = description.type
  const carried = entity.components[type]
  const has = carried !== undefined
  // Only worth asking about when the entity has none of its own: what an entity
  // carries wins over its prefab per component type, whole, so an own component
  // means nothing is inherited (`runtime/formats/prefab-schema.ts`).
  const inherited = has ? undefined : resolved.components[type]

  // Nothing to say about a component this entity is not and cannot be given.
  // Checked before any of the reading below, so a hidden section costs nothing.
  if (!has && inherited === undefined && !isAddableByHand(description)) return null

  const edit = (label: string, merge: string | undefined, recipe: (target: Entity) => void): void => {
    editDocument(scenePath, merge === undefined ? { label } : { label, merge }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      // Re-found by id inside the transaction, never closed over (`editor-ui` U23).
      const target = document.entities.find((candidate) => candidate.id === entity.id)
      if (target !== undefined) recipe(target)
    })
  }

  /**
   * One field's value into the level. Typed fields (a number, a line of text)
   * merge, so a run of keystrokes is one undo step; everything else is a single
   * gesture and a single step.
   */
  const write = (field: KnownComponentField, value: FieldValue): void => {
    const typed = field.kind === 'number' || field.kind === 'text'
    const merge = typed ? `${scenePath}#${entity.id}#${type}.${field.key}` : undefined
    edit(description.title, merge, (target) => {
      const standing = target.components[type]
      // Spread rather than replace: the description names the fields it knows,
      // and a key it does not name is one this game's own system may read.
      const kept = typeof standing === 'object' && standing !== null ? standing : {}
      target.components[type] = { ...kept, [field.key]: value }
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
            type={type}
            field={field}
            carried={carried}
            tree={tree}
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
        <Note data-testid={`entity-component-${type}-mismatch`}>
          {mismatched.length === 1
            ? `${mismatched[0]?.label ?? ''} in this level is not a ${KIND_WORDS[mismatched[0]?.kind ?? 'number']}, so it is shown as the file has it and left alone.`
            : `${mismatched.map((field) => field.label).join(' and ')} in this level are not what these fields can show (${mismatched.map((field) => `a ${KIND_WORDS[field.kind]}`).join(', ')}), so they are shown as the file has them and left alone.`}{' '}
          Remove and then Add starts again from the description&apos;s values.
        </Note>
      )}

      {inherited !== undefined && (
        <Note data-testid={`entity-component-${type}-inherited`}>
          This one has a {type} because its prefab does. Adding one here gives this placement its own, and it
          stops following the prefab.
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
            data-testid={`entity-component-${type}-remove`}
            title={`Take the ${type} off this entity. Ctrl-Z puts it back.`}
            onClick={() =>
              edit(`Remove ${type}`, undefined, (target) => {
                delete target.components[type]
              })
            }
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            className="control control--action"
            data-testid={`entity-component-${type}-add`}
            title={`Give this entity a ${type}, with the values ${description.title} starts at.`}
            onClick={() =>
              edit(`Add ${type}`, undefined, (target) => {
                target.components[type] = defaultValueFor(description)
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
 * reads and cannot change, when the file holds something the control cannot
 * show or the kind is one this editor does not know.
 */
function DescribedField({
  type,
  field,
  carried,
  tree,
  onWrite,
}: {
  type: string
  field: ComponentField
  carried: unknown
  tree: ProjectTree | null
  onWrite: (field: KnownComponentField, value: FieldValue) => void
}): ReactElement {
  const testId = `entity-component-${type}-${field.key}`
  const title = field.title ?? `${field.label}, on this entity's ${type}`

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

/** A value the panel can only show, as text. A file's reference reads as its path. */
function shown(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
