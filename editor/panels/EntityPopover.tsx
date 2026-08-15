import { useEffect, useRef, type ReactElement } from 'react'

import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import type { Spot } from '../shell/floating'
import { useSceneView } from '../shell/scene-view-context'
import { useDeleteEntities } from '../shell/useDeleteEntities'
import { useDuplicateEntity } from '../shell/useDuplicateEntity'
import { editDocument, sealEdits } from '../store/open-documents'
import { NumberField } from './NumberField'

/**
 * The little window a right-click on an entity opens — next to the sprite in the
 * picture, or next to the row in the Outliner (`../shell/entity-popover.tsx`).
 *
 * **It is the four things a hand reaches for, in the place the hand already is.**
 * Rename, position, and then Frame, Duplicate and Delete. Every one of them
 * existed already — in the Inspector across the window, or on the Outliner's
 * toolbar — and *that is the point*: this window is not new capability, it is
 * the end of crossing the window to use capability you have. Its whole
 * justification is distance, so what goes in it is chosen by how often a hand
 * wants it while the cursor is on a sprite, not by what would fit.
 *
 * **Nothing here is a second implementation.** The fields edit the document
 * through the transaction API with the same merge keys the Inspector's use, so
 * the two are one field in two places: typing in either is one press of Ctrl-Z,
 * and a value committed in one appears in the other. The three buttons call the
 * same hooks the Outliner's buttons and the viewport's keys call — one answer to
 * what a copy is, what a delete is, and what framing is (`editor-ui` U44's
 * argument one level down: one *window* with two doors, over one *action* with
 * several).
 *
 * **Delete acts on the selection, and that is exactly this entity.** Opening the
 * window selects what it is about — both doors do — and the window closes the
 * moment the selection moves off it, so "the selection" and "this entity" cannot
 * come apart while it is on screen. It therefore needs no delete of its own.
 *
 * **Two of the three buttons close the window, and neither closes it here.**
 * Duplicate selects the copy and Delete leaves no entity, so the panels' own
 * ways-out lists put the window away — the rule they already keep. Frame is the
 * one that behaves differently at each door, and correctly: in the picture the
 * window is anchored to a spot on screen, so moving the camera takes its anchor
 * away and it closes; in the Outliner nothing moved, so it stays. A second
 * closing path written here would be this component having an opinion about two
 * panels' anchors.
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
 * Esc closes it and hands focus back to wherever it came from, so the panel's
 * own keys work again without another click.
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
  /** Where to sit, as the CSS pinning it to the panel that opened it. */
  at: Spot
  onClose: () => void
}): ReactElement {
  const box = useRef<HTMLDivElement | null>(null)
  const copy = useDuplicateEntity()
  const removal = useDeleteEntities()
  const view = useSceneView()

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

  const change = (field: string, label: string, recipe: (target: Entity) => void): void => {
    editDocument(scenePath, { label, merge: `${scenePath}#${entity.id}#${field}` }, (document) => {
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
      style={at}
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

      {/* The name is a field here as well as the title above it, and the title
          stays: an entity being renamed is exactly when the human wants to see
          what it was called a moment ago. */}
      <div className="entity-popover__row">
        <span className="entity-popover__label">Name</span>
        <input
          type="text"
          className="control control--text entity-popover__text"
          data-testid="popover-name-control"
          aria-label={`Name for ${entity.name}`}
          value={entity.name}
          // The same seal the Inspector's name field takes, so a rename typed
          // here and a rename typed there are one kind of undo step.
          onBlur={sealEdits}
          onChange={(event) => {
            const name = event.target.value
            change('name', 'Rename entity', (target) => {
              target.name = name
            })
          }}
        />
      </div>

      <div className="entity-popover__row">
        <span className="entity-popover__label">Position</span>
        <NumberField
          testId="popover-x-control"
          title="Across, in scene units"
          value={entity.transform.x}
          step={1}
          autoFocus
          onCommit={(x) =>
            change('x', 'Position', (target) => {
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
            change('y', 'Position', (target) => {
              target.transform.y = y
            })
          }
        />
      </div>

      <div className="entity-popover__actions">
        <button
          type="button"
          className="control control--action"
          data-testid="popover-frame"
          title="Put the camera on this entity — the same thing F does over the picture"
          disabled={view.state !== 'ready'}
          onClick={() => {
            if (view.state === 'ready') view.frameEntity(entity.id)
          }}
        >
          Frame
        </button>
        <button
          type="button"
          className="control control--action"
          data-testid="popover-duplicate"
          title="A copy, on top of this one and just in front of it — the same copy Shift-D makes"
          onClick={() => copy.duplicate(entity.id)}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="control control--action"
          data-testid="popover-delete"
          title="Remove this entity. Ctrl-Z brings it back."
          disabled={!removal.canDelete}
          onClick={removal.deleteSelected}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
