import type { ReactElement } from 'react'

import { PREFAB_FORMAT, defaultPart, type Prefab, type PrefabPart } from '../../runtime/formats/prefab-schema'
import { spinOf, spriteOf, type AssetRef } from '../../runtime/formats/scene-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { freeName, namesIn } from '../shell/entity-names'
import { mintId } from '../store/ids'
import { editDocument, sealEdits } from '../store/open-documents'
import { ComponentFields } from './ComponentFields'
import { Note, Row, Section } from './fields'
import { NumberField } from './NumberField'
import { TexturePicker } from './TexturePicker'

/**
 * The parts of a prefab — what comes attached to every instance — authored in
 * the prefab's own Inspector.
 *
 * A part is the shape of an entity minus what a placement decides: a name, an
 * offset from whatever it rides, a picture, a turn rate, the game's own
 * components. Everything here is the field the entity panel already has for
 * the same thing, aimed at a part inside the prefab document, so one number
 * typed here reaches every placed group at once through the same door the
 * prefab's picture uses (`editor-kernel` D25).
 *
 * **What a part cannot be given here:** a prefab. A part is a thing the prefab
 * *is made of*, and a prefab made of prefabs is the cycle the format refuses
 * (`runtime/formats/prefab-schema.ts`). And a part cannot be attached to
 * itself or to anything below it, for the same reason a row in the Outliner
 * cannot be dropped onto its own child.
 *
 * Every write goes through the transaction API on the prefab document; one
 * field visit is one press of Ctrl-Z, and removing the last part removes the
 * `children` key rather than leaving an empty list, so a prefab that has gone
 * back to being one entity is byte-for-byte what it was (text-formats T21).
 */
export function PrefabParts({
  path,
  prefab,
  tree,
}: {
  path: string
  prefab: Prefab
  tree: ProjectTree | null
}): ReactElement {
  const parts = prefab.children ?? []

  const change = (partId: string, field: string, label: string, recipe: (part: PrefabPart) => void): void => {
    editDocument(path, { label, merge: `${path}#${partId}#${field}` }, (document) => {
      if (document.format !== PREFAB_FORMAT) return
      const part = document.children?.find((one) => one.id === partId)
      if (part !== undefined) recipe(part)
    })
  }

  const add = (): void => {
    const id = mintId()
    editDocument(path, { label: 'Add part' }, (document) => {
      if (document.format !== PREFAB_FORMAT) return
      const existing = document.children ?? []
      existing.push(defaultPart(id, freeName(namesIn(existing), 'Part')))
      document.children = existing
    })
  }

  const remove = (partId: string): void => {
    editDocument(path, { label: 'Remove part' }, (document) => {
      if (document.format !== PREFAB_FORMAT) return
      const existing = document.children ?? []
      const going = existing.find((one) => one.id === partId)
      if (going === undefined) return
      // What rode the removed part now rides what it rode, rather than being
      // thrown away with it: a designer taking an arm out is not asking for
      // the fire on it to vanish.
      for (const part of existing) {
        if (part.parent !== partId) continue
        if (going.parent === undefined) delete part.parent
        else part.parent = going.parent
      }
      const kept = existing.filter((one) => one.id !== partId)
      if (kept.length === 0) delete document.children
      else document.children = kept
    })
  }

  return (
    <Section title="Parts">
      <Note>
        Parts come attached to every instance of this prefab: each is placed at an offset from what it rides,
        and moves, turns and grows with it. A placement can give a part its own settings, but where a part
        sits is decided here, for every instance at once.
      </Note>

      {parts.map((part) => (
        <PartFields
          key={part.id}
          path={path}
          prefab={prefab}
          part={part}
          parts={parts}
          tree={tree}
          onChange={(field, label, recipe) => change(part.id, field, label, recipe)}
          onRemove={() => remove(part.id)}
        />
      ))}

      <div className="inspector__actions">
        <button
          type="button"
          className="control control--action"
          data-testid="prefab-part-add"
          title="A new part, sitting on the prefab's own spot and drawing nothing yet. Give it a picture and an offset."
          onClick={add}
        >
          Add part
        </button>
      </div>
    </Section>
  )
}

