import type { ReactElement } from 'react'

import { ASSET_META_FORMAT, type TextureFilter, type TextureImportSettings } from '../../runtime/formats/meta-schema'
import { editDocument, sealEdits } from '../store/open-documents'
import { Row } from './fields'
import { NumberField } from './NumberField'

/**
 * The three things you can tune about a texture, as controls.
 *
 * Written by hand rather than generated from the schema, and still right to be.
 * Generated fields now exist — `./ComponentFields.tsx` draws them for the
 * components a *game* describes — and they are deliberately not this. The
 * difference is who owns the shape: a texture's import settings are the
 * kernel's, so there are three of them, they are the same three in every
 * project, and each has a sentence worth writing by hand about what it does to
 * the pixels. A game's components are open-ended and unknown here, which is the
 * only reason generating anything is worth its indirection. Generating *these*
 * would spend a description file to arrive back at the same three controls with
 * worse prose.
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
      if (document.format !== ASSET_META_FORMAT) return
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
