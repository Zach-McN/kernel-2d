import { createContext, useContext, type ReactElement, type ReactNode } from 'react'

import { useProjectTree, type ProjectTreeState } from './useProjectTree'

/**
 * The project folder, read once for the whole window.
 *
 * The hook underneath opens a change stream and re-reads the folder whenever
 * anything moves. Calling it from two panels would open two streams and do the
 * reading twice, and — worse — the two copies would be refreshed on separate
 * timers, so a panel could be a beat behind its neighbour with nothing saying
 * so. One reader, shared, is the same reasoning as `editor-ui` U5 one level up.
 */

const ProjectContext = createContext<ProjectTreeState | null>(null)

export function ProjectProvider({ children }: { children: ReactNode }): ReactElement {
  const project = useProjectTree()

  return <ProjectContext.Provider value={project}>{children}</ProjectContext.Provider>
}

export function useProject(): ProjectTreeState {
  const project = useContext(ProjectContext)
  if (project === null) throw new Error('useProject was called outside the editor shell')
  return project
}