function PartFields({
  path,
  prefab,
  part,
  parts,
  tree,
  onChange,
  onRemove,
}: {
  path: string
  prefab: Prefab
  part: PrefabPart
  parts: readonly PrefabPart[]
  tree: ProjectTree | null
  onChange: (field: string, label: string, recipe: (part: PrefabPart) => void) => void
  onRemove: () => void
}): ReactElement {
  const sprite = spriteOf(part)
  const spin = spinOf(part)
  // What this part may ride: the prefab itself, or any part that is not this
  // one and not below it.
  const below = new Set(descendantIdsOf(parts, part.id))
  const candidates = parts.filter((one) => one.id !== part.id && !below.has(one.id))

  const setTexture = (reference: AssetRef | null): void => {
    onChange('texture', reference === null ? 'Remove part sprite' : 'Set part texture', (draft) => {
      if (reference === null) {
        delete draft.components['sprite']
        return
      }
      // Spread rather than replace: a sprite carries more than its texture
      // (an opacity, say), and a picker that rewrote it whole would drop that.
      const standing = draft.components['sprite']
      const kept = typeof standing === 'object' && standing !== null ? standing : {}
      draft.components['sprite'] = { ...kept, texture: reference }
    })
  }

  return (
    <div className="inspector__part" data-testid={`prefab-part-${part.id}`} data-part-id={part.id}>
      <Row label="Part">
        <input
          type="text"
          className="control control--text"
          data-testid={`prefab-part-${part.id}-name`}
          value={part.name}
          onBlur={sealEdits}
          onChange={(event) => {
            const name = event.target.value
            onChange('name', 'Rename part', (draft) => {
              draft.name = name
            })
          }}
        />
      </Row>

      <Row label="Rides">
        <select
          className="control control--choice"
          data-testid={`prefab-part-${part.id}-parent`}
          title="What this part is attached to: the prefab's own entity, or another part."
          value={part.parent !== undefined && candidates.some((one) => one.id === part.parent) ? part.parent : ''}
          onChange={(event) => {
            const parent = event.target.value
            onChange('parent', 'Attach part', (draft) => {
              if (parent === '') delete draft.parent
              else draft.parent = parent
            })
          }}
        >
          <option value="">{prefab.name} itself</option>
          {candidates.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Offset">
        <NumberField
          testId={`prefab-part-${part.id}-x`}
          title="Across from what it rides, in scene units"
          value={part.transform.x}
          step={1}
          onCommit={(x) =>
            onChange('x', 'Part offset', (draft) => {
              draft.transform.x = x
            })
          }
        />
        <NumberField
          testId={`prefab-part-${part.id}-y`}
          title="Up from what it rides, in scene units"
          value={part.transform.y}
          step={1}
          onCommit={(y) =>
            onChange('y', 'Part offset', (draft) => {
              draft.transform.y = y
            })
          }
        />
      </Row>

      <Row label="Rotation">
        <NumberField
          testId={`prefab-part-${part.id}-rotation`}
          title="Degrees, counter-clockwise, from what it rides"
          value={part.transform.rotation}
          step={15}
          onCommit={(rotation) =>
            onChange('rotation', 'Part rotation', (draft) => {
              draft.transform.rotation = rotation
            })
          }
        />
      </Row>

      <Row label="Scale">
        <NumberField
          testId={`prefab-part-${part.id}-scale-x`}
          title="Across"
          value={part.transform.scaleX}
          step={0.5}
          onCommit={(scaleX) =>
            onChange('scaleX', 'Part scale', (draft) => {
              draft.transform.scaleX = scaleX
            })
          }
        />
        <NumberField
          testId={`prefab-part-${part.id}-scale-y`}
          title="Down"
          value={part.transform.scaleY}
          step={0.5}
          onCommit={(scaleY) =>
            onChange('scaleY', 'Part scale', (draft) => {
              draft.transform.scaleY = scaleY
            })
          }
        />
      </Row>

      <TexturePicker
        value={sprite?.texture ?? null}
        tree={tree}
        testId={`prefab-part-${part.id}-texture`}
        onPick={setTexture}
      />

      <Row label="Spin">
        <NumberField
          testId={`prefab-part-${part.id}-spin`}
          title="Degrees per second, counter-clockwise, while the level is running. Nought means it does not turn."
          value={spin?.degreesPerSecond ?? 0}
          step={15}
          onCommit={(rate) =>
            onChange('spin', 'Part spin', (draft) => {
              if (rate === 0) delete draft.components['spin']
              else draft.components['spin'] = { degreesPerSecond: rate }
            })
          }
        />
      </Row>

      <ComponentFields target={{ kind: 'prefab-part', path, prefab, partId: part.id }} />

      <div className="inspector__actions">
        <button
          type="button"
          className="control control--action"
          data-testid={`prefab-part-${part.id}-remove`}
          title="Take this part off the prefab, and off every instance. Anything riding it rides what it rode. Ctrl-Z puts it back."
          onClick={onRemove}
        >
          Remove part
        </button>
      </div>
    </div>
  )
}

/** Every part riding this one, directly or through others — walked once, so a looping file cannot hang the panel. */
function descendantIdsOf(parts: readonly PrefabPart[], id: string): string[] {
  const found = new Set<string>([id])
  const pending = [id]
  while (pending.length > 0) {
    const next = pending.shift() as string
    for (const part of parts) {
      if (part.parent !== next || found.has(part.id)) continue
      found.add(part.id)
      pending.push(part.id)
    }
  }
  found.delete(id)
  return [...found]
}
