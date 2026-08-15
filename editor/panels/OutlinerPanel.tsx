import {
  useEffect,
  useRef,
  useState,
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
import { basename } from '../shell/asset-kinds'
import { useEntityPopover, popoverSpot } from '../shell/entity-popover'
import { freeName, namesIn } from '../shell/entity-names'
import { useDeleteEntities } from '../shell/useDeleteEntities'
import { useDuplicateEntity } from '../shell/useDuplicateEntity'
import { useOpenScene } from '../shell/open-scene'
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
  const [dropAt, setDropAt] = useState<number | null>(null)
  // Counted rather than compared against `relatedTarget`: `dragleave` fires
  // when the pointer crosses onto a child row (`editor-ui` U35).
  const dragDepth = useRef(0)

  // The editor's one right-click window, drawn here only while this panel is
  // the one it was opened from (`../shell/entity-popover.tsx`).
  const popovers = useEntityPopover()
  const popover = popovers.anchor?.owner === 'outliner' ? popovers.anchor : null
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

  const move = (id: string, by: number): void => {
    change('Reorder entity', (list) => {
      const at = list.findIndex((entity) => entity.id === id)
      const to = at + by
      if (at < 0 || to < 0 || to >= list.length) return
      const [moved] = list.splice(at, 1)
      if (moved !== undefined) list.splice(to, 0, moved)
    })
  }

  /** The drag's answer: put the row at slot `to` of the list as shown now. */
  const reorderTo = (id: string, to: number): void => {
    change('Reorder entity', (list) => {
      const at = list.findIndex((entity) => entity.id === id)
      if (at < 0) return
      const [moved] = list.splice(at, 1)
      if (moved === undefined) return
      // The slot was counted with the row still in place, so everything past
      // it is one nearer the front once the row is out.
      list.splice(Math.min(to > at ? to - 1 : to, list.length), 0, moved)
    })
  }

  /**
   * Which slot letting go here would fill, or null for "none, or nothing would
   * change". Asked twice — on every `dragover` for the line, and again on the
   * drop for the edit — so the two cannot disagree about where "here" is.
   * A row is divided at its middle: the top half means before it, the bottom
   * half after; below the last row means the end.
   */
  const slotUnder = (event: DragEvent<HTMLElement>): number | null => {
    const id = draggingRow.current
    if (id === null) return null
    const from = entities.findIndex((entity) => entity.id === id)
    if (from < 0) return null
    const row = event.target instanceof HTMLElement ? event.target.closest('[data-row-index]') : null
    const slot =
      row instanceof HTMLElement
        ? Number(row.getAttribute('data-row-index')) +
          (event.clientY < middleOf(row.getBoundingClientRect()) ? 0 : 1)
        : entities.length
    return slot === from || slot === from + 1 ? null : slot
  }

  const dragDone = (): void => {
    draggingRow.current = null
    dragDepth.current = 0
    setDropAt(null)
  }

  const at = entities.findIndex((entity) => entity.id === selected)
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
          data-delete-count={removal.entities.length}
          title={
            removal.entities.length > 1
              ? `Remove all ${removal.entities.length} selected entities. One press of Ctrl-Z brings them all back.`
              : 'Remove the selected entity. Ctrl-Z brings it back. Delete or Backspace does the same.'
          }
          disabled={!removal.canDelete}
          onClick={removal.deleteSelected}
        >
          {removal.entities.length > 1 ? `Delete ${removal.entities.length}` : 'Delete'}
        </button>
        <button
          type="button"
          className="control control--step"
          data-testid="entity-move-up"
          title="Move back — drawn behind the one above it"
          disabled={at <= 0}
          onClick={() => selected !== null && move(selected, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="control control--step"
          data-testid="entity-move-down"
          title="Move forward — drawn in front of the one below it"
          disabled={at < 0 || at >= entities.length - 1}
          onClick={() => selected !== null && move(selected, 1)}
        >
          ↓
        </button>
      </header>

      {entities.length === 0 ? (
        <p className="outliner__message" data-testid="outliner-message">
          This scene is empty. Add an entity to put something in it.
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
            setDropAt(slotUnder(event))
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
            if (id !== null && slot !== null) reorderTo(id, slot)
            dragDone()
          }}
        >
          {entities.map((entity, index) => {
            // The file's entity decides what this row *is*; the resolved one
            // decides what it draws. Falling back is the gap of one render
            // before the prefabs it points at have been read.
            const drawn = resolved.entities.find((one) => one.id === entity.id) ?? entity
            return (
              <Row
                key={entity.id}
                index={index}
                entity={drawn}
                fromPrefab={prefabRefOf(entity)?.path ?? null}
                selected={selectedHere.has(entity.id)}
                primary={entity.id === selected}
                problem={problemFor(entity, drawn, assets, resolved)}
                dropLine={
                  dropAt === index
                    ? 'above'
                    : index === entities.length - 1 && dropAt === entities.length
                      ? 'below'
                      : null
                }
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
        The last one in the list is drawn in front — drag a row to reorder. Shift-click adds to the
        selection, Ctrl-click takes away, right-click opens an entity's little window, Delete or
        Backspace removes what is selected.
      </p>
    </div>
  )
}

/**
 * Why this row cannot be drawn, in a word, or null.
 *
 * The prefab is asked about first: an instance whose prefab is missing has no
 * texture *because* of that, and "missing texture" would send the human looking
 * at the wrong file.
 */
function problemFor(
  entity: Entity,
  drawn: Entity,
  assets: SceneAssets,
  resolved: ResolvedScene,
): string | null {
  const source = prefabRefOf(entity)
  if (source !== null) {
    const problem = resolved.problems[source.path]
    if (problem !== undefined) return problem.kind === 'missing' ? 'missing prefab' : 'prefab problem'
  }

  const sprite = spriteOf(drawn)
  if (sprite === null) return null
  const problem = assets.problems[sprite.texture.path]
  if (problem === undefined) return null
  return problem.kind === 'missing' ? 'missing texture' : 'texture problem'
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

function middleOf(box: DOMRect): number {
  return box.top + box.height / 2
}

interface RowProps {
  /** Where this row sits in the list, which is where it sits in the draw order. */
  index: number
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
  problem: string | null
  /** The edge the carried row would land on, for the line, or null. */
  dropLine: 'above' | 'below' | null
  onSelect: (event: MouseEvent<HTMLElement>) => void
  /** A right-click on the row: the editor's right-click window, on this entity. */
  onContext: (event: MouseEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

function Row({
  index,
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
}: RowProps): ReactElement {
  const sprite = spriteOf(entity)

  return (
    <li className="entity-row" data-row-index={index} data-drop-line={dropLine ?? undefined}>
      <button
        type="button"
        className="entity-row__button"
        data-entity-id={entity.id}
        data-selected={selected}
        data-primary={primary}
        data-entity-problem={problem ?? ''}
        data-entity-prefab={fromPrefab ?? ''}
        draggable
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
          <span className="entity-row__badge" title="This entity cannot be drawn">
            {problem}
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
