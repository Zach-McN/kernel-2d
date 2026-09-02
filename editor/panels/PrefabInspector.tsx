import type { ReactElement } from 'react'

import { PREFAB_FORMAT, type Prefab } from '../../runtime/formats/prefab-schema'
import { spriteOf, unknownComponentTypesOf, type AssetRef } from '../../runtime/formats/scene-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { useComponentTypes } from '../shell/component-types'
import { describeProblem, useSceneAssets } from '../shell/scene-assets'
import { instancesOf, useResolvedScene } from '../shell/scene-prefabs'
import { usePlacePrefab } from '../shell/usePlacePrefab'
import { editDocument, sealEdits } from '../store/open-documents'
import { ComponentFields } from './ComponentFields'
import { Field, Note, Section } from './fields'
import { PlaceByClicking } from './PlaceByClicking'
import { TexturePicker } from './TexturePicker'

/**
 * A prefab: what a thing is, and the button that puts one in a level.
 *
 * Everything here goes through the transaction API, so changing a prefab's
 * picture is one press of Ctrl-Z like any other edit — and because the level's
 * instances draw the prefab straight out of the document store, the change lands
 * in the Viewport as it is made, with nothing told to refresh.
 *
 * **Placing is an edit to the level, not to the prefab.** It writes one entity
 * carrying a reference and nothing else, which is what makes editing the prefab
 * afterwards reach every instance. An entity that copied the prefab's components
 * at placement time would look identical on the day it was placed and be dead
 * weight the next.
 *
 * **The game's own components are edited here too, through the same fields the
 * entity panel draws** (`ComponentFields.tsx`, aimed at the prefab document).
 * That is what makes "every walker in the level" one edit: a speed typed here
 * reaches every instance that has not been given a speed of its own, the same
 * way the picture does. Until this existed the panel named those components
 * as ones it had no controls for, and the only way to retune all of an enemy
 * was to edit the file by hand.
 */
export function PrefabInspector({
  path,
  prefab,
  tree,
}: {
  path: string
  prefab: Prefab
  tree: ProjectTree | null
}): ReactElement {
  const resolved = useResolvedScene()
  const assets = useSceneAssets()
  const placing = usePlacePrefab(path)

  const sprite = spriteOf(prefab)
  const textureProblem = sprite === null ? undefined : assets.problems[sprite.texture.path]
  // What is left after both registries: the types this editor owns, and the
  // ones the game has described, which have fields of their own below.
  const described = useComponentTypes().byType
  const unknown = unknownComponentTypesOf(prefab).filter((type) => described[type] === undefined)

  const change = (field: string, label: string, recipe: (draft: Prefab) => void): void => {
    editDocument(path, { label, merge: `${path}#${field}` }, (document) => {
      if (document.format !== PREFAB_FORMAT) return
      recipe(document)
    })
  }

  const setTexture = (reference: AssetRef | null): void => {
    editDocument(path, { label: reference === null ? 'Remove sprite' : 'Set prefab texture' }, (document) => {
      if (document.format !== PREFAB_FORMAT) return
      if (reference === null) delete document.components['sprite']
      else document.components['sprite'] = { texture: reference }
    })
  }

  const placed = instancesOf(resolved.entities, path)

  return (
    <>
      <Section title="Prefab">
        <div className="inspector__field">
          <span className="inspector__label">Name</span>
          <span className="control-row">
            <input
              type="text"
              className="control control--text"
              data-testid="prefab-name-control"
              value={prefab.name}
              onBlur={sealEdits}
              onChange={(event) => {
                const name = event.target.value
                change('name', 'Rename prefab', (draft) => {
                  draft.name = name
                })
              }}
            />
          </span>
        </div>
        <Field label="ID" value={prefab.id} testId="prefab-id" />
        <Note>Whatever is set here is what every instance of this prefab draws.</Note>
      </Section>

      <Section title="Sprite">
        <TexturePicker
          value={sprite?.texture ?? null}
          tree={tree}
          testId="prefab-texture-control"
          onPick={setTexture}
        />
        {textureProblem !== undefined && (
          <p className="inspector__note inspector__note--bad" data-testid="prefab-texture-problem">
            {describeProblem(textureProblem)}
          </p>
        )}
      </Section>

      {/* The game's own nouns, on the prefab: what every instance carries unless
          it has been given its own. After the picture, before the placing, for
          the entity panel's reason — what a thing is before where it goes. */}
      <ComponentFields target={{ kind: 'prefab', path, prefab }} />

      <Section title="In a level">
        {placing.scenePath === null ? (
          <Note data-testid="prefab-place-note">
            No level is open. Click a scene in the Assets panel and this will place one in it.
          </Note>
        ) : (
          <>
            <div className="inspector__field">
              <span className="inspector__label">Level</span>
              <span className="control-row">
                <button
                  type="button"
                  className="control control--action"
                  data-testid="prefab-place"
                  disabled={!placing.canPlace}
                  onClick={placing.place}
                >
                  Place in {basename(placing.scenePath)}
                </button>
                <PlaceByClicking
                  prefabPath={path}
                  canPlace={placing.canPlace}
                  testId="prefab-place-by-clicking"
                />
              </span>
            </div>
            <Field
              label="Placed"
              value={`${placed} ${placed === 1 ? 'time' : 'times'} in ${basename(placing.scenePath)}`}
              testId="prefab-instance-count"
            />
            <Note data-testid="prefab-place-note">
              It lands in the middle of what the Viewport is showing, and is selected — one drag moves it
              where you want it, and the one you placed offers a Place another of its own.
              <em> Place by clicking</em> puts one down wherever you click instead, as many times as you
              like; the Viewport says so while it is on, and Esc stops it.
            </Note>
          </>
        )}
      </Section>

      {unknown.length > 0 && (
        <Section title="Other components">
          <Note data-testid="prefab-unknown-components">
            This prefab also carries {unknown.join(', ')}, which this editor has no controls for. Every
            instance inherits it, and it is kept exactly as it is in the file.
          </Note>
        </Section>
      )}
    </>
  )
}

// --- small pieces ----------------------------------------------------------
