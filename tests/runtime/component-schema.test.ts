import { describe, expect, it } from 'vitest'

import {
  COMPONENT_FORMAT,
  ComponentDescriptionSchema,
  defaultComponentDescription,
  defaultValueFor,
  readField,
  serializeComponentDescription,
  type ComponentDescription,
  type DescribedNumber,
} from '../../runtime/formats/component-schema'
import { COMPONENT_SCHEMAS, isKnownComponentType } from '../../runtime/formats/scene-schema'

/**
 * A game's description of one of its own components: what it accepts, what it
 * refuses, and — the half that matters most — what it does with data that
 * disagrees with it.
 *
 * The refusals are about the *description*, which is a file somebody writes once
 * and the editor reads. The leniency is about the *component*, which is data in
 * every level and must never fail to open. Those are two different standards on
 * purpose and this file is where the difference is asserted.
 */

const PATROL: ComponentDescription = {
  format: COMPONENT_FORMAT,
  version: 1,
  type: 'patrol',
  title: 'Patrol',
  note: 'Walks between two points while the level is running.',
  fields: [
    { kind: 'number', key: 'unitsPerSecond', label: 'Speed', default: 24, min: 0, step: 1 },
    { kind: 'number', key: 'fromX', label: 'From', default: 0, step: 1 },
    { kind: 'number', key: 'toX', label: 'To', default: 0, step: 1 },
  ],
}

const SPEED = PATROL.fields[0] as DescribedNumber

describe('a description survives a round trip', () => {
  it('comes back as it went in', () => {
    expect(ComponentDescriptionSchema.parse(JSON.parse(JSON.stringify(PATROL)))).toEqual(PATROL)
  })

  it('comes back with its marking, and with a field with nothing optional set', () => {
    const marked: ComponentDescription = {
      ...defaultComponentDescription('shove', 'Shove'),
      fields: [{ kind: 'number', key: 'force', label: 'Force', default: 1 }],
      generatedBy: 'claude-opus-5',
      generatedAt: '2026-08-15',
    }
    expect(ComponentDescriptionSchema.parse(JSON.parse(JSON.stringify(marked)))).toEqual(marked)
  })

  /**
   * `text-formats` T9, the tripwire every format in this kernel carries: the
   * editor rewrites the file from the object it parsed, so a key the parse drops
   * is a key deleted out of a file a human wrote.
   */
  it('keeps a key somebody added that no writer knows about', () => {
    const handEdited = {
      ...PATROL,
      whyItExists: 'so the slime paces',
      fields: [{ ...SPEED, colour: 'green' }],
    }
    expect(ComponentDescriptionSchema.parse(JSON.parse(JSON.stringify(handEdited)))).toEqual(
      handEdited,
    )
  })

  it('is written two-space with a trailing newline, like every other document', () => {
    const text = serializeComponentDescription(PATROL)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "type": "patrol"')
  })
})

describe('a description this editor cannot use is refused', () => {
  const refuses = (value: unknown): boolean => !ComponentDescriptionSchema.safeParse(value).success

  it('refuses another format, another version, and a type with no name', () => {
    expect(refuses({ ...PATROL, format: 'kernel2d.scene' })).toBe(true)
    expect(refuses({ ...PATROL, version: 2 })).toBe(true)
    expect(refuses({ ...PATROL, type: '' })).toBe(true)
    expect(refuses({ ...PATROL, title: '' })).toBe(true)
  })

  it('refuses a field with no key, no label, no default, or a kind nobody has written yet', () => {
    expect(refuses({ ...PATROL, fields: [{ ...SPEED, key: '' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ ...SPEED, label: '' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ kind: 'number', key: 'a', label: 'A' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ ...SPEED, default: Number.POSITIVE_INFINITY }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ ...SPEED, kind: 'colour' }] })).toBe(true)
  })

  /**
   * Two controls writing to one key: whichever was typed in last appears to work
   * until the panel re-renders. Cheaper to refuse the file than to explain that.
   */
  it('refuses two fields that would write to the same key', () => {
    expect(refuses({ ...PATROL, fields: [SPEED, { ...SPEED, label: 'Speed again' }] })).toBe(true)
  })

  it('accepts a description with no fields at all, which is a marker component', () => {
    expect(ComponentDescriptionSchema.safeParse(defaultComponentDescription('solid', 'Solid')).success).toBe(
      true,
    )
  })
})

describe('what Add writes', () => {
  it('is every described field at its default, so the game’s own system reads it as present', () => {
    expect(defaultValueFor(PATROL)).toEqual({ unitsPerSecond: 24, fromX: 0, toX: 0 })
  })

  it('is an empty object for a marker component, which is still the component being there', () => {
    expect(defaultValueFor(defaultComponentDescription('solid', 'Solid'))).toEqual({})
  })
})

describe('reading a field off a component in a level', () => {
  it('is the number in the file when there is one', () => {
    expect(readField({ unitsPerSecond: 40 }, SPEED)).toEqual({ value: 40, wrongKind: false })
    expect(readField({ unitsPerSecond: -2.5 }, SPEED)).toEqual({ value: -2.5, wrongKind: false })
  })

  /**
   * A component gains a field the day its description does, and every level
   * written before that has none. Absent is not wrong — it is a field nobody has
   * filled in yet, and it shows the default with nothing said about it.
   */
  it('is the default, quietly, when the field is not in the file', () => {
    expect(readField({}, SPEED)).toEqual({ value: 24, wrongKind: false })
    expect(readField({ fromX: 8 }, SPEED)).toEqual({ value: 24, wrongKind: false })
  })

  /**
   * The half that keeps the panel honest. A default shown as though it were the
   * file's value is a panel saying something untrue; saying which fields
   * disagree is what lets it be shown and explained.
   */
  it('says so when the file holds something a number field cannot show', () => {
    expect(readField({ unitsPerSecond: 'fast' }, SPEED)).toEqual({ value: 24, wrongKind: true })
    expect(readField({ unitsPerSecond: null }, SPEED)).toEqual({ value: 24, wrongKind: true })
    expect(readField({ unitsPerSecond: Number.NaN }, SPEED)).toEqual({ value: 24, wrongKind: true })
    expect(readField({ unitsPerSecond: { x: 1 } }, SPEED)).toEqual({ value: 24, wrongKind: true })
  })

  it('never throws on a component that is not an object at all', () => {
    expect(readField(null, SPEED)).toEqual({ value: 24, wrongKind: false })
    expect(readField('patrol', SPEED)).toEqual({ value: 24, wrongKind: false })
    expect(readField(undefined, SPEED)).toEqual({ value: 24, wrongKind: false })
  })
})

/**
 * The drift guard for the decision this whole feature rests on.
 *
 * Describing a component buys it an inspector and deliberately not validation:
 * a game-authored file must never be able to stop a level opening. The day
 * somebody "tidies up" by registering described types in `COMPONENT_SCHEMAS`,
 * every level carrying a patrol starts failing to parse on a typo in one file,
 * and this is the test that says so first.
 */
describe('describing a component does not register it', () => {
  it('leaves the kernel’s own registry at the four types it owns', () => {
    expect(Object.keys(COMPONENT_SCHEMAS).sort()).toEqual(['prefab', 'screen', 'spin', 'sprite'])
    expect(isKnownComponentType('patrol')).toBe(false)
  })
})
