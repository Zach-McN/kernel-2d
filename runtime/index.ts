/**
 * The runtime, as everything outside it sees it.
 *
 * This is the layer that ships inside an exported game: the renderer, the
 * formats it loads, the meaning of the settings those formats carry, and — since
 * time started passing — the update loop and the systems it runs. The editor
 * imports it as a library and embeds it (editor-kernel D2), which is what makes
 * the editor's preview the actual game rather than a drawing of it. The editor
 * starts and stops a running level; it never drives one.
 *
 * The direction of the arrow is the whole point and it is asserted by
 * `tests/architecture/boundaries.test.ts`: the editor may import the runtime, and
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
  SCENE_FORMAT,
  SCENE_VERSION,
  SceneSchema,
  componentOf,
  copyEntity,
  defaultEntity,
  defaultScene,
  defaultTransform,
  isKnownComponentType,
  prefabRefOf,
  serializeScene,
  spinOf,
  spriteOf,
  textureRefsOf,
  unknownComponentTypesOf,
  type AssetRef,
  type ComponentHolder,
  type Entity,
  type KnownComponentType,
  type PrefabComponent,
  type Scene,
  type SpinComponent,
  type SpriteComponent,
  type Transform,
} from './formats/scene-schema'

export {
  PREFAB_FORMAT,
  PREFAB_VERSION,
  PrefabSchema,
  defaultPrefab,
  instanceOfPrefab,
  resolveEntities,
  resolveEntity,
  serializePrefab,
  type Prefab,
} from './formats/prefab-schema'

export {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectSchema,
  defaultProject,
  serializeProject,
  type Project,
} from './formats/project-schema'

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

export { ZOOM_STEPS, fitStep } from './scene/scale-steps'

export type { DrawnEntity } from './scene/entity-layer'

export { inSceneUnits, type DrawnInScene } from './scene/drawn-in-scene'

export {
  describeLoadProblem,
  loadScene,
  type LoadProblem,
  type ProjectReader,
  type SceneLoadResult,
} from './scene/load-scene'

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

export { MAX_STEPS_PER_FRAME, STEP_MS, createLoop, type Loop, type LoopOptions } from './game/loop'

export { stepSystems, type System } from './game/system'

export { BUILT_IN_SYSTEMS, spinSystem } from './game/systems/index'

export {
  NOTIFY_EVERY_MS,
  runLevel,
  type RunLevelOptions,
  type RunState,
  type RunningLevel,
} from './game/run-level'

export { INPUT_ENTITY_ID, inputEntity, pressedIn, writePressed } from './game/input'

export { collectKeys, type KeyCollector } from './web/keyboard'
