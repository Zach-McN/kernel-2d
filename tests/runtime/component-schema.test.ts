import { describe, expect, it } from 'vitest'

import {
  COMPONENT_FORMAT,
  ComponentDescriptionSchema,
  defaultComponentDescription,
  defaultValueFor,
  describedReferencesOf,
  isKnownField,
  readField,
  serializeComponentDescription,
  type ComponentDescription,
  type DescribedAsset,
  type DescribedChoice,
  type DescribedNumber,
  type DescribedScene,
  type DescribedText,
  type DescribedToggle,
} from '../../runtime/formats/component-schema'
import { COMPONENT_SCHEMAS, isKnownComponentType } from '../../runtime/formats/scene-schema'
import { DOOR_DESCRIPTION } from '../fixtures/door-description'

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

  /**
   * Every kind there is, and one there is not, through the writer (`text-formats`
   * T16): the bytes that go to disk come back as the same object, including the
   * `colour` field this editor has never heard of.
   */
  it('brings back every field kind, and a kind it does not know, exactly', () => {
    expect(ComponentDescriptionSchema.parse(JSON.parse(serializeComponentDescription(DOOR_DESCRIPTION)))).toEqual(
      DOOR_DESCRIPTION,
    )
  })
})

const fieldOf = <F>(key: string): F => DOOR_DESCRIPTION.fields.find((field) => field.key === key) as F
const SCENE = fieldOf<DescribedScene>('scene')
const LOCKED = fieldOf<DescribedToggle>('locked')
const SIGN = fieldOf<DescribedText>('sign')
const SIDE = fieldOf<DescribedChoice>('side')
const PICTURE = fieldOf<DescribedAsset>('texture')
const SOUND = fieldOf<DescribedAsset>('sound')
const KNIGHT = { id: 'knight-id', path: 'assets/textures/knight.png' }

