import { useState, type ReactElement, type ReactNode } from 'react'

import { assetTypeForName } from '../../runtime/formats/meta-schema'
import {
  SCENE_FORMAT,
  spriteOf,
  unknownComponentTypesOf,
  type Entity,
  type Scene,
} from '../../runtime/formats/scene-schema'
import { MetaViewSchema } from '../../sidecar/meta-view-schema'
import type { ProjectTree, TreeNode } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { describeProblem, type SceneAssets } from '../shell/scene-assets'
import { editDocument, sealEdits } from '../store/open-documents'
import { NumberField } from './NumberField'

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
  entity: Entity
  tree: ProjectTree | null
  assets: SceneAssets
}

export function EntityInspector({
  scenePath,
  scene,
  entity,
  tree,
  assets,
}: EntityInspectorProps): ReactElement {
  const change = (field: string, label: string, recipe: (entity: Entity) => void): void => {
    editDocument(scenePath, { label, merge: `${scenePath}#${entity.id}#${field}` }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      const target = document.entities.find((candidate) => candidate.id === entity.id)
      if (target !== undefined) recipe(target)
    })
  }

  const sprite = spriteOf(entity)
  const unknown = unknownComponentTypesOf(entity)
  const problem = sprite === null ? undefined : assets.problems[sprite.texture.path]

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

      <Section title="Sprite">
        <TexturePicker scenePath={scenePath} entity={entity} tree={tree} />
        {problem !== undefined && (
          <p className="inspector__note inspector__note--bad" data-testid="entity-texture-problem">
            {describeProblem(problem)}
          </p>
        )}
        {sprite !== null && <Field label="Reference" value={sprite.texture.id} testId="entity-texture-id" />}
        <Note>
          Where this sprite sits is decided by the pivot in the texture&apos;s own import settings, not here.
        </Note>
      </Section>

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
 * Which texture this entity draws.
 *
 * **This is the one place a D5 reference is written**, and the reason it is
 * asynchronous: a reference carries the stable id as well as the path, and the
 * id lives in the texture's own `.meta`. Picking a texture therefore asks the
 * service what that file's id is and then writes the pair in a single
 * transaction. Writing only the path would look identical today and lose the
 * half of the reference that survives a rename.
 *
 * "Nothing" removes the whole sprite component rather than emptying a field. A
 * component map with a sprite that draws nothing in it is a shape the format
 * does not need, and removing it is what makes an entity with no sprite one
 * thing rather than two.
 */
function TexturePicker({
  scenePath,
  entity,
  tree,
}: {
  scenePath: string
  entity: Entity
  tree: ProjectTree | null
}): ReactElement {
  const [problem, setProblem] = useState<string | null>(null)
  const sprite = spriteOf(entity)
  const textures = tree === null ? [] : texturesIn(tree)

  const pick = async (path: string): Promise<void> => {
    setProblem(null)

    if (path === '') {
      editDocument(scenePath, { label: 'Remove sprite' }, (document) => {
        if (document.format !== SCENE_FORMAT) return
        const target = document.entities.find((candidate) => candidate.id === entity.id)
        if (target !== undefined) delete target.components['sprite']
      })
      return
    }

    let id: string
    try {
      const response = await fetch(`/api/meta?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const view = MetaViewSchema.parse(await response.json())
      if (view.status !== 'ok' || view.meta === null) {
        setProblem(
          `${basename(path)} has no import settings yet, so there is no id to point at. Try again in a moment.`,
        )
        return
      }
      id = view.meta.id
    } catch {
      setProblem('Could not ask the editor service for that texture. Is the editor command still running?')
      return
    }

    // One transaction: the id and the path are one reference and half of one is
    // not worth writing.
    editDocument(scenePath, { label: 'Set texture' }, (document) => {
      if (document.format !== SCENE_FORMAT) return
      const target = document.entities.find((candidate) => candidate.id === entity.id)
      if (target !== undefined) target.components['sprite'] = { texture: { id, path } }
    })
  }

  return (
    <>
      <Row label="Texture">
        <select
          className="control control--choice"
          data-testid="entity-texture-control"
          value={sprite?.texture.path ?? ''}
          onChange={(event) => void pick(event.target.value)}
        >
          <option value="">Nothing — this entity draws no sprite</option>
          {textures.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
          {/* A reference to a file that is gone still has to be shown as the
              current value, or the control would silently read as "Nothing"
              while the scene says otherwise. */}
          {sprite !== null && !textures.includes(sprite.texture.path) && (
            <option value={sprite.texture.path}>{sprite.texture.path} — not in the project</option>
          )}
        </select>
      </Row>
      {problem !== null && (
        <p className="inspector__note inspector__note--bad" data-testid="entity-texture-pick-problem">
          {problem}
        </p>
      )}
    </>
  )
}

/** Every texture in the project, by path, in the order the folder lists them. */
function texturesIn(tree: ProjectTree): string[] {
  const found: string[] = []

  const walk = (node: TreeNode): void => {
    if (node.kind === 'file') {
      if (assetTypeForName(node.name) === 'texture') found.push(node.path)
      return
    }
    for (const child of node.children) walk(child)
  }

  walk(tree.tree)
  return found
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
