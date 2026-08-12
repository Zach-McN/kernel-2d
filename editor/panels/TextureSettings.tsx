import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

import type { TextureFilter, TextureImportSettings } from '../../runtime/formats/meta-schema'
import { editDocument, sealEdits } from '../store/open-documents'

/**
 * The three things you can tune about a texture, as controls.
 *
 * Written by hand rather than generated from the schema. Generating an
 * inspector from Zod is a real thing to want and a different piece of work; the
 * useful version of it is written after several inspectors exist to generalise
 * from, not before the first one does.
 *
 * Every control goes through the transaction API and nothing else, so undo
 * covers all of them without any of them knowing that undo exists
 * (editor-kernel D7). The `merge` key is what makes a run of keystrokes in one
 * field a single press of Ctrl-Z; leaving the field seals the run, so coming
 * back to it later is a new step.
 */

interface TextureSettingsProps {
  path: string
  settings: TextureImportSettings
}

export function TextureSettings({ path, settings }: TextureSettingsProps): ReactElement {
  const change = (
    field: string,
    label: string,
    recipe: (settings: TextureImportSettings) => void,
  ): void => {
    editDocument(path, { label, merge: `${path}#${field}` }, (document) => {
      if (document.importSettings.type === 'texture') recipe(document.importSettings)
    })
  }

  return (
    <>
      <Row label="Filtering">
        <select
          className="control control--choice"
          data-testid="filter-control"
          value={settings.filter}
          onBlur={sealEdits}
          onChange={(event) => {
            const filter = event.target.value as TextureFilter
            change('filter', 'Filtering', (next) => {
              next.filter = filter
            })
          }}
        >
          <option value="nearest">Nearest — crisp pixels</option>
          <option value="linear">Linear — smoothed</option>
        </select>
      </Row>

      <Row label="Pivot">
        <NumberField
          testId="pivot-x-control"
          title="Across, as a fraction of the width"
          value={settings.pivot.x}
          step={0.1}
          onCommit={(x) =>
            change('pivot.x', 'Pivot', (next) => {
              next.pivot.x = x
            })
          }
        />
        <NumberField
          testId="pivot-y-control"
          title="Down, as a fraction of the height"
          value={settings.pivot.y}
          step={0.1}
          onCommit={(y) =>
            change('pivot.y', 'Pivot', (next) => {
              next.pivot.y = y
            })
          }
        />
      </Row>

      <Row label="Frames">
        <select
          className="control control--choice"
          data-testid="slice-mode-control"
          value={settings.slice.mode}
          onBlur={sealEdits}
          onChange={(event) => {
            const mode = event.target.value
            change('slice.mode', 'Frames', (next) => {
              // The whole slice is replaced rather than patched, because a sheet
              // with no frame size is not a sheet — the two are one choice, and
              // half-switching would leave a shape the format does not have.
              next.slice =
                mode === 'grid'
                  ? { mode: 'grid', frameWidth: 16, frameHeight: 16, margin: 0, spacing: 0 }
                  : { mode: 'single' }
            })
          }}
        >
          <option value="single">One frame — the whole image</option>
          <option value="grid">A grid of frames</option>
        </select>
      </Row>

      {settings.slice.mode === 'grid' && (
        <>
          <Row label="Frame size">
            <NumberField
              testId="frame-width-control"
              title="Frame width in pixels"
              value={settings.slice.frameWidth}
              min={1}
              step={1}
              integer
              onCommit={(frameWidth) =>
                change('slice.frameWidth', 'Frame width', (next) => {
                  if (next.slice.mode === 'grid') next.slice.frameWidth = frameWidth
                })
              }
            />
            <NumberField
              testId="frame-height-control"
              title="Frame height in pixels"
              value={settings.slice.frameHeight}
              min={1}
              step={1}
              integer
              onCommit={(frameHeight) =>
                change('slice.frameHeight', 'Frame height', (next) => {
                  if (next.slice.mode === 'grid') next.slice.frameHeight = frameHeight
                })
              }
            />
          </Row>

          <Row label="Grid gaps">
            <NumberField
              testId="margin-control"
              title="Blank border around the whole sheet, in pixels"
              value={settings.slice.margin}
              min={0}
              step={1}
              integer
              onCommit={(margin) =>
                change('slice.margin', 'Margin', (next) => {
                  if (next.slice.mode === 'grid') next.slice.margin = margin
                })
              }
            />
            <NumberField
              testId="spacing-control"
              title="Blank gap between neighbouring frames, in pixels"
              value={settings.slice.spacing}
              min={0}
              step={1}
              integer
              onCommit={(spacing) =>
                change('slice.spacing', 'Spacing', (next) => {
                  if (next.slice.mode === 'grid') next.slice.spacing = spacing
                })
              }
            />
          </Row>
        </>
      )}
    </>
  )
}

/** The settings could not be written. Said out loud rather than left to be discovered. */
export function SaveFailure({ reason }: { reason: string }): ReactElement {
  return (
    <p className="inspector__note inspector__note--bad" data-testid="inspector-save-failure">
      These settings are not on disk: {reason} Change something else and the editor will try again.
    </p>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="inspector__field">
      <span className="inspector__label">{label}</span>
      <span className="control-row">{children}</span>
    </div>
  )
}

interface NumberFieldProps {
  value: number
  onCommit: (value: number) => void
  testId: string
  title: string
  min?: number
  step?: number
  /** Whole pixels. A frame two-and-a-half pixels wide is not a thing. */
  integer?: boolean
}

/**
 * A number that reports every keystroke, while still letting one be typed.
 *
 * The field keeps its own text while it is being edited, because a controlled
 * input fed straight from the document cannot be emptied to type a new value —
 * clearing it would parse as nothing, the document would reject it, and the old
 * number would reappear under the cursor. Text that is not a number yet is held
 * and not committed; anything that is, is committed immediately, so the folder
 * is right within the second rather than at the end of the edit.
 */
function NumberField({ value, onCommit, testId, title, min, step, integer }: NumberFieldProps): ReactElement {
  const [typed, setTyped] = useState<string | null>(null)
  const committed = useRef(value)

  // A value that arrived from somewhere else — undo, or a text editor — has to
  // win over half-typed text, or Ctrl-Z would appear to do nothing.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setTyped(null)
    }
  }, [value])

  return (
    <input
      type="number"
      className="control control--number"
      data-testid={testId}
      title={title}
      value={typed ?? String(value)}
      min={min}
      step={step}
      onChange={(event) => {
        const text = event.target.value
        setTyped(text)

        const parsed = Number(text)
        if (text.trim() === '' || !Number.isFinite(parsed)) return
        if (integer && !Number.isInteger(parsed)) return
        if (min !== undefined && parsed < min) return
        if (parsed === committed.current) return

        committed.current = parsed
        onCommit(parsed)
      }}
      onBlur={() => {
        // Leaving the field seals the undo step and drops any text that never
        // became a number, so the field always shows what the document holds.
        setTyped(null)
        sealEdits()
      }}
    />
  )
}
