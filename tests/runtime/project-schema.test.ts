import { describe, expect, it } from 'vitest'

import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectSchema,
  defaultProject,
  serializeProject,
  type Project,
} from '../../runtime/formats/project-schema'

/**
 * The project format: which level the game starts on.
 *
 * The round trip is the standing tripwire every format gets from the moment it
 * exists (editor-verification V7), and it is doing double duty here as it does
 * everywhere: the editor rewrites this file, and the write/watch/re-read cycle only
 * terminates because the round trip is identity (editor-kernel G10).
 *
 * The interesting half is the loose-object test. This is a file a human opens in a
 * text editor, and the editor rewrites it from the object it parsed — so a key the
 * parse dropped would be a key deleted out of somebody's file, and no round-trip
 * comparison written against the schema's own fields would notice (text-formats F1).
 */

const project: Project = {
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  startupScene: 'scenes/level-01.json',
}

function roundTrip(value: unknown): unknown {
  return ProjectSchema.parse(JSON.parse(JSON.stringify(value)))
}

describe('the project format', () => {
  it('survives a round trip through JSON unchanged', () => {
    // Compared against the original, never against a re-parse of itself: that is
    // the comparison that fails when a writer emits a field the schema drops.
    expect(roundTrip(project)).toEqual(project)
  })

  it('survives a round trip with the generated marking on it', () => {
    const marked: Project = { ...project, generatedBy: 'claude-opus-5', generatedAt: '2026-08-12' }
    expect(roundTrip(marked)).toEqual(marked)
  })

  it('survives a round trip with no starting level chosen', () => {
    const empty = defaultProject()
    expect(empty.startupScene).toBeNull()
    expect(roundTrip(empty)).toEqual(empty)
  })

  it('keeps a key a human added that no writer knows about', () => {
    const byHand = { ...project, windowTitle: 'My game', notes: { todo: 'pick an icon' } }
    expect(roundTrip(byHand)).toEqual(byHand)
  })

  it('is written with two spaces and a trailing newline', () => {
    const text = serializeProject(project)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "startupScene"')
    expect(ProjectSchema.parse(JSON.parse(text))).toEqual(project)
  })
})

describe('what the project format refuses', () => {
  it('refuses a document that is not project settings', () => {
    expect(ProjectSchema.safeParse({ ...project, format: 'kernel2d.scene' }).success).toBe(false)
  })

  it('refuses a version this editor does not know', () => {
    expect(ProjectSchema.safeParse({ ...project, version: 2 }).success).toBe(false)
  })

  it('refuses an empty starting level, because that is not the same as none', () => {
    // A path of "" would read as a level somewhere and resolve to nothing. Null is
    // the one spelling of "nothing chosen".
    expect(ProjectSchema.safeParse({ ...project, startupScene: '' }).success).toBe(false)
  })

  it('refuses a missing starting level, because absent and null are not two states', () => {
    const { startupScene: _omitted, ...withoutIt } = project
    expect(ProjectSchema.safeParse(withoutIt).success).toBe(false)
  })
})
