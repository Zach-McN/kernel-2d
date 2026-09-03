import type { ReactElement } from 'react'

import { type Prefab, type PrefabPart } from '../../runtime/formats/prefab-schema'
import { spinOf, type Entity } from '../../runtime/formats/scene-schema'
import { editPartOverride, overridesOf, resolvedPartsOf } from '../shell/part-overrides'
import { ComponentFields } from './ComponentFields'
import { Field, Note, Row, Section } from './fields'
import { NumberField } from './NumberField'

/**
 * The parts of a placed prefab, as this placement has them.
 *
 * A part is not an entity in the level, so it has no row and no Inspector of
 * its own; it is seen and tuned here, under the placement it belongs to. Where
 * a part sits is the prefab's (shown, not editable); what it *carries* can be
 * given to this placement alone — the arm of this fire bar turning at 180 while
 * the prefab says 90 — written on the placement as an override
 * (`editor/shell/part-overrides.ts`), the same "its own wins, whole" rule a
 * placement's own components already follow against its prefab.
 */
export function PlacementParts({
  scenePath,
  placement,
  prefab,
}: {
  scenePath: string
  placement: Entity
  prefab: Prefab
}): ReactElement | null {
  const parts = prefab.children ?? []
  if (parts.length === 0) return null
  const resolved = resolvedPartsOf(placement, prefab)

  return (
    <Section title="Parts">
      <Note>
        These come with the prefab and move with this placement. Where each sits is set in the prefab; what
        it carries can be given to this placement alone.
      </Note>
      {parts.map((part, index) => {
        const drawn = resolved[index]
        if (drawn === undefined) return null
        return (
          <PlacementPart
            key={part.id}
            scenePath={scenePath}
            placement={placement}
            prefab={prefab}
            part={part}
            resolved={drawn}
          />
        )
      })}
    </Section>
  )
}

function PlacementPart({
  scenePath,
  placement,
  prefab,
  part,
  resolved,
}: {
  scenePath: string
  placement: Entity
  prefab: Prefab
  part: PrefabPart
  resolved: Entity
}): ReactElement {
  const own = overridesOf(placement, part.id)
  const ownSpin = spinOf({ components: own })
  const shownSpin = spinOf(resolved)
  const rides = part.parent === undefined ? prefab.name : (prefab.children?.find((one) => one.id === part.parent)?.name ?? prefab.name)

  const change = (field: string, label: string, recipe: (components: Record<string, unknown>) => void): void => {
    editPartOverride(
      scenePath,
      placement.id,
      part.id,
      { label, merge: `${scenePath}#${placement.id}#${part.id}#${field}` },
      recipe,
    )
  }

  return (
    <div className="inspector__part" data-testid={`entity-part-${part.id}`} data-part-id={part.id}>
      <Field label="Part" value={part.name} testId={`entity-part-${part.id}-name`} />
      <Field
        label="Rides"
        value={`${rides}, ${part.transform.x} across and ${part.transform.y} up`}
        testId={`entity-part-${part.id}-offset`}
      />

      <Row label="Spin">
        <NumberField
          testId={`entity-part-${part.id}-spin`}
          title="Degrees per second, counter-clockwise, while the level is running. Typing here gives this placement's part its own rate."
          value={shownSpin?.degreesPerSecond ?? 0}
          step={15}
          onCommit={(rate) =>
            change('spin', 'Part spin', (components) => {
              components['spin'] = { degreesPerSecond: rate }
            })
          }
        />
        {ownSpin !== null && (
          <button
            type="button"
            className="control control--action"
            data-testid={`entity-part-${part.id}-spin-reset`}
            title="Drop this placement's own rate and follow the prefab's again."
            onClick={() =>
              editPartOverride(scenePath, placement.id, part.id, { label: 'Follow prefab spin' }, (components) => {
                delete components['spin']
              })
            }
          >
            Use the prefab&apos;s
          </button>
        )}
      </Row>
      {ownSpin === null && shownSpin !== null && (
        <Note data-testid={`entity-part-${part.id}-spin-inherited`}>
          Turns at {shownSpin.degreesPerSecond}°/s because the prefab says so. Typing a rate gives this placement
          its own.
        </Note>
      )}
      {ownSpin !== null && (
        <Note data-testid={`entity-part-${part.id}-spin-own`}>
          This placement&apos;s own rate, written into the level. The prefab&apos;s is{' '}
          {spinOf(part)?.degreesPerSecond ?? 0}°/s.
        </Note>
      )}

      <ComponentFields
        target={{ kind: 'placement-part', scenePath, placement, partId: part.id, resolved }}
      />
    </div>
  )
}
