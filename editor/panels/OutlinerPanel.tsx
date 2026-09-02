import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

import {
  SCENE_FORMAT,
  defaultEntity,
  prefabRefOf,
  spriteOf,
  type Entity,
} from '../../runtime/formats/scene-schema'
import { depthsOf } from '../../runtime/scene/coordinates'
import { parentProblemsIn } from '../../runtime/scene/load-scene'
import { basename } from '../shell/asset-kinds'
import { useEntityPopover, popoverSpot } from '../shell/entity-popover'
import { nameMatches, useOutlinerFilter } from '../shell/outliner-filter'
import { freeName, namesIn } from '../shell/entity-names'
import { useDeleteEntities } from '../shell/useDeleteEntities'
import { useDuplicateEntity } from '../shell/useDuplicateEntity'
import { useOpenScene } from '../shell/open-scene'
import { blockOf, labelOf, moveAmongSiblings, moveBlock, outcomeOf, siblingOf, type Slot } from '../shell/reparent'
import { useSceneAssets, type SceneAssets } from '../shell/scene-assets'
import { useResolvedScene, type ResolvedScene } from '../shell/scene-prefabs'
import { useSelection } from '../shell/selection'
import { mintId } from '../store/ids'
import { editDocument } from '../store/open-documents'
import { EntityPopover } from './EntityPopover'

/**
 * What is in the open scene, in the order it is drawn.
 *
 * The list is the draw order: the first row is furthest back and the last is in
 * front, which is why moving a row is the whole of "bring this forward". There
 * is no second field saying so, deliberately — see the note in
 * `runtime/formats/scene-schema.ts`.
 *
 * **Every one of the five actions goes through the transaction API and nothing
 * else** (`editor-kernel` D7). Adding is where a session is most likely to reach
 * past it, because creating something feels different from editing it — it is
 * not. An add is a recipe that pushes onto `entities`, a duplicate is one that
 * splices a copy in, a delete is one that splices one out, a move is one that
 * swaps two slots — and Ctrl-Z reverses every one of them without a line of undo
 * code being written here.
 *
 * Duplicating is the one that has moved out, to `../shell/useDuplicateEntity.ts`,
 * the day the viewport wanted the same copy from `Shift-D`. Deleting followed it
 * out to `../shell/useDeleteEntities.ts` the day the Delete key arrived, for the
 * same reason. The buttons here are still what they were; there is simply one
 * implementation of what a copy is and one of what a delete is.
 *
 * **A row click reads its modifiers**: plain replaces the selection, Shift adds
 * to it, Ctrl takes away from it. The same three meanings a press in the picture
 * has, deliberately — a modifier that meant one thing in the list and another
 * over the level would be worse than no modifier at all. What is missing is the
 * list idiom, Shift-as-range-from-the-last-click, and that is the trade: one
 * meaning across both surfaces was worth more than the convenience, since the
 * picture has no order to take a range along.
 *
 * **A right-click on a row opens the editor's right-click window on that
 * entity** — the same window a right-click on the sprite opens, in the same
 * state, because it is one window with two doors rather than a second one built
 * here (`../shell/entity-popover.tsx`). The pattern Duplicate and `Shift-D`
 * already keep: a gesture the human learned over the picture has to mean the
 * same thing in the list, or it is two half-features.
 *
 * Only Delete acts on the whole selection. Duplicate and the reorder arrows act
 * on the primary entity — the last one clicked — because there is no plural
 * version of either yet, and a button that quietly did one of six things would
 * be the dishonest half of a feature.
 *
 * A row shows what its entity *draws*, which for an instance comes from the
 * prefab it points at. Everything it *changes* goes to the document, re-found by
 * id inside the transaction (`editor-ui` U23).
 *
 * Reordering has two doors — the arrows, and dragging a row — and one
 * implementation behind both, the same shape as Duplicate and `Shift-D`. The
 * drag is the browser's own, marked with a type of its own so an asset being
 * carried out of the Assets panel is not mistaken for a row (`editor-ui` U35);
 * the row's id rides in a ref rather than in state, because what is being
 * dragged never needs to be *drawn* — only where it would land does.
 *
 * **A row let go on the middle of another becomes its child**, and the list
 * shows it indented under it; let go between two rows it becomes a sibling of
 * the row below the line, attached to whatever that row is attached to. The
 * rows stay in list order — an indented row is drawn where its row sits, in
 * front of its parent because that is where a child's row is allowed to be —
 * and every one of those moves is `../shell/reparent.ts`, where the arithmetic
 * lives on its own and is tested without a browser.
 */
