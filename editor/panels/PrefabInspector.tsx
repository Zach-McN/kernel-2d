import type { ReactElement } from 'react'

import { PREFAB_FORMAT, type Prefab } from '../../runtime/formats/prefab-schema'
import { spriteOf, unknownComponentTypesOf, type AssetRef } from '../../runtime/formats/scene-schema'
import type { ProjectTree } from '../../sidecar/tree-schema'
import { basename } from '../shell/asset-kinds'
import { describeProblem, useSceneAssets } from '../shell/scene-assets'
import { instancesOf, useResolvedScene } from '../shell/scene-prefabs'
import { usePlacePrefab } from '../shell/usePlacePrefab'
import { editDocument, sealEdits } from '../store/open-documents'
import { Field, Note, Section } from './fields'
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
  const unknown = unknownComponentTypesOf(prefab)

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
