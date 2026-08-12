/**
 * The runtime, as everything outside it sees it.
 *
 * This is the layer that ships inside an exported game: the renderer, the
 * formats it loads, and the meaning of the settings those formats carry. The
 * editor imports it as a library and embeds it (editor-kernel D2), which is
 * what makes the editor's preview the actual game rather than a drawing of it.
 *
 * The direction of the arrow is the whole point and it is asserted by
 * `tests/runtime/boundaries.test.ts`: the editor may import the runtime, and
 * nothing here may ever import the editor or the development-only service. A
 * game that ships with a panel in it is the failure this boundary exists to
 * prevent, and it is far cheaper to hold now than to unpick later.
 */

export {
  ASSET_META_FORMAT,
  ASSET_META_VERSION,
  ASSET_TYPE_BY_EXTENSION,
  AssetMetaSchema,
  META_SUFFIX,
  annotatedPathFor,
  assetTypeForName,
  defaultImportSettings,
  defaultMeta,
  defaultTextureImportSettings,
  isMetaFileName,
  metaPathFor,
  serializeMeta,
  type AssetMeta,
  type AssetType,
  type ImportSettings,
  type Pivot,
  type Slice,
  type TextureFilter,
  type TextureImportSettings,
} from './formats/meta-schema'

export {
  COMPONENT_SCHEMAS,
  PREFAB_FORMAT,
  PREFAB_VERSION,
  PrefabSchema,
  SCENE_FORMAT,
  SCENE_VERSION,
  SceneSchema,
  componentOf,
  copyEntity,
  defaultEntity,
  defaultPrefab,
  defaultScene,
  defaultTransform,
  instanceOfPrefab,
  isKnownComponentType,
  prefabRefOf,
  resolveEntities,
  resolveEntity,
  serializePrefab,
  serializeScene,
  spriteOf,
  unknownComponentTypesOf,
  type AssetRef,
  type Entity,
  type KnownComponentType,
  type Prefab,
  type PrefabComponent,
  type Scene,
  type SpriteComponent,
  type Transform,
} from './formats/scene-schema'

export { framesFor, type FrameRect, type SlicedFrames } from './textures/frames'

export {
  DEFAULT_CAMERA,
  framing,
  isOnScreen,
  panBy,
  snapCamera,
  toSceneRect,
  toScenePoint,
  toScreenPoint,
  toScreenRadians,
  union,
  zoomAbout,
  type Camera,
  type Point,
  type Rect,
  type Size,
} from './scene/coordinates'

export type { DrawnEntity } from './scene/entity-layer'

export {
  createSceneView,
  type SceneRequest,
  type SceneTexture,
  type SceneView,
  type SceneViewOptions,
  type ShownScene,
} from './scene/scene-view'

export {
  createTextureView,
  type ShownTexture,
  type TextureRequest,
  type TextureView,
  type TextureViewOptions,
} from './preview/texture-view'