export function OutlinerPanel(): ReactElement {
  const open = useOpenScene()
  const selection = useSelection()
  const assets = useSceneAssets()
  const resolved = useResolvedScene()
  // The same copy the viewport's Shift-D makes, so the button and the key can
  // never disagree about what a duplicate is (`editor/shell/useDuplicateEntity.ts`).
  const { duplicate } = useDuplicateEntity()
  // And the same delete the viewport's Delete key does, for the same reason.
  const removal = useDeleteEntities()

  // The row being dragged. A ref, not state: setting state inside `dragstart`
  // re-renders the row mid-gesture, which is the kind of DOM change Chromium
  // answers by cancelling the drag it was about to start.
  const draggingRow = useRef<string | null>(null)
  // Where the carried row would land, for the line between rows — or null when
  // there is no drag, or when letting go here would change nothing.
  const [dropAt, setDropAt] = useState<Slot | null>(null)
  // Counted rather than compared against `relatedTarget`: `dragleave` fires
  // when the pointer crosses onto a child row (`editor-ui` U35).
  const dragDepth = useRef(0)

  // The editor's one right-click window, drawn here only while this panel is
  // the one it was opened from (`../shell/entity-popover.tsx`).
  const popovers = useEntityPopover()
  const popover = popovers.anchor?.owner === 'outliner' ? popovers.anchor : null
  // The filter box: which rows are on screen. Narrows what is shown and nothing
  // else; a row that is hidden is still in the level, still selected if it was,
  // still where it was in the draw order (`../shell/outliner-filter.tsx`).
  const { filter, setFilter } = useOutlinerFilter()
  const filtering = filter.trim() !== ''
  // The panel it is measured against, and the list it hangs over — the second
  // so a closed window can hand the keys back to the row it was about.
  const panel = useRef<HTMLDivElement | null>(null)
  const list = useRef<HTMLOListElement | null>(null)

  /*
   * What takes this window's situation away, in the two facts a hook can see
   * before the states below are unpacked: the level it is about is no longer
   * the open one, or the selection has moved off the entity it names. The
   * third — the entity itself going — is answered at the bottom, where the
   * list is in hand and the window is only drawn if its entity is in it.
   *
   * The list *scrolling* is the fourth and it is handled on the event, because
   * the window is anchored to a spot in this panel rather than to the row: it
   * is the same fact as the viewport's camera moving, one panel over.
   */
  const primary = removal.entities.at(-1) ?? null
  const scenePath = open.state === 'open' ? open.path : null
  useEffect(() => {
    if (popover === null) return
    if (popover.scene !== scenePath || popover.entity !== primary) popovers.close()
  }, [popover, popovers, primary, scenePath])

  if (open.state === 'none') {
    return <Empty>No scene is open. Click a scene in the Assets panel to see what is in it.</Empty>
  }

  const name = basename(open.path)

  if (open.state === 'loading') return <Empty>Opening {name}…</Empty>

  if (open.state === 'gone') {
    return (
      <Empty>
        <strong>{name}</strong> is no longer in the project folder.
      </Empty>
    )
  }

  if (open.state === 'unavailable') {
    return <Empty>Could not ask the editor service about {name}. Is the editor command still running?</Empty>
  }

  if (open.state === 'unreadable') {
    return (
      <Empty>
        <strong>{name}</strong> {open.problem}
      </Empty>
    )
  }

  const path = open.path
  const entities = open.scene.entities
  // Two questions with two answers: which rows are highlighted, and which one
  // the singular buttons act on. Both come off the same list — the one already
  // narrowed to *this* level — so a selection left over from a level that has
  // since been closed cannot highlight a row here or arm a button.
  const selectedHere = new Set(removal.entities)
  const selected = removal.entities.at(-1) ?? null

  /**
   * One transaction per action. The recipe re-finds the entity by id rather
   * than closing over an index, because between the click and the recipe the
   * scene may have been changed by a text editor — and an index into a list
   * that has moved on is how the wrong thing gets deleted.
   */
  const change = (label: string, recipe: (entities: Entity[]) => void): void => {
    editDocument(path, { label }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      recipe(document.entities)
    })
  }

  const add = (): void => {
    const id = mintId()
    change('Add entity', (list) => {
      list.push(defaultEntity(id, nextEntityName(list)))
    })
    // Selecting the new entity is a UI decision, not part of the edit — which
    // is why it happens out here, where undo cannot see it (`editor-ui` U8).
    selection.selectEntity(path, id)
  }

  /**
   * What a press on a row means, decided by the modifiers it arrived with.
   *
   * Shift-clicking anything inside a list makes the browser drag a text
   * selection across it, which leaves the panel looking broken while a
   * perfectly good selection is being built — so the press says no to that
   * before it does anything else.
   */
  const clickRow = (id: string, event: MouseEvent<HTMLElement>): void => {
    if (event.shiftKey) {
      window.getSelection()?.removeAllRanges()
      selection.addToSelection(path, id)
      return
    }
    if (event.ctrlKey || event.metaKey) {
      selection.removeFromSelection(id)
      return
    }
    selection.selectEntity(path, id)
  }

  /**
   * A right-click on a row, which opens the editor's right-click window on that
   * entity — the same window, in the same state, that a right-click on the
   * sprite opens (`../shell/entity-popover.tsx`).
   *
   * It selects as well as asks, exactly as the viewport's does, so the row, the
   * Inspector and the window are all describing one entity. And it says no to
   * the browser's own menu: the right button means this in the picture already,
   * and a list where it meant "reload / save as" instead would be the surface
   * the gesture stopped working on.
   */
  const openPopover = (id: string, event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    selection.selectEntity(path, id)
    const box = panel.current?.getBoundingClientRect()
    popovers.show({
      owner: 'outliner',
      scene: path,
      entity: id,
      at: popoverSpot(box, {
        x: event.clientX - (box?.left ?? 0),
        y: event.clientY - (box?.top ?? 0),
      }),
    })
  }

  /**
   * Closed, with the keys handed back to the row it was about — so `Esc` leaves
   * the list usable without another click. The viewport hands them back to the
   * picture for exactly the same reason.
   */
  const closePopover = (id: string): void => {
    popovers.close()
    list.current?.querySelector<HTMLElement>(`[data-entity-id="${CSS.escape(id)}"]`)?.focus()
  }

  /** An arrow: the row's block past its sibling's, never across a parent. */
  const move = (id: string, by: -1 | 1): void => {
    change('Reorder entity', (list) => {
      moveAmongSiblings(list, id, by)
    })
  }

  /**
   * The drag's answer: the row's block to this slot. Judged on the list as
   * shown, so the label says what the drop is about to do — attach, detach or
   * reorder — and the recipe does that same thing to the document.
   */
  const dropOn = (id: string, slot: Slot): void => {
    const outcome = outcomeOf(entities, id, slot)
    if (outcome === null) return
    change(labelOf(outcome), (list) => {
      moveBlock(list, id, slot)
    })
  }

  /**
   * Which slot letting go here would fill, or null for "none, or nothing would
   * change". Asked twice — on every `dragover` for the line, and again on the
   * drop for the edit — so the two cannot disagree about where "here" is.
   *
   * A row is divided in **thirds**: the top means before it, the bottom after
   * it (and its children), and the middle means *onto* it — attached, as its
   * last child. Thirds rather than quarters so that a pointer a quarter of the
   * way down a row is well inside a zone rather than on the line between two
   * (`editor-ui` UG11). Below the last row means the end of the list.
   */
  const slotUnder = (event: DragEvent<HTMLElement>): Slot | null => {
    const id = draggingRow.current
    if (id === null) return null
    const row = event.target instanceof HTMLElement ? event.target.closest('[data-row-index]') : null
    let slot: Slot
    if (row instanceof HTMLElement) {
      const target = entities[Number(row.getAttribute('data-row-index'))]
      if (target === undefined) return null
      const box = row.getBoundingClientRect()
      const third = box.height / 3
      slot =
        event.clientY < box.top + third
          ? { kind: 'before', id: target.id }
          : event.clientY >= box.bottom - third
            ? { kind: 'after', id: target.id }
            : { kind: 'into', id: target.id }
    } else {
      slot = { kind: 'end' }
    }
    return outcomeOf(entities, id, slot) === null ? null : slot
  }

  /** The line moves only when the slot does, or every pixel of a drag would redraw the list. */
  const showSlot = (slot: Slot | null): void => {
    setDropAt((shown) => (sameSlot(shown, slot) ? shown : slot))
  }

  const dragDone = (): void => {
    draggingRow.current = null
    dragDepth.current = 0
    setDropAt(null)
  }

  // How far in each row is drawn, and which row wears the drop mark — both
  // answered once per render rather than once per row.
  const depths = depthsOf(entities)
  const dropMark = markOf(entities, dropAt)
  // Entities attached to something that cannot be followed, by id, so the row
  // can say so the way it says "missing texture" (`runtime/scene/load-scene.ts`).
  const parentProblems = new Map(parentProblemsIn(entities).map((problem) => [problem.id, problem.kind]))
  const shownCount = filtering ? entities.filter((entity) => nameMatches(entity.name, filter)).length : entities.length
  // The file's entity, never the resolved one: everything the window changes
  // goes to the document (`editor-ui` U23). Null is also how the window closes
  // when its entity is deleted from under it — there is nothing to draw.
  const popoverEntity =
    popover === null ? null : (entities.find((entity) => entity.id === popover.entity) ?? null)

  return (
    <div
      className="outliner"
      data-testid="outliner-panel"
      data-scene={path}
      data-popover-entity={popoverEntity?.id ?? ''}
      data-filter={filter.trim()}
      ref={panel}
    >
      <header className="outliner__bar">
        <button type="button" className="control control--action" data-testid="entity-add" onClick={add}>
          Add
        </button>
        <button
          type="button"
          className="control control--action"
          data-testid="entity-duplicate"
          title="A copy, on top of this one and just in front of it. Shift-D does the same from the picture."
          disabled={selected === null}
          onClick={() => selected !== null && duplicate(selected)}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="control control--action"
          data-testid="entity-delete"
          data-delete-count={removal.count}
          title={
            removal.count > 1
              ? `Remove all ${removal.count} entities — the selected ones and everything attached to them. One press of Ctrl-Z brings them all back.`
              : 'Remove the selected entity. Ctrl-Z brings it back. Delete or Backspace does the same.'
          }
          disabled={!removal.canDelete}
          onClick={removal.deleteSelected}
        >
          {removal.count > 1 ? `Delete ${removal.count}` : 'Delete'}
        </button>
        <button
          type="button"
          className="control control--step"
          data-testid="entity-move-up"
          title="Move back — drawn behind the one above it. A child moves among its parent's children."
          disabled={selected === null || siblingOf(entities, selected, -1) === null}
          onClick={() => selected !== null && move(selected, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="control control--step"
          data-testid="entity-move-down"
          title="Move forward — drawn in front of the one below it. A child moves among its parent's children."
          disabled={selected === null || siblingOf(entities, selected, 1) === null}
          onClick={() => selected !== null && move(selected, 1)}
        >
          ↓
        </button>
      </header>

      {/* Its own row under the buttons rather than a sixth thing on the bar: the
          bar is full at the panel's narrowest, and a box that reads on every
          keystroke wants a line of its own. Fixed height, so typing never moves
          the list under a press. */}
      <div className="outliner__filter">
        <input
          type="search"
          className="control control--text outliner__filter-box"
          data-testid="entity-filter"
          aria-label="Show only entities whose name contains this"
          title="Show only the rows whose name contains this. Esc clears. Rows cannot be dragged while a filter is on."
          placeholder="Filter by name"
          autoComplete="off"
          spellCheck={false}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            if (filter !== '') setFilter('')
            else event.currentTarget.blur()
          }}
        />
        {filtering && (
          <span className="outliner__filter-count" data-testid="entity-filter-count">
            {shownCount} of {entities.length}
          </span>
        )}
      </div>

      {entities.length === 0 ? (
        <p className="outliner__message" data-testid="outliner-message">
          This scene is empty. Add an entity to put something in it.
        </p>
      ) : filtering && shownCount === 0 ? (
        <p className="outliner__message" data-testid="outliner-filter-empty">
          Nothing here is called “{filter.trim()}”.
        </p>
      ) : (
        <ol
          className="outliner__list"
          aria-label={`Entities in ${name}`}
          ref={list}
          // A right-click that missed every row asks about nothing, which
          // closes whatever was open — the same answer a right-click on empty
          // space in the picture gives.
          //
          // The press is *asked where it landed* rather than being stopped by
          // the row it landed on, which matters more than it looks: React's
          // `stopPropagation` stops the native event too, so a row that
          // swallowed its own press would also hide it from anything listening
          // at the window — including the test that checks the browser's menu
          // was told no.
          onContextMenu={(event) => {
            event.preventDefault()
            if (rowUnder(event.target) === null) popovers.close()
          }}
          // The window hangs off a spot in the panel rather than off the row,
          // so a list that scrolls takes its anchor away — the viewport's
          // camera, one panel over.
          onScroll={() => popovers.close()}
          onDragEnter={(event) => {
            if (!isRowDrag(event)) return
            event.preventDefault()
            dragDepth.current += 1
          }}
          // Every move, not just the first: a drag that is not cancelled here
          // is a drag the browser will not let go of (`editor-ui` U35).
          onDragOver={(event) => {
            if (!isRowDrag(event)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            showSlot(slotUnder(event))
          }}
          onDragLeave={() => {
            dragDepth.current -= 1
            if (dragDepth.current <= 0) {
              dragDepth.current = 0
              setDropAt(null)
            }
          }}
          onDrop={(event) => {
            if (!isRowDrag(event)) return
            event.preventDefault()
            const id = draggingRow.current
            const slot = slotUnder(event)
            if (id !== null && slot !== null) dropOn(id, slot)
            dragDone()
          }}
        >
          {entities.map((entity, index) => {
            // Hidden by the filter: not drawn at all, and the index it keeps is
            // its place in the whole list, so nothing that reads a row's index
            // has to know about the filter.
            if (filtering && !nameMatches(entity.name, filter)) return null
            // The file's entity decides what this row *is*; the resolved one
            // decides what it draws. Falling back is the gap of one render
            // before the prefabs it points at have been read.
            const drawn = resolved.entities.find((one) => one.id === entity.id) ?? entity
            return (
              <Row
                key={entity.id}
                index={index}
                depth={depths.get(entity.id) ?? 0}
                // A drag reorders by the slot under the pointer, and a slot
                // between two shown rows may hold any number of hidden ones —
                // so a row is not picked up at all while a filter is on.
                draggable={!filtering}
                entity={drawn}
                fromPrefab={prefabRefOf(entity)?.path ?? null}
                selected={selectedHere.has(entity.id)}
                primary={entity.id === selected}
                problem={problemFor(entity, drawn, assets, resolved, parentProblems.get(entity.id))}
                dropLine={dropMark?.id === entity.id ? dropMark.line : null}
                onSelect={(event) => clickRow(entity.id, event)}
                onContext={(event) => openPopover(entity.id, event)}
                onDragStart={(event) => {
                  // The marker is all a `dragover` can see; the id itself rides
                  // in the ref, readable while the drag is happening (U35).
                  event.dataTransfer.setData(ROW_DRAG_TYPE, entity.id)
                  event.dataTransfer.effectAllowed = 'move'
                  draggingRow.current = entity.id
                }}
                // Fires whether it was dropped or abandoned, which is exactly
                // the question: the drag is over either way.
                onDragEnd={dragDone}
              />
            )
          })}
        </ol>
      )}

      {popover !== null && popoverEntity !== null && (
        <EntityPopover
          scenePath={path}
          entity={popoverEntity}
          at={popover.at}
          onClose={() => closePopover(popover.entity)}
        />
      )}

      {/* Where the modifiers are learned. A selection gesture nobody is told
          about is a selection gesture nobody uses, and there is nowhere else on
          screen that could mention Shift, Ctrl or the delete keys. */}
      <p className="outliner__note">
        The last one in the list is drawn in front — drag a row to reorder, or drop it onto another
        row to attach it to that one. Shift-click adds to the selection, Ctrl-click takes away,
        right-click opens an entity's little window, Delete or Backspace removes what is selected.
      </p>
    </div>
  )
}