describe('a field of a kind this editor does not know', () => {
  it('is kept and reported as unknown rather than refusing the file', () => {
    const parsed = ComponentDescriptionSchema.parse(JSON.parse(JSON.stringify(DOOR_DESCRIPTION)))
    const tint = parsed.fields.find((field) => field.key === 'tint')
    expect(tint).toEqual({ kind: 'colour', key: 'tint', label: 'Tint' })
    expect(tint !== undefined && isKnownField(tint)).toBe(false)
    expect(SIGN !== undefined && isKnownField(SIGN)).toBe(true)
  })

  it('still needs a key and a label, like every field', () => {
    const refuses = (value: unknown): boolean => !ComponentDescriptionSchema.safeParse(value).success
    expect(refuses({ ...PATROL, fields: [{ kind: 'colour', key: '', label: 'Tint' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ kind: 'colour', key: 'tint' }] })).toBe(true)
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

  /**
   * A *known* kind written wrongly is refused, even though an unknown kind is
   * kept: a number with no default is a mistake in a file its author is looking
   * at, not a field from a newer editor.
   */
  it('refuses a field with no key, no label, or a known kind missing what it needs', () => {
    expect(refuses({ ...PATROL, fields: [{ ...SPEED, key: '' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ ...SPEED, label: '' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ kind: 'number', key: 'a', label: 'A' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ ...SPEED, default: Number.POSITIVE_INFINITY }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ kind: 'text', key: 'a', label: 'A' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ kind: 'toggle', key: 'a', label: 'A', default: 'yes' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ kind: 'choice', key: 'a', label: 'A', options: [], default: 'x' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ kind: 'asset', key: 'a', label: 'A', of: 'font' }] })).toBe(true)
  })

  it('refuses a choice whose default is not on its list, or whose list says one value twice', () => {
    expect(refuses({ ...PATROL, fields: [{ ...SIDE, default: 'middle' }] })).toBe(true)
    expect(
      refuses({
        ...PATROL,
        fields: [{ ...SIDE, options: [{ value: 'left', label: 'Left' }, { value: 'left', label: 'Also left' }] }],
      }),
    ).toBe(true)
  })

  /**
   * The runtime loads what sits under `texture` and the export ships what sits
   * under `scene`, and neither can read a description to learn another name. A
   * description that used one would author perfectly and fail out of sight.
   */
  it('refuses a scene field not called scene, and a texture field not called texture', () => {
    expect(refuses({ ...PATROL, fields: [{ ...SCENE, key: 'target' }] })).toBe(true)
    expect(refuses({ ...PATROL, fields: [{ ...PICTURE, key: 'icon' }] })).toBe(true)
    // An audio field, or one open to any file, can be called anything.
    expect(refuses({ ...PATROL, fields: [{ ...SOUND, key: 'chime' }] })).toBe(false)
    expect(refuses({ ...PATROL, fields: [{ kind: 'asset', key: 'attachment', label: 'File' }] })).toBe(false)
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

  /**
   * A file or a level starts as nothing chosen, and that is `null` rather than a
   * missing key: an absent key is a level written before the field existed, and a
   * game's own system may tell the two apart. The unknown `tint` is left out —
   * nothing here can say what one starts as.
   */
  it('writes every kind at its default, null for a file or a level, and nothing for a kind it does not know', () => {
    expect(defaultValueFor(DOOR_DESCRIPTION)).toEqual({
      scene: null,
      locked: false,
      sign: '',
      side: 'right',
      texture: null,
      sound: null,
      delay: 0,
    })
  })
})

describe('reading a field off a component in a level', () => {
  it('is the number in the file when there is one', () => {
    expect(readField({ unitsPerSecond: 40 }, SPEED)).toEqual({ value: 40, wrongKind: false, held: 40 })
    expect(readField({ unitsPerSecond: -2.5 }, SPEED)).toEqual({ value: -2.5, wrongKind: false, held: -2.5 })
  })

  it('reads each of the other kinds when the file holds the right shape', () => {
    expect(readField({ sign: 'Exit' }, SIGN).value).toBe('Exit')
    expect(readField({ locked: true }, LOCKED).value).toBe(true)
    expect(readField({ side: 'top' }, SIDE).value).toBe('top')
    expect(readField({ texture: KNIGHT }, PICTURE).value).toEqual(KNIGHT)
    expect(readField({ texture: null }, PICTURE)).toEqual({ value: null, wrongKind: false, held: null })
    expect(readField({ scene: 'scenes/level-02.json' }, SCENE).value).toBe('scenes/level-02.json')
    expect(readField({ scene: null }, SCENE)).toEqual({ value: null, wrongKind: false, held: null })
  })

  /**
   * The wrong shape for each kind — and `held` is exactly what the file has, so
   * a panel can show it as it is and leave it alone. A word not on a choice's
   * list is wrong for that field, not merely a string.
   */
  it('says so, and hands back what the file has, for each kind', () => {
    expect(readField({ sign: 4 }, SIGN)).toEqual({ value: '', wrongKind: true, held: 4 })
    expect(readField({ locked: 'yes' }, LOCKED)).toEqual({ value: false, wrongKind: true, held: 'yes' })
    expect(readField({ side: 'middle' }, SIDE)).toEqual({ value: 'right', wrongKind: true, held: 'middle' })
    expect(readField({ side: 2 }, SIDE).wrongKind).toBe(true)
    expect(readField({ texture: 'assets/textures/knight.png' }, PICTURE)).toEqual({
      value: null,
      wrongKind: true,
      held: 'assets/textures/knight.png',
    })
    expect(readField({ texture: { id: 'x' } }, PICTURE).wrongKind).toBe(true)
    expect(readField({ scene: { path: 'scenes/level-02.json' } }, SCENE).wrongKind).toBe(true)
    expect(readField({ scene: 7 }, SCENE).wrongKind).toBe(true)
  })

  /**
   * A component gains a field the day its description does, and every level
   * written before that has none. Absent is not wrong — it is a field nobody has
   * filled in yet, and it shows the default with nothing said about it.
   */
  it('is the default, quietly, when the field is not in the file', () => {
    expect(readField({}, SPEED)).toEqual({ value: 24, wrongKind: false, held: undefined })
    expect(readField({ fromX: 8 }, SPEED)).toEqual({ value: 24, wrongKind: false, held: undefined })
    expect(readField({}, SCENE)).toEqual({ value: null, wrongKind: false, held: undefined })
  })

  /**
   * The half that keeps the panel honest. A default shown as though it were the
   * file's value is a panel saying something untrue; saying which fields
   * disagree is what lets the file's own value be shown and left alone.
   */
  it('says so when the file holds something a number field cannot show', () => {
    expect(readField({ unitsPerSecond: 'fast' }, SPEED)).toEqual({ value: 24, wrongKind: true, held: 'fast' })
    expect(readField({ unitsPerSecond: null }, SPEED)).toEqual({ value: 24, wrongKind: true, held: null })
    expect(readField({ unitsPerSecond: Number.NaN }, SPEED).wrongKind).toBe(true)
    expect(readField({ unitsPerSecond: { x: 1 } }, SPEED)).toEqual({ value: 24, wrongKind: true, held: { x: 1 } })
  })

  it('never throws on a component that is not an object at all', () => {
    expect(readField(null, SPEED)).toEqual({ value: 24, wrongKind: false, held: undefined })
    expect(readField('patrol', SPEED)).toEqual({ value: 24, wrongKind: false, held: undefined })
    expect(readField(undefined, SPEED)).toEqual({ value: 24, wrongKind: false, held: undefined })
  })
})

/**
 * Where a described component's references are, as the format states it — the
 * described counterpart of `COMPONENT_REFERENCE_FIELDS`, and what the editor's
 * rename asks before rewriting a level.
 */
describe('where a described component points at files and levels', () => {
  it('names each asset and scene field, and nothing else', () => {
    expect(describedReferencesOf(DOOR_DESCRIPTION)).toEqual([
      { key: 'scene', kind: 'scene' },
      { key: 'texture', kind: 'asset' },
      { key: 'sound', kind: 'asset' },
    ])
    expect(describedReferencesOf(PATROL)).toEqual([])
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
