import { createContext, useContext, type ReactElement, type ReactNode } from 'react'

import { useProject } from './project-context'
import { useSelection } from './selection'
import { useAssetMeta, type AssetMetaState } from './useAssetMeta'

/**
 * The selected file's import settings, asked for once per window.
 *
 * This lived inside the Inspector until the Viewport needed the same answer.
 * Two panels each calling the hook would be two requests for the same file,
 * refreshed on separate timers — the failure `editor-ui` U9 is about, where a
 * panel is a beat behind its neighbour and nothing on screen says which one you
 * are reading.
 *
 * There is a second reason here that U9 does not have. Fetching the settings is
 * also what puts them into the document store, so with the fetch owned by the
 * Inspector, closing that tab would leave the Viewport drawing a texture whose
 * settings never arrived — a panel silently depending on another panel being
 * open. Above the layout, the answer belongs to the window.
 */

const AssetMetaContext = createContext<AssetMetaState | null>(null)

export function AssetMetaProvider({ children }: { children: ReactNode }): ReactElement {
  const project = useProject()
  const selection = useSelection()
  // Re-asked when the folder changes as well as when the selection does, so a
  // `.meta` edited in a text editor shows up without a reload.
  const meta = useAssetMeta(selection.selectedFilePath, project.state === 'ready' ? project.tree : null)

  return <AssetMetaContext.Provider value={meta}>{children}</AssetMetaContext.Provider>
}

export function useSelectedAssetMeta(): AssetMetaState {
  const meta = useContext(AssetMetaContext)
  if (meta === null) throw new Error('useSelectedAssetMeta was called outside the editor shell')
  return meta
}
