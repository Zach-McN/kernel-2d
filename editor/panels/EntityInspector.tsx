import type { ReactElement, ReactNode } from 'react'

import {
  SCENE_FORMAT,
  prefabRefOf,
  spriteOf,
  unknownComponentTypesOf,
  type AssetRef,
  type Entity,
  type Scene,
  type SpriteComponent,
} from '../../runtime/formats/scene-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { describeProblem, type SceneAssets } from '../shell/scene-assets'
import { describePrefabProblem, instancesOf, useResolvedScene, type PrefabProblem } from '../shell/scene-prefabs'
import { useSelection } from '../shell/selection'
import { usePlacePrefab } from '../shell/usePlacePrefab'
import { editDocument, sealEdits } from '../store/open-documents'
import { NumberField } from './NumberField'
import { TexturePicker } from './TexturePicker'

/**
 * One entity's properties, ready to tune.
 *
 * Every control goes through the transaction API and nothing else, so undo
 * covers all of them without any of them knowing undo exists (`editor-kernel`
 * D7). The `merge` key is what makes a run of keystrokes in one field a single
 * press of Ctrl-Z; leaving the field seals the run.
 *
 * The merge key carries the entity's id as well as the field's name, so typing
 * into one entity's X and then another's is two steps rather than one — the
 * same rule as two files, one level down.
 */

interface EntityInspectorProps {
  scenePath: string
  scene: Scene
  /** The entity as the file has it. Everything editable is edited on this one. */
  entity: Entity
  /**
   * The same entity with its prefab's components filled in — what it actually
   * draws. Never written back; see `editor/shell/scene-prefabs.tsx`.
   */
  resolved: Entity
  tree: ProjectTree | null
  assets: SceneAssets
  /** Why this entity's prefab could not be used, if it could not. */
  prefabProblem: PrefabProblem | undefined
}

export function EntityInspector({
  scenePath,
  scene,
  entity,
  resolved,
  tree,
  assets,
  prefabProblem,
}: EntityInspectorProps): ReactElement {
  const resolvedScene = useResolvedScene()

  const change = (field: string, label: string, recipe: (entity: Entity) => void): void => {
    editDocument(scenePath, { label, merge: `${scenePath}#${entity.id}#${field}` }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      const target = document.entities.find((candidate) => candidate.id === entity.id)
      if (target !== undefined) recipe(target)
    })
  }

  // What it carries itself, and what it actually draws. For an ordinary entity
  // these are the same thing; for an instance the second one comes from the
  // prefab, and telling them apart is what lets this panel say where a picture
  // is decided.
  const own = spriteOf(entity)
  const drawn = spriteOf(resolved)
  const source = prefabRefOf(entity)
  const unknown = unknownComponentTypesOf(entity)
  const problem = drawn === null ? undefined : assets.problems[drawn.texture.path]

  return (
    <>
      <Section title="Entity">
        <Row label="Name">
          <input
            type="text"
            className="control control--text"
            data-testid="entity-name-control"
            value={entity.name}
            onBlur={sealEdits}
            onChange={(event) => {
              const name = event.target.value
              change('name', 'Rename entity', (target) => {
                target.name = name
              })
            }}
          />
        </Row>
        <Field label="ID" value={entity.id} testId="entity-id" />
        <Field
          label="Drawn"
          value={drawOrderOf(scene, entity)}
          testId="entity-draw-order"
        />
      </Section>

      <Section title="Transform">
        <Row label="Position">
          <NumberField
            testId="entity-x-control"
            title="Across, in scene units"
            value={entity.transform.x}
            step={1}
            onCommit={(x) =>
              change('x', 'Position', (target) => {
                target.transform.x = x
              })
            }
          />
          <NumberField
            testId="entity-y-control"
            title="Up from the bottom, in scene units"
            value={entity.transform.y}
            step={1}
            onCommit={(y) =>
              change('y', 'Position', (target) => {
                target.transform.y = y
              })
            }
          />
        </Row>

        <Row label="Rotation">
          <NumberField
            testId="entity-rotation-control"
            title="Degrees, counter-clockwise"
            value={entity.transform.rotation}
            step={15}
            onCommit={(rotation) =>
              change('rotation', 'Rotation', (target) => {
                target.transform.rotation = rotation
              })
            }
          />
        </Row>

        <Row label="Scale">
          <NumberField
            testId="entity-scale-x-control"
            title="Across"
            value={entity.transform.scaleX}
            step={0.5}
            onCommit={(scaleX) =>
              change('scaleX', 'Scale', (target) => {
                target.transform.scaleX = scaleX
              })
            }
          />
          <NumberField
            testId="entity-scale-y-control"
            title="Down"
            value={entity.transform.scaleY}
            step={0.5}
            onCommit={(scaleY) =>
              change('scaleY', 'Scale', (target) => {
                target.transform.scaleY = scaleY
              })
            }
          />
        </Row>

        <Note>y counts upward from the bottom-left corner of the viewport.</Note>
      </Section>

      {source === null ? (
        <Section title="Sprite">
          <TexturePicker
            value={own?.texture ?? null}
            tree={tree}
            testId="entity-texture-control"
            onPick={(reference) => setTexture(scenePath, entity.id, reference)}
          />
          {problem !== undefined && (
            <p className="inspector__note inspector__note--bad" data-testid="entity-texture-problem">
              {describeProblem(problem)}
            </p>
          )}
          {own !== null && <Field label="Reference" value={own.texture.id} testId="entity-texture-id" />}
          <Note>
            Where this sprite sits is decided by the pivot in the texture&apos;s own import settings, not
            here.
          </Note>
        </Section>
      ) : (
        <FromPrefab
          source={source}
          drawn={drawn}
          placed={instancesOf(resolvedScene.entities, source.path)}
          overridden={own !== null}
          problem={prefabProblem}
          textureProblem={problem === undefined ? null : describeProblem(problem)}
        />
      )}

      {unknown.length > 0 && (
        <Section title="Other components">
          <Note data-testid="entity-unknown-components">
            This entity also carries {unknown.join(', ')}, which this editor has no controls for. It is kept
            exactly as it is in the file.
          </Note>
        </Section>
      )}
    </>
  )
}

