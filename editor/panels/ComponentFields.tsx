import type { ReactElement } from 'react'

import {
  defaultValueFor,
  readField,
  type ComponentDescription,
  type ComponentField,
} from '../../runtime/formats/component-schema'
import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import { useComponentTypes } from '../shell/component-types'
import { editDocument } from '../store/open-documents'
import { Note, Row, Section } from './fields'
import { NumberField } from './NumberField'

/**
 * Fields for the components this *game* invented, drawn from the game's own
 * description of them (`runtime/formats/component-schema.ts`).
 *
 * **Nothing here knows what a patrol is.** It knows how to show a number, how to
 * put one back, and how to read a file describing which numbers there are. That
 * is the whole of the feature: a game adds a noun by adding a file beside its
 * levels, and the editor grows fields for it without a line of kernel code
 * mentioning it. The alternative — a hand-written panel per component, the way
 * `spin` and `screen` are written next door — closes the hole for one word and
 * leaves every future word needing a session.
 *
 * **It writes through the same door as every other control**: the transaction
 * API, with a merge key per field, so a run of keystrokes is one press of Ctrl-Z
 * and nothing here knows undo exists (`editor-kernel` D7).
 *
 * Two things it does differently from the hand-written controls, both on
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
        />
      ))}
    </>
  )
}

/**
 * One described component's section, in whichever of its four states this entity
 * is in: carrying it, inheriting it from a prefab, carrying something the fields
 * cannot show, or not having it at all.
 */
function DescribedComponent({
  scenePath,
  entity,
  resolved,
  description,
}: {
  scenePath: string
  entity: Entity
  resolved: Entity
  description: ComponentDescription
}): ReactElement {
  const type = description.type
  const carried = entity.components[type]
  const has = carried !== undefined
  // Only worth asking about when the entity has none of its own: what an entity
  // carries wins over its prefab per component type, whole, so an own component
  // means nothing is inherited (`runtime/formats/prefab-schema.ts`).
  const inherited = has ? undefined : resolved.components[type]

  const edit = (label: string, merge: string | undefined, recipe: (target: Entity) => void): void => {
    editDocument(scenePath, merge === undefined ? { label } : { label, merge }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      // Re-found by id inside the transaction, never closed over (`editor-ui` U23).
      const target = document.entities.find((candidate) => candidate.id === entity.id)
      if (target !== undefined) recipe(target)
    })
  }

  const write = (field: ComponentField, value: number): void => {
    edit(description.title, `${scenePath}#${entity.id}#${type}.${field.key}`, (target) => {
      const standing = target.components[type]
      // Spread rather than replace: the description names the fields it knows,
      // and a key it does not name is one this game's own system may read.
      const kept = typeof standing === 'object' && standing !== null ? standing : {}
      target.components[type] = { ...kept, [field.key]: value }
    })
  }

  const mismatched = description.fields
    .filter((field) => readField(carried, field).wrongKind)
    .map((field) => field.label)

  return (
    <Section title={description.title}>
      {has &&
        description.fields.map((field) => (
          <Row key={field.key} label={field.label}>
            <NumberField
              testId={`entity-component-${type}-${field.key}`}
              title={field.title ?? `${field.label}, on this entity's ${type}`}
              value={readField(carried, field).value}
              {...(field.min === undefined ? {} : { min: field.min })}
              {...(field.step === undefined ? {} : { step: field.step })}
              onCommit={(value) => write(field, value)}
            />
          </Row>
        ))}

      {has && description.fields.length === 0 && (
        <Note>This one is carried or not carried; there is nothing to set on it.</Note>
      )}

      {/* Said rather than hidden. The field shows the description's default when
          the file holds something it cannot draw, and a default shown as though
          it were the file's own number is the panel saying something untrue
          (`editor-ui` U10). */}
      {mismatched.length > 0 && (
        <Note data-testid={`entity-component-${type}-mismatch`}>
          {mismatched.join(' and ')} in this level {mismatched.length === 1 ? 'is' : 'are'} not a number, so
          the default is shown. Typing here replaces what the file has.
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