/** What a row's badge says, and what it means when hovered. */
interface RowProblem {
  word: string
  title: string
}

/**
 * Why this row cannot be drawn — or cannot be placed where its parent is — in
 * a word, or null.
 *
 * The prefab is asked about first: an instance whose prefab is missing has no
 * texture *because* of that, and "missing texture" would send the human looking
 * at the wrong file. A parent that cannot be followed comes last, because the
 * entity still draws — by its own numbers, as if attached to nothing.
 */
function problemFor(
  entity: Entity,
  drawn: Entity,
  assets: SceneAssets,
  resolved: ResolvedScene,
  parentProblem: 'parent-missing' | 'parent-cycle' | undefined,
): RowProblem | null {
  const undrawable = 'This entity cannot be drawn'
  const source = prefabRefOf(entity)
  if (source !== null) {
    const problem = resolved.problems[source.path]
    if (problem !== undefined) {
      return { word: problem.kind === 'missing' ? 'missing prefab' : 'prefab problem', title: undrawable }
    }
  }

  const sprite = spriteOf(drawn)
  const problem = sprite === null ? undefined : assets.problems[sprite.texture.path]
  if (problem !== undefined) {
    return { word: problem.kind === 'missing' ? 'missing texture' : 'texture problem', title: undrawable }
  }

  if (parentProblem === 'parent-missing') {
    return {
      word: 'missing parent',
      title: 'This entity is attached to an id that is not in this level. It is placed as if attached to nothing.',
    }
  }
  if (parentProblem === 'parent-cycle') {
    return {
      word: 'attached in a loop',
      title: 'Following what this entity is attached to leads back to itself. It is placed as if attached to nothing.',
    }
  }
  return null
}