/**
 * Writing one entity's sprite reference, or removing it.
 *
 * One transaction, because the id and the path are one reference and half of one
 * is not worth writing. Re-found by id inside the recipe rather than closed over,
 * the same as every other write in this editor.
 */
function setTexture(scenePath: string, entityId: string, reference: AssetRef | null): void {
  editDocument(scenePath, { label: reference === null ? 'Remove sprite' : 'Set texture' }, (document) => {
    if (document.format !== SCENE_FORMAT) return
    const target = document.entities.find((candidate) => candidate.id === entityId)
    if (target === undefined) return

    if (reference === null) delete target.components['sprite']
    else target.components['sprite'] = { texture: reference }
  })
}

/**
 * Where an instance's picture comes from.
 *
 * No texture control, on purpose. This entity draws what the prefab says, and a
 * picker here would either change every instance — which is the prefab's own
 * panel's job, where it is obvious that is what is happening — or quietly cut
 * this one loose from the file it was placed from. Instead it says where the
 * decision lives and offers one press to go there.
 */
function FromPrefab({
  source,
  drawn,
  placed,
  overridden,
  problem,
  textureProblem,
}: {
  source: AssetRef
  drawn: SpriteComponent | null
  /** How many instances of this prefab the open level has. */
  placed: number
  overridden: boolean
  problem: PrefabProblem | undefined
  textureProblem: string | null
}): ReactElement {
  const selection = useSelection()
  const placing = usePlacePrefab(source.path)

  return (
    <Section title="From prefab">
      <div className="inspector__field">
        <span className="inspector__label">Prefab</span>
        <span className="control-row">
          <button
            type="button"
            className="control control--action"
            data-testid="entity-open-prefab"
            title={source.path}
            onClick={() => selection.selectFile(source.path)}
          >
            {basename(source.path)}
          </button>
          {/* The same gesture as the prefab's own Place, offered from what it
              just placed. The Inspector holds one thing at a time, so placing
              moves it here — without this, "place it fifty times" would be fifty
              round trips back to the Assets panel. */}
          <button
            type="button"
            className="control control--action"
            data-testid="entity-place-another"
            disabled={!placing.canPlace}
            onClick={placing.place}
          >
            Place another
          </button>
        </span>
      </div>

      <Field
        label="Placed"
        value={`${placed} ${placed === 1 ? 'time' : 'times'} in this level`}
        testId="entity-prefab-count"
      />

      {problem !== undefined && (
        <p className="inspector__note inspector__note--bad" data-testid="entity-prefab-problem">
          {describePrefabProblem(problem)}
        </p>
      )}

      {drawn !== null && <Field label="Texture" value={drawn.texture.path} testId="entity-prefab-texture" />}

      {textureProblem !== null && (
        <p className="inspector__note inspector__note--bad" data-testid="entity-texture-problem">
          {textureProblem}
        </p>
      )}

      {overridden && (
        <Note data-testid="entity-prefab-override">
          This one carries a sprite of its own, written into the level rather than inherited, so it ignores
          the prefab&apos;s. Remove it from the file to follow the prefab again.
        </Note>
      )}

      <Note>
        Its picture is decided in the prefab, for every instance at once. Where it stands, how big it is and
        how far it is turned are this one&apos;s alone.
      </Note>
    </Section>
  )
}

/** Where this entity sits in the draw order, said in words rather than as an index. */
function drawOrderOf(scene: Scene, entity: Entity): string {
  const at = scene.entities.findIndex((candidate) => candidate.id === entity.id)
  const total = scene.entities.length
  if (at < 0) return 'not in this scene'
  if (total === 1) return 'the only entity'
  if (at === 0) return 'furthest back'
  if (at === total - 1) return 'in front of everything'
  return `${at + 1} of ${total}, counting from the back`
}

// --- small pieces ----------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="inspector__section">
      <h3 className="inspector__section-title">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="inspector__field">
      <span className="inspector__label">{label}</span>
      <span className="control-row">{children}</span>
    </div>
  )
}

function Field({ label, value, testId }: { label: string; value: string; testId?: string }): ReactElement {
  return (
    <p className="inspector__field">
      <span className="inspector__label">{label}</span>
      <span className="inspector__value" data-testid={testId}>
        {value}
      </span>
    </p>
  )
}

function Note({ children, ...rest }: { children: ReactNode; 'data-testid'?: string }): ReactElement {
  return (
    <p className="inspector__note" {...rest}>
      {children}
    </p>
  )
}
