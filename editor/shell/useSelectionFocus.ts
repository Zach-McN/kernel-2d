import { useEffect } from 'react'

import { assetTypeOf, basename, findNode } from './asset-kinds'
import { useLayout } from './layout-context'
import { useOpenScene } from './open-scene'
import { PANELS } from './panels'
import { useProject } from './project-context'
import { useSelection } from './selection'
import { useMetaDocument } from '../store/open-documents'

/**
 * Bringing the right tab forward for what was just clicked.
 *
 * The Viewport and the Texture tab share a group, so only one of them is on
 * screen at a time: clicking a texture has to bring the Texture tab forward and
 * clicking a scene has to bring the Viewport back, or half the time the human
 * clicks something and nothing appears to happen.
 *
 * It lives in the shell rather than in either panel, because a panel behind
 * another tab is not rendering and cannot ask to be looked at.
 *
 * What counts as a texture is the same question the panels ask, answered the
 * same way: the `.meta` when the store has it, the file's extension until then
 * (`editor-ui` U11). Falling back to the extension is what keeps the tab from
 * arriving a beat after the click; if the settings then say the file is
 * something else, the panel says so, which is the state it exists to describe.
 */
export function useSelectionFocus(): void {
  const project = useProject()
  const selection = useSelection()
  const open = useOpenScene()
  const layout = useLayout()

  const path = selection.selectedFilePath
  const tree = project.state === 'ready' ? project.tree : null
  const node = tree === null || path === null ? null : findNode(tree, path)
  const meta = useMetaDocument(path)

  const isTexture =
    node !== null && node.kind === 'file' && assetTypeOf(basename(node.path), meta) === 'texture'

  // A scene, established the only honest way: the file said so, and it is now
  // the one the Viewport is showing.
  const isOpenScene = path !== null && open.state === 'open' && open.path === path

  useEffect(() => {
    if (isTexture) layout.bringToFront(PANELS.texture.id)
  }, [isTexture, path, layout])

  useEffect(() => {
    if (isOpenScene) layout.bringToFront(PANELS.viewport.id)
  }, [isOpenScene, path, layout])
}
