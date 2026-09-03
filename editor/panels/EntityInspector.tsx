import type { ReactElement } from 'react'

import {
  SCENE_FORMAT,
  prefabRefOf,
  screenOf,
  spinOf,
  spriteOf,
  unknownComponentTypesOf,
  type AssetRef,
  type Entity,
  type Scene,
  type ScreenComponent,
  type SpriteComponent,
} from '../../runtime/formats/scene-schema'
import { lineageOf, toPinnedOffset, toScenePoint, worldTransformOf } from '../../runtime/scene/coordinates'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { useComponentTypes } from '../shell/component-types'
import { useSceneView } from '../shell/scene-view-context'
import { describeProblem, type SceneAssets } from '../shell/scene-assets'
import { parentWorldOf, storedFor } from '../shell/reparent'
import { describePrefabProblem, instancesOf, useResolvedScene, type PrefabProblem } from '../shell/scene-prefabs'
import { useSelection } from '../shell/selection'
import { usePlacePrefab } from '../shell/usePlacePrefab'
import { editDocument, sealEdits } from '../store/open-documents'
import { ComponentFields } from './ComponentFields'
import { Field, Note, Row, Section } from './fields'
import { NumberField } from './NumberField'
import type { Prefab } from '../../runtime/formats/prefab-schema'
import { PlaceByClicking } from './PlaceByClicking'
import { PlacementParts } from './PlacementParts'
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

/**
 * The corners a designer picks from. The format stores fractions (a third of
 * the way across is expressible); the picker names the nine places anyone
 * actually asks for. A fraction that is none of these reads as its nearest
 * corner in the picker and is left exactly as it is in the file.
 */
const ANCHORS = {
  none: null,
  'top-left': { x: 0, y: 1 },
  top: { x: 0.5, y: 1 },
  'top-right': { x: 1, y: 1 },
  left: { x: 0, y: 0.5 },
  centre: { x: 0.5, y: 0.5 },
  right: { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 0 },
  bottom: { x: 0.5, y: 0 },
  'bottom-right': { x: 1, y: 0 },
} as const

type AnchorName = keyof typeof ANCHORS

const ANCHOR_LABELS: Record<AnchorName, string> = {
  none: 'Not pinned — stands in the world',
  'top-left': 'Top-left corner',
  top: 'Top edge, centred',
  'top-right': 'Top-right corner',
  left: 'Left edge, centred',
  centre: 'Centre of the screen',
  right: 'Right edge, centred',
  'bottom-left': 'Bottom-left corner',
  bottom: 'Bottom edge, centred',
  'bottom-right': 'Bottom-right corner',
}

