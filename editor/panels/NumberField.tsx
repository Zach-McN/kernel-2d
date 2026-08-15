import { useEffect, useRef, useState, type ReactElement } from 'react'

import { sealEdits } from '../store/open-documents'

/**
 * A number that reports every keystroke, while still letting one be typed.
 *
 * The field keeps its own text while it is being edited, because a controlled
 * input fed straight from the document cannot be emptied to type a new value —
 * clearing it would parse as nothing, the document would reject it, and the old
 * number would reappear under the cursor. Text that is not a number yet is held
 * and not committed; anything that is, is committed immediately, so the folder
 * is right within the second rather than at the end of the edit.
 *
 * Shared rather than living in one inspector, because there are two of them now
 * — a texture's pivot and an entity's position want exactly the same behaviour,
 * and two copies would drift the first time either was fixed.
 */

export interface NumberFieldProps {
  value: number
  onCommit: (value: number) => void
  testId: string
  title: string
  min?: number
  step?: number
  /** Whole pixels. A frame two-and-a-half pixels wide is not a thing. */
  integer?: boolean
  /** For a field in a window that opened to be typed into, and nowhere else. */
  autoFocus?: boolean
  /**
   * Values worth offering as a dropdown, without making them the only ones.
   *
   * A `<datalist>` rather than a `<select>` beside a field, because that is the
   * combo box the browser already has: the same input, with a list attached, so
   * picking `16` and typing `24` go through one code path and commit by the same
   * rule. A select plus a field would be two controls that can disagree about
   * what the value is.
   */
  presets?: readonly number[]
}

export function NumberField({
  value,
  onCommit,
  testId,
  title,
  min,
  step,
  integer,
  autoFocus,
  presets,
}: NumberFieldProps): ReactElement {
  // Tied to the field's own test id, so two fields on one bar cannot share a
  // list — an id collision here shows up as the wrong dropdown, silently.
  const listId = presets === undefined ? undefined : `${testId}-presets`
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
    <>
    <input
      type="number"
      className="control control--number"
      data-testid={testId}
      title={title}
      value={typed ?? String(value)}
      min={min}
      step={step}
      list={listId}
      autoFocus={autoFocus}
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
      {listId !== undefined && (
        <datalist id={listId} data-testid={`${testId}-presets`}>
          {presets?.map((preset) => (
            <option key={preset} value={preset} />
          ))}
        </datalist>
      )}
    </>
  )
}