/**
 * Which row wears the drop mark, and on which edge: above the row a block
 * would go before, below the *last row of the block* it would go after, and on
 * the row itself when it would become that row's child.
 */
function markOf(
  entities: readonly Entity[],
  slot: Slot | null,
): { id: string; line: 'above' | 'below' | 'into' } | null {
  if (slot === null) return null
  if (slot.kind === 'end') {
    const last = entities[entities.length - 1]
    return last === undefined ? null : { id: last.id, line: 'below' }
  }
  if (slot.kind === 'before') return { id: slot.id, line: 'above' }
  if (slot.kind === 'into') return { id: slot.id, line: 'into' }
  const rows = blockOf(entities, slot.id)
  const last = rows[rows.length - 1]
  return last === undefined ? null : { id: last.id, line: 'below' }
}

function sameSlot(a: Slot | null, b: Slot | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  return a.kind === 'end' || b.kind === 'end' || a.id === b.id
}

/**
 * The type on a row's drag, saying it is an Outliner row.
 *
 * A marker and nothing more, distinct from the Assets panel's
 * (`../shell/useAssetDrag.ts`) so neither surface mistakes the other's drag for
 * its own: a row let go over the picture places nothing, and a file let go over
 * this list changes no order.
 */
const ROW_DRAG_TYPE = 'application/x-kernel-2d-entity-row'

