import type { ReactElement } from 'react'

import type { ComponentDescription } from '../../runtime/formats/component-schema'
import type { Scene } from '../../runtime/formats/scene-schema'
import { useComponentTypes } from '../shell/component-types'
import { Field, Note, Row, Section } from './fields'

/**
 * What one of this game's component descriptions says, read rather than edited.
 *
 * **Read-only on purpose, and the purpose is not caution.** This file is the
 * game's vocabulary: adding a field to it is the same kind of act as adding a
 * system that reads the field, and the two have to be done together or the
 * editor grows a control nothing in the game looks at. So it is authored where
 * the systems are — in the folder, by whoever is writing the game's code — and
 * this panel's job is to say what the editor has understood from it. A schema
 * editor is a different feature with a different argument for existing.
 *
 * It is worth having at all for three answers no other panel gives: **is this
 * file being used**, which is not obvious for a file nothing points at; **which
 * fields did the editor take from it**, which is how a typo in `kind` is found;
 * and **is anything in the open level carrying it**, which is what turns "the
 * editor knows about patrol" into "the slime has one".
 */

export function ComponentInspector({
  path,
  description,
  scene,
}: {
  path: string
  description: ComponentDescription
  /** The open level, when there is one, purely to count what carries this. */
  scene: Scene | null
}): ReactElement {
  const types = useComponentTypes()
  const problem = types.problems[path]
  const inUse = types.fileOf[description.type] === path
  const carrying = scene?.entities.filter((entity) => entity.components[description.type] !== undefined).length ?? 0

  return (
    <>
      <Section title="Component">
        <Field label="Type" value={description.type} testId="component-type" />
        <Field label="Called" value={description.title} testId="component-title" />
        {description.note !== undefined && <Note>{description.note}</Note>}

        {/* A file that parsed perfectly and is doing nothing is the hardest kind
            to debug by staring at it, so the loser of a clash is told by name. */}
        {problem !== undefined ? (
          <Note data-testid="component-problem">{capitalize(problem)}.</Note>
        ) : (
          <Note data-testid="component-note">
            {inUse
              ? `Entities can carry a ${description.type}, and the Inspector shows these fields for one that does.`
              : 'This description is not in use.'}
          </Note>
        )}
      </Section>

      <Section title="Fields">
        {description.fields.length === 0 ? (
          <Note data-testid="component-fields-note">
            It has no fields, so carrying it is all there is to say about it.
          </Note>
        ) : (
          description.fields.map((field) => (
            <Row key={field.key} label={field.label}>
              <span className="inspector__value" data-testid={`component-field-${field.key}`}>
                {field.key} — {field.kind}, {String(field.default)} by default
              </span>
            </Row>
          ))
        )}
      </Section>

      <Section title="In this level">
        <Note data-testid="component-in-level">
          {scene === null
            ? 'No level is open, so there is nothing to count.'
            : carrying === 0
              ? `Nothing in the open level carries a ${description.type} yet. Select an entity and press Add ${description.type}.`
              : `${carrying} ${carrying === 1 ? 'entity carries' : 'entities carry'} a ${description.type} in the open level.`}
        </Note>
      </Section>
    </>
  )
}

function capitalize(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
