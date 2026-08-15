import { useEffect, useRef, type ReactElement } from 'react'

import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import type { Point } from '../../runtime'
import { editDocument } from '../store/open-documents'
import { NumberField } from './NumberField'

/**
 * The little window a right-click on an entity opens, next to the entity.
 *
 * It edits the document through the transaction API with the same merge keys
 * the Inspector's fields use, so the two are one field in two places: typing in
 * either is one press of Ctrl-Z, and a value committed in one appears in the
 * other. Position is the whole of it for now; more of the entity's settings
 * will live here later.
 *
 * **Presses inside it are stopped from reaching the picture, and they have to
 * be stopped natively.** The gesture layer listens on the stage with real
 * `addEventListener` listeners, and a native listener on an ancestor runs
 * before React's delegated handlers do — so a React `onPointerDown` calling
 * `stopPropagation` here would fire after the stage had already treated the
 * press as a pick, deselected the entity, and closed this window under the
 * cursor. The listeners below are attached the same way the stage's are, on
 * the element itself, where they run first. (Drags the stage has captured are
 * unaffected: pointer capture retargets events to the stage directly, so a
 * sprite dragged across this window never loses its gesture.)
 *
 * Esc closes it and hands focus back to the picture, so the viewport's own
 * keys work again without another click.
 */

export function EntityPopover({
  scenePath,
  entity,
  at,
  onClose,
}: {
  scenePath: string
  /** The file's entity, which is the one every edit targets (`editor-ui` U23). */
  entity: Entity
  /** Where to sit, in the stage's own pixels, already clamped by the panel. */
  at: Point
  onClose: () => void
}): ReactElement {
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = box.current
    if (element === null) return

    const stop = (event: Event): void => {
      event.stopPropagation()
    }

    element.addEventListener('pointerdown', stop)
    element.addEventListener('pointerup', stop)
    element.addEventListener('pointermove', stop)
    element.addEventListener('mousedown', stop)
    element.addEventListener('wheel', stop)

    return () => {
      element.removeEventListener('pointerdown', stop)
      element.removeEventListener('pointerup', stop)
      element.removeEventListener('pointermove', stop)
      element.removeEventListener('mousedown', stop)
      element.removeEventListener('wheel', stop)
    }
  }, [])

  const change = (field: string, recipe: (target: Entity) => void): void => {
    editDocument(scenePath, { label: 'Position', merge: `${scenePath}#${entity.id}#${field}` }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      // Re-found by id inside the transaction, never closed over: between the
      // click and the keystroke the file may have been changed elsewhere.
      const target = document.entities.find((candidate) => candidate.id === entity.id)
      if (target !== undefined) recipe(target)
    })
  }

  return (
    <div
      ref={box}
      className="entity-popover"
      data-testid="entity-popover"
      data-popover-entity={entity.id}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <header className="entity-popover__bar">
        <span className="entity-popover__name" title={entity.name}>
          {entity.name}
        </span>
        <button
          type="button"
          className="entity-popover__close"
          data-testid="entity-popover-close"
          aria-label="Close"
          title="Close (Esc)"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      <div className="entity-popover__row">
        <span className="entity-popover__label">Position</span>
        <NumberField
          testId="popover-x-control"
          title="Across, in scene units"
          value={entity.transform.x}
          step={1}
          autoFocus
          onCommit={(x) =>
            change('x', (target) => {
              target.transform.x = x
            })
          }
        />
        <NumberField
          testId="popover-y-control"
          title="Up from the bottom, in scene units"
          value={entity.transform.y}
          step={1}
          onCommit={(y) =>
            change('y', (target) => {
              target.transform.y = y
            })
          }
        />
      </div>
    </div>
  )
}