/** The row an event landed on, or null for the list's own background. */
function rowUnder(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  const row = target.closest('[data-entity-id]')
  return row instanceof HTMLElement ? row : null
}

/** Ours rather than an asset, a text selection, or a file from Explorer. */
function isRowDrag(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes(ROW_DRAG_TYPE)
}

interface RowProps {
  /** Where this row sits in the list, which is where it sits in the draw order. */
  index: number
  /** How many entities it is attached under: 0 at the top level. Drawn as an indent. */
  depth: number
  /** Resolved: the texture shown is the one this row actually draws. */
  entity: Entity
  /** The prefab this is an instance of, or null when it is not one. */
  fromPrefab: string | null
  selected: boolean
  /**
   * The last row clicked, and so the one Duplicate and the reorder arrows act
   * on. Always one of the selected rows, and marked apart from them so a
   * selection of six says which of the six the singular buttons mean.
   */
  primary: boolean
  problem: RowProblem | null
  /** The edge the carried row would land on, for the line — or `into`, for a row it would be attached to — or null. */
  dropLine: 'above' | 'below' | 'into' | null
  onSelect: (event: MouseEvent<HTMLElement>) => void
  /** A right-click on the row: the editor's right-click window, on this entity. */
  onContext: (event: MouseEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  /** Whether this row can be picked up to reorder it. Off while a filter hides rows. */
  draggable: boolean
}

function Row({
  index,
  depth,
  entity,
  fromPrefab,
  selected,
  primary,
  problem,
  dropLine,
  onSelect,
  onContext,
  onDragStart,
  onDragEnd,
  draggable,
}: RowProps): ReactElement {
  const sprite = spriteOf(entity)

  return (
    <li
      className="entity-row"
      data-row-index={index}
      data-depth={depth}
      data-drop-line={dropLine ?? undefined}
      style={{ '--depth': depth } as CSSProperties}
    >
      <button
        type="button"
        className="entity-row__button"
        data-entity-id={entity.id}
        data-selected={selected}
        data-primary={primary}
        data-entity-problem={problem?.word ?? ''}
        data-entity-prefab={fromPrefab ?? ''}
        draggable={draggable}
        onClick={onSelect}
        onContextMenu={onContext}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <span className="entity-row__name">{entity.name}</span>
        {fromPrefab !== null && (
          <span
            className="entity-row__badge entity-row__badge--prefab"
            title={`An instance of ${fromPrefab}`}
          >
            prefab
          </span>
        )}
        {sprite !== null && (
          <span className="entity-row__texture" title={sprite.texture.path}>
            {basename(sprite.texture.path)}
          </span>
        )}
        {problem !== null && (
          <span className="entity-row__badge" title={problem.title}>
            {problem.word}
          </span>
        )}
      </button>
    </li>
  )
}

/** A name for a new entity, counting on from the length of the list. */
function nextEntityName(entities: readonly Entity[]): string {
  return freeName(namesIn(entities), 'Entity', { from: entities.length + 1 })
}

function Empty({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="outliner" data-testid="outliner-panel">
      <p className="outliner__message" data-testid="outliner-message">
        {children}
      </p>
    </div>
  )
}
