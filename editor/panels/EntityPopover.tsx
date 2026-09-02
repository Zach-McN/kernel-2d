import { useEffect, useRef, type ReactElement } from 'react'

import { SCENE_FORMAT, type Entity } from '../../runtime/formats/scene-schema'
import type { Spot } from '../shell/floating'
import { usePlacing } from '../shell/placing'
import { useResolvedScene } from '../shell/scene-prefabs'
import { useSceneView } from '../shell/scene-view-context'
import { snapPoint } from '../shell/snap'
import { useDeleteEntities } from '../shell/useDeleteEntities'
import { useDuplicateEntity } from '../shell/useDuplicateEntity'
import { editDocument, sealEdits } from '../store/open-documents'
import { ComponentFields } from './ComponentFields'
import { NumberField } from './NumberField'

/**
 * The little window a right-click on an entity opens — next to the sprite in the
 * picture, or next to the row in the Outliner (`../shell/entity-popover.tsx`).
 *
 * **It is the things a hand reaches for, in the place the hand already is.**
 * Rename, position, snap that position to the grid, and then Frame, Duplicate
 * and Delete. Nearly every one of them existed already — in the Inspector across
 * the window, or on the Outliner's toolbar — and *that is the point*: this
 * window is mostly not new capability, it is the end of crossing the window to
 * use capability you have. Its whole justification is distance, so what goes in
 * it is chosen by how often a hand wants it while the cursor is on a sprite, not
 * by what would fit.
 *
 * **Nothing here is a second implementation.** The fields edit the document
 * through the transaction API with the same merge keys the Inspector's use, so
 * the two are one field in two places: typing in either is one press of Ctrl-Z,
 * and a value committed in one appears in the other. The verbs call the same
 * hooks the Outliner's buttons and the viewport's keys call — one answer to
 * what a copy is, what a delete is, and what framing is (`editor-ui` U44's
 * argument one level down: one *window* with two doors, over one *action* with
 * several). Snap to grid is the one thing here that is new, and it is the same
 * grid: the interval comes from the viewport bar, and the arithmetic is the one
 * a drag uses (`editor/shell/snap.ts`).
 *
 * **The game's own fields are here too, and they are the Inspector's component
 * rendered a second time.** An enemy's speed is exactly the kind of number a
 * hand wants while the cursor is on the sprite — more often than its rotation —
 * and it would be the same number in the Inspector across the window. So
 * `ComponentFields` is mounted here with the same scene, entity and resolved
 * entity the Inspector gives it: the same merge keys, so a speed typed here and
 * a speed typed there are one undo step; the same Add-and-Remove, so a
 * placement detached from its prefab in this window is detached the same way;
 * the same `addable` rule, so a cloud's window has no enemy section in it. A
 * second, smaller renderer of the same descriptions would be the second
 * implementation this window exists not to have.
 *
 * **Delete acts on the selection, and that is exactly this entity.** Opening the
 * window selects what it is about — both doors do — and the window closes the
 * moment the selection moves off it, so "the selection" and "this entity" cannot
 * come apart while it is on screen. It therefore needs no delete of its own.
 *
 * **Two of the verbs close the window, and neither closes it here.**
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
  // The window's grid is the viewport bar's grid — one interval, however the
  // window was opened. The Outliner's door can reach it because the setting
  // belongs to the window rather than to the panel (`editor/shell/placing.tsx`).
  const { snap } = usePlacing()
  // The entity with its prefab's components filled in, for the described
  // sections to say what is inherited — the same resolution the Inspector reads.
  const resolved = useResolvedScene().entities.find((candidate) => candidate.id === entity.id) ?? entity
  const onGrid = snapPoint(entity.transform, snap)
  const alreadyOnGrid = onGrid.x === entity.transform.x && onGrid.y === entity.transform.y

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

  const edit = (intent: { label: string; merge?: string }, recipe: (target: Entity) => void): void => {
    editDocument(scenePath, intent, (document) => {
      if (document.format !== SCENE_FORMAT) return
      // Re-found by id inside the transaction, never closed over: between the
      // click and the keystroke the file may have been changed elsewhere.
      const target = document.entities.find((candidate) => candidate.id === entity.id)
      if (target !== undefined) recipe(target)
    })
  }

  /**
   * A typed value, merged with the keystrokes either side of it so that filling
   * in a field is one press of Ctrl-Z. A button's edit is *not* one of these:
   * one press is one step already, and a merge key would quietly fold two
   * deliberate presses into one.
   */
  const change = (field: string, label: string, recipe: (target: Entity) => void): void => {
    edit({ label, merge: `${scenePath}#${entity.id}#${field}` }, recipe)
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
        {/* A child's numbers are an offset from its parent, and the label says
            which it is showing rather than letting "Position" quietly mean two
            things (`editor-ui` U44's rule: legible from the worse door). */}
        <span className="entity-popover__label" data-testid="popover-position-label">
          {entity.parent === undefined ? 'Position' : 'Offset'}
        </span>
        <NumberField
          testId="popover-x-control"
          title={entity.parent === undefined ? 'Across, in scene units' : 'Across from its parent, in scene units'}
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
          title={entity.parent === undefined ? 'Up from the bottom, in scene units' : 'Up from its parent, in scene units'}
          value={entity.transform.y}
          step={1}
          onCommit={(y) =>
            change('y', 'Position', (target) => {
              target.transform.y = y
            })
          }
        />
      </div>

      {/* Below Position and above the line, because these are fields: everything
          above the line changes a value on this entity. Compacted by the
          stylesheet to the window's width, but the markup is the Inspector's. */}
      <div className="entity-popover__components" data-testid="popover-components">
        <ComponentFields target={{ kind: 'entity', scenePath, entity, resolved }} />
      </div>

      <div className="entity-popover__actions">
        {/* Above the three verbs and below the fields, because it is both: a
            button that happens when pressed, and a thing that happens to the
            two numbers directly above it. */}
        <button
          type="button"
          className="control control--action"
          data-testid="popover-snap"
          title={snapAdvice(snap.on, snap.step, snap.offset, alreadyOnGrid)}
          // Nothing to do is said rather than done. The store already drops an
          // edit that changes no number, so a press would be safe and silent —
          // and silent is the problem: a button that appears to work and does
          // nothing reads as broken, where a greyed one whose tooltip says
          // "already on the grid" has answered the question that was asked.
          disabled={alreadyOnGrid}
          onClick={() =>
            edit({ label: 'Snap to grid' }, (target) => {
              target.transform.x = onGrid.x
              target.transform.y = onGrid.y
            })
          }
        >
          Snap to grid
        </button>

        <div className="entity-popover__verbs">
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
    </div>
  )
}

/**
 * What the Snap to grid button says it will do, in the grid's own numbers.
 *
 * The numbers are in the sentence because the button is reachable from the
 * Outliner, where the interval field is not on screen at all — "snap to grid"
 * with no grid in sight is a button whose result cannot be predicted. Naming
 * them also makes the disabled state legible: an entity that is already on a
 * grid of 16 from 8 is not an entity nothing works on.
 *
 * **It works whether or not snapping is switched on, and says so when it is
 * off.** The switch governs what a *drag* does; this is somebody asking for a
 * position by name, which is the same reading that makes `Ctrl` mean "the other
 * thing" rather than "off" (`editor/shell/snap.ts`). The sentence carries the
 * warning that goes with it — with the switch off there is no grid drawn, so
 * the entity moves somewhere the picture cannot show.
 */
function snapAdvice(on: boolean, step: number, offset: number, already: boolean): string {
  const grid = `every ${step} from ${offset}`
  const what = already
    ? `Already on the grid — ${grid}.`
    : `Move this entity to the nearest grid position — ${grid}. Ctrl-Z puts it back.`

  return on ? what : `${what} Snapping is off, so that grid is not drawn.`
}
