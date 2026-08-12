import type { ReactElement, ReactNode } from 'react'

import {
  SCENE_FORMAT,
  copyEntity,
  defaultEntity,
  prefabRefOf,
  spriteOf,
  type Entity,
} from '../../runtime/formats/scene-schema'
import { basename } from '../shell/asset-kinds'
import { freeName, namesIn, stemOfName } from '../shell/entity-names'
import { useOpenScene } from '../shell/open-scene'
import { useSceneAssets, type SceneAssets } from '../shell/scene-assets'
import { useResolvedScene, type ResolvedScene } from '../shell/scene-prefabs'
import { useSelection } from '../shell/selection'
import { mintId } from '../store/ids'
import { editDocument } from '../store/open-documents'

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
 * A row shows what its entity *draws*, which for an instance comes from the
 * prefab it points at. Everything it *changes* goes to the document, re-found by
 * id inside the transaction (`editor-ui` U23).
 */
export function HierarchyPanel(): ReactElement {
  const open = useOpenScene()
  const selection = useSelection()
  const assets = useSceneAssets()
  const resolved = useResolvedScene()

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
  const selected = selection.selected.kind === 'entity' ? selection.selected.entity : null

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
   * A copy of an entity, directly behind nothing that was not already there.
   *
   * What has to survive the copy is a fact about the format, so `copyEntity`
   * answers that. Two things are this panel's:
   *
   * It gets a **new id**, because two entities with one id is a scene the format
   * rejects, and the failure would surface at the next save rather than here.
   * And it goes in **directly after the original** rather than at the end of the
   * list, because list order is draw order — appending would quietly bring the
   * copy to the front of the level.
   *
   * It lands exactly on top of the original, which is what every editor of this
   * kind does: the copy is selected, so the outline is on it and one drag moves
   * it off. Any offset would be a number this editor invented.
   */
  const duplicate = (id: string): void => {
    const copyId = mintId()
    change('Duplicate entity', (list) => {
      const at = list.findIndex((entity) => entity.id === id)
      const source = list[at]
      if (source === undefined) return
      list.splice(at + 1, 0, copyEntity(source, copyId, nextCopyName(list, source.name)))
    })
    // Outside the transaction: what is selected afterwards is not part of the
    // edit, or undo would restore a selection as well as a document.
    selection.selectEntity(path, copyId)
  }

  const remove = (id: string): void => {
    change('Delete entity', (list) => {
      const at = list.findIndex((entity) => entity.id === id)
      if (at >= 0) list.splice(at, 1)
    })
    if (selected === id) selection.selectFile(path)
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

  const at = entities.findIndex((entity) => entity.id === selected)

  return (
    <div className="hierarchy" data-testid="hierarchy-panel" data-scene={path}>
      <header className="hierarchy__bar">
        <button type="button" className="control control--action" data-testid="entity-add" onClick={add}>
          Add
        </button>
        <button
          type="button"
          className="control control--action"
          data-testid="entity-duplicate"
          title="A copy, on top of this one and just in front of it"
          disabled={selected === null}
          onClick={() => selected !== null && duplicate(selected)}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="control control--action"
          data-testid="entity-delete"
          disabled={selected === null}
          onClick={() => selected !== null && remove(selected)}
        >
          Delete
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
        <p className="hierarchy__message" data-testid="hierarchy-message">
          This scene is empty. Add an entity to put something in it.
        </p>
      ) : (
        <ol className="hierarchy__list" aria-label={`Entities in ${name}`}>
          {entities.map((entity) => {
            // The file's entity decides what this row *is*; the resolved one
            // decides what it draws. Falling back is the gap of one render
            // before the prefabs it points at have been read.
            const drawn = resolved.entities.find((one) => one.id === entity.id) ?? entity
            return (
              <Row
                key={entity.id}
                entity={drawn}
                fromPrefab={prefabRefOf(entity)?.path ?? null}
                selected={entity.id === selected}
                problem={problemFor(entity, drawn, assets, resolved)}
                onSelect={() => selection.selectEntity(path, entity.id)}
              />
            )
          })}
        </ol>
      )}

      <p className="hierarchy__note">The last one in the list is drawn in front.</p>
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

interface RowProps {
  /** Resolved: the texture shown is the one this row actually draws. */
  entity: Entity
  /** The prefab this is an instance of, or null when it is not one. */
  fromPrefab: string | null
  selected: boolean
  problem: string | null
  onSelect: () => void
}

function Row({ entity, fromPrefab, selected, problem, onSelect }: RowProps): ReactElement {
  const sprite = spriteOf(entity)

  return (
    <li className="entity-row">
      <button
        type="button"
        className="entity-row__button"
        data-entity-id={entity.id}
        data-selected={selected}
        data-entity-problem={problem ?? ''}
        data-entity-prefab={fromPrefab ?? ''}
        onClick={onSelect}
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

/**
 * What a copy is called: the original's name with a number after it.
 *
 * A duplicate that kept the name exactly would give the list two identical rows
 * — legal in the format, and useless to read. Counting up from the original's
 * stem rather than from the list's length keeps "Slime 2, Slime 3" in order
 * however much else is in the scene.
 */
function nextCopyName(entities: readonly Entity[], original: string): string {
  return freeName(namesIn(entities), stemOfName(original))
}

function Empty({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="hierarchy" data-testid="hierarchy-panel">
      <p className="hierarchy__message" data-testid="hierarchy-message">
        {children}
      </p>
    </div>
  )
}
