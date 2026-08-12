import type { ReactElement, ReactNode } from 'react'

import { SCENE_FORMAT, defaultEntity, spriteOf, type Entity } from '../../runtime/formats/scene-schema'
import { basename } from '../shell/asset-kinds'
import { useOpenScene } from '../shell/open-scene'
import { useSceneAssets, type SceneAssets } from '../shell/scene-assets'
import { useSelection } from '../shell/selection'
import { editDocument } from '../store/open-documents'
import { mintEntityId } from '../store/ids'

/**
 * What is in the open scene, in the order it is drawn.
 *
 * The list is the draw order: the first row is furthest back and the last is in
 * front, which is why moving a row is the whole of "bring this forward". There
 * is no second field saying so, deliberately — see the note in
 * `runtime/formats/scene-schema.ts`.
 *
 * **Every one of the four actions goes through the transaction API and nothing
 * else** (`editor-kernel` D7). Adding is where a session is most likely to reach
 * past it, because creating something feels different from editing it — it is
 * not. An add is a recipe that pushes onto `entities`, a delete is one that
 * splices, a move is one that swaps two slots, and Ctrl-Z reverses all three
 * without a line of undo code being written here.
 */
export function HierarchyPanel(): ReactElement {
  const open = useOpenScene()
  const selection = useSelection()
  const assets = useSceneAssets()

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
    const id = mintEntityId()
    change('Add entity', (list) => {
      list.push(defaultEntity(id, nextEntityName(list)))
    })
    // Selecting the new entity is a UI decision, not part of the edit — which
    // is why it happens out here, where undo cannot see it (`editor-ui` U8).
    selection.selectEntity(path, id)
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
          {entities.map((entity) => (
            <Row
              key={entity.id}
              entity={entity}
              selected={entity.id === selected}
              problem={problemFor(entity, assets)}
              onSelect={() => selection.selectEntity(path, entity.id)}
            />
          ))}
        </ol>
      )}

      <p className="hierarchy__note">The last one in the list is drawn in front.</p>
    </div>
  )
}

/** Whether this entity's texture is one the scene cannot draw, in a word. */
function problemFor(entity: Entity, assets: SceneAssets): string | null {
  const sprite = spriteOf(entity)
  if (sprite === null) return null
  const problem = assets.problems[sprite.texture.path]
  if (problem === undefined) return null
  return problem.kind === 'missing' ? 'missing texture' : 'texture problem'
}

interface RowProps {
  entity: Entity
  selected: boolean
  problem: string | null
  onSelect: () => void
}

function Row({ entity, selected, problem, onSelect }: RowProps): ReactElement {
  const sprite = spriteOf(entity)

  return (
    <li className="entity-row">
      <button
        type="button"
        className="entity-row__button"
        data-entity-id={entity.id}
        data-selected={selected}
        data-entity-problem={problem ?? ''}
        onClick={onSelect}
      >
        <span className="entity-row__name">{entity.name}</span>
        {sprite !== null && (
          <span className="entity-row__texture" title={sprite.texture.path}>
            {basename(sprite.texture.path)}
          </span>
        )}
        {problem !== null && (
          <span className="entity-row__badge" title="This entity's texture cannot be drawn">
            {problem}
          </span>
        )}
      </button>
    </li>
  )
}

/**
 * A name for a new entity that is not already taken.
 *
 * Names are not identifiers — two entities may share one, and the id is what
 * anything refers to — but handing out three rows all called "Entity" makes a
 * list nobody can read.
 */
function nextEntityName(entities: readonly Entity[]): string {
  const taken = new Set(entities.map((entity) => entity.name))
  for (let n = entities.length + 1; ; n += 1) {
    const name = `Entity ${n}`
    if (!taken.has(name)) return name
  }
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