function anchorNameOf(anchor: ScreenComponent['anchor'] | null): AnchorName {
  if (anchor === null) return 'none'
  const column = anchor.x < 0.25 ? 0 : anchor.x > 0.75 ? 2 : 1
  const row = anchor.y < 0.25 ? 0 : anchor.y > 0.75 ? 2 : 1
  const names: AnchorName[][] = [
    ['bottom-left', 'bottom', 'bottom-right'],
    ['left', 'centre', 'right'],
    ['top-left', 'top', 'top-right'],
  ]
  return names[row]?.[column] ?? 'centre'
}

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
  const view = useSceneView()

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
  // What is left after both registries: the four types this editor owns, and
  // the ones this *game* has described for itself. A described type has fields
  // above, so reporting it here as one with no controls would be the panel
  // contradicting the section directly above it.
  const described = useComponentTypes().byType
  const unknown = unknownComponentTypesOf(entity).filter((type) => described[type] === undefined)
  const problem = drawn === null ? undefined : assets.problems[drawn.texture.path]

  // The entity's own turn rate, and the one it would actually turn at. Same
  // pair as the sprite above, for the same reason: an instance can inherit one
  // from its prefab, and the field has to be about the number this entity
  // carries rather than about a number typing into it would silently override.
  const spin = spinOf(entity)
  const inheritedSpin = spin === null ? spinOf(resolved) : null

  // Where it is pinned, own or inherited, the same way.
  const pin = screenOf(entity)
  const inheritedPin = pin === null ? screenOf(resolved) : null

  // What it is attached to, if anything: the Transform section's numbers are
  // then an offset from that entity, and the section says so in its title.
  const parent = entity.parent === undefined ? null : (scene.entities.find((one) => one.id === entity.parent) ?? null)
  const attachedTo =
    entity.parent === undefined ? null : parent === null ? 'an entity that is not in this level' : parent.name

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

      <Section title={attachedTo === null ? 'Transform' : `Transform — offset from ${attachedTo}`}>
        {attachedTo !== null && (
          <Note data-testid="entity-transform-offset">
            Relative to <strong>{attachedTo}</strong>: position, rotation and scale here are measured
            from it, and moving it moves this too.
          </Note>
        )}
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

      <Section title="Spin">
        <Row label="Rate">
          <NumberField
            testId="entity-spin-control"
            title="Degrees per second, counter-clockwise. Only while the level is running."
            value={spin?.degreesPerSecond ?? 0}
            step={15}
            onCommit={(rate) =>
              change('spin', 'Spin', (target) => {
                // Nought and "does not turn" are the same thing to look at, so
                // the component goes away rather than every entity somebody
                // clicked on acquiring a rate of nothing. A level stays a
                // description of what is in it.
                if (rate === 0) delete target.components['spin']
                else target.components['spin'] = { degreesPerSecond: rate }
              })
            }
          />
        </Row>

        {inheritedSpin !== null && (
          <Note data-testid="entity-spin-inherited">
            This one turns at {inheritedSpin.degreesPerSecond}°/s because its prefab says so. Typing a rate
            here gives this placement its own, and it stops following the prefab.
          </Note>
        )}

        <Note>
          Nothing turns while you are editing. Press Play to see it, and Stop to put it back where the file
          has it.
        </Note>
      </Section>

      <Section title="Pinned to">
        <Row label="Screen">
          <select
            className="control control--choice"
            data-testid="entity-screen-control"
            title="Pin this entity to a spot on the screen instead of a place in the world"
            value={anchorNameOf(pin?.anchor ?? null)}
            onChange={(event) => {
              const anchor = ANCHORS[event.target.value as AnchorName] ?? null
              // Where the entity is on screen right now, from the renderer's own
              // report — so pinning keeps it exactly where it appears, and the
              // position field starts saying the same place in the new terms
              // rather than the sprite leaping to a corner-relative spot.
              const shown = view.state === 'ready' ? view.shown : null
              const there = shown?.entities.find((one) => one.id === entity.id)?.origin ?? null
              // The corner in force *after* the change: this entity's own, else
              // the nearest one above it — a child of a pinned counter stays
              // pinned by the counter when its own pin is taken off.
              const inherited =
                lineageOf(entity, scene.entities)
                  .slice(1)
                  .map((one) => screenOf(one)?.anchor ?? null)
                  .find((one) => one !== null) ?? null
              const effective = anchor ?? inherited
              const world = worldTransformOf(entity, scene.entities)
              const parentWorld = parentWorldOf(entity, scene.entities)
              change('screen', 'Pin to screen', (target) => {
                // "Not pinned" is the absence of the component, not a component
                // saying so — a level stays a description of what is in it.
                if (anchor === null) delete target.components['screen']
                else target.components['screen'] = { anchor: { ...anchor } }

                if (there === null || shown === null) return
                const kept =
                  effective === null
                    ? toScenePoint(there, shown.drawnWith, shown.canvasSize)
                    : toPinnedOffset(there, effective, shown.drawnWith, shown.canvasSize)
                // In the level's terms for a root; as the offset under its
                // parent for a child, so it stays where it appears either way.
                const stored = storedFor({ ...world, x: kept.x, y: kept.y }, parentWorld)
                target.transform.x = stored.x
                target.transform.y = stored.y
              })
            }}
          >
            {(Object.keys(ANCHORS) as AnchorName[]).map((name) => (
              <option key={name} value={name}>
                {ANCHOR_LABELS[name]}
              </option>
            ))}
          </select>
        </Row>

        {inheritedPin !== null && (
          <Note data-testid="entity-screen-inherited">
            This one is pinned to the {ANCHOR_LABELS[anchorNameOf(inheritedPin.anchor)].toLowerCase()} because its
            prefab says so. Choosing here gives this placement its own pin.
          </Note>
        )}

        <Note>
          A pinned entity stays at its corner of the screen wherever the camera looks; its position is then
          measured from that corner, in the same units, so it drags and types like anything else.
        </Note>
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
          {/*
            Said rather than offered. Nothing in this editor writes an opacity
            yet — the platformer's fading particles are spawned while a level
            runs and never authored — but a level that carries one would
            otherwise be drawn faintly with no panel in the editor admitting
            why, which is the trap the "other components" note exists to avoid.
            The day a designer wants to fade something by hand, this line
            becomes a field.
          */}
          {own?.opacity !== undefined && (
            <Field label="Opacity" value={String(own.opacity)} testId="entity-opacity" />
          )}
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

      {/* The parts this placement draws, when its prefab has any: seen and tuned
          here, under the placement, because a part is not an entity in the
          level and has no row of its own. */}
      {source !== null && resolvedScene.prefabs[source.path] !== undefined && (
        <PlacementParts
          scenePath={scenePath}
          placement={entity}
          prefab={resolvedScene.prefabs[source.path] as Prefab}
        />
      )}

      {/* The game's own nouns, drawn from the game's own description of them —
          after the picture, because what an entity *is* comes before what it
          does, and before the note about the ones nobody has described. */}
      <ComponentFields target={{ kind: 'entity', scenePath, entity, resolved }} />

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
    else {
      // Spread rather than replaced: the component may carry an opacity, or a
      // key this editor has never heard of, and picking a texture is not a
      // reason to lose either (text-formats T9's rule, one level in).
      const standing = target.components['sprite']
      const kept = typeof standing === 'object' && standing !== null ? standing : {}
      target.components['sprite'] = { ...kept, texture: reference }
    }
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
          {/* And the same again for "another twenty", from the same door. */}
          <PlaceByClicking
            prefabPath={source.path}
            canPlace={placing.canPlace}
            testId="entity-place-by-clicking"
          />
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
        Its picture is decided in the prefab, for every instance at once — and so is where each of its parts
        sits. Where it stands, how big it is and how far it is turned are this one&apos;s alone.
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
