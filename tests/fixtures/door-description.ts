import {
  COMPONENT_FORMAT,
  COMPONENT_VERSION,
  type ComponentDescription,
} from '../../runtime/formats/component-schema.js'

/**
 * A description using every field kind there is, plus one there is not.
 *
 * A `door` — the component the brief names as the reason for the scene kind —
 * described with a level to go to, a lock, a sign, a side to stand on, a
 * picture, a sound and a delay, and one field of a kind this editor has never
 * heard of. It lives here rather than in the sample project because a sample
 * description must have a system in `src/` reading it (`text-formats` T22), and
 * no door system exists there; the browser suite writes it into the throwaway
 * test project's `components/` folder and takes it away again after.
 *
 * Marked as AI-authored, because a copy of it lands on disk in a project folder.
 */
export const DOOR_DESCRIPTION: ComponentDescription = {
  format: COMPONENT_FORMAT,
  version: COMPONENT_VERSION,
  type: 'door',
  title: 'Door',
  note: 'Walking into it takes the player to another level.',
  fields: [
    { kind: 'scene', key: 'scene', label: 'Leads to', title: 'The level this door opens onto' },
    { kind: 'toggle', key: 'locked', label: 'Locked', default: false },
    { kind: 'text', key: 'sign', label: 'Sign', title: 'What is written over the door', default: '' },
    {
      kind: 'choice',
      key: 'side',
      label: 'Side',
      title: 'Which edge of the level it sits on',
      options: [
        { value: 'left', label: 'Left edge' },
        { value: 'right', label: 'Right edge' },
        { value: 'top', label: 'Top edge' },
        { value: 'bottom', label: 'Bottom edge' },
      ],
      default: 'right',
    },
    { kind: 'asset', key: 'texture', label: 'Picture', of: 'texture' },
    { kind: 'asset', key: 'sound', label: 'Sound', title: 'Played when it opens', of: 'audio' },
    { kind: 'number', key: 'delay', label: 'Delay', title: 'Seconds before it opens', default: 0, min: 0, max: 10, step: 0.5 },
    { kind: 'colour', key: 'tint', label: 'Tint' },
  ],
  generatedBy: 'claude-fable-5',
  generatedAt: '2026-08-15',
}

/** The file it is written to when a suite puts it in a project. */
export const DOOR_DESCRIPTION_PATH = 'components/door.json'
