import type { ReactElement, ReactNode } from 'react'

/**
 * The four pieces every Inspector body is built from.
 *
 * One copy, because there were four: the Inspector, the entity's body, the
 * prefab's body and the texture settings had each grown their own identical
 * `Section`, `Row`, `Field` and `Note`. Behaviour tests cannot see that — the
 * markup was the same in all of them — so it is exactly the kind of thing a
 * gardening pass exists to find (`editor-kernel` G3).
 *
 * These are presentational and nothing else: no state, no store, no fetch. A
 * component here that started making a decision would be a decision made in four
 * panels at once, which is the opposite of why they were merged.
 *
 * **What deliberately did not move in:** the `Note` in `ViewportPanel` and
 * `TexturePanel`. Those look similar and are not the same thing — they are
 * captions under a canvas, with `bad` and `faint` variants and their own class
 * names. Merging them would be the mistake this file is the fix for, pointed the
 * wrong way.
 */

/** A titled group of fields. */
export function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="inspector__section">
      <h3 className="inspector__section-title">{title}</h3>
      {children}
    </section>
  )
}

/** A labelled row of controls — anything the human can change. */
export function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="inspector__field">
      <span className="inspector__label">{label}</span>
      <span className="control-row">{children}</span>
    </div>
  )
}

/** A labelled value the human reads and cannot change. */
export function Field({
  label,
  value,
  testId,
}: {
  label: string
  value: string
  testId?: string
}): ReactElement {
  return (
    <p className="inspector__field">
      <span className="inspector__label">{label}</span>
      <span className="inspector__value" data-testid={testId}>
        {value}
      </span>
    </p>
  )
}

/** A sentence. Every panel state gets one, which is the rule in `editor-ui` U10. */
export function Note({ children, ...rest }: { children: ReactNode; 'data-testid'?: string }): ReactElement {
  return (
    <p className="inspector__note" {...rest}>
      {children}
    </p>
  )
}
