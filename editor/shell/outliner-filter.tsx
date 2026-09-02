import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'

/**
 * What is typed in the Outliner's filter box.
 *
 * A level of 250 entities is a list nobody can find a walker in by scrolling,
 * and the Outliner is the one place an entity is reached by name. While the box
 * says anything, the list shows only the rows whose name contains it; clear it
 * and every row is back. It narrows what is *shown* and nothing else — the
 * selection, the draw order and the level are untouched, which is why it is not
 * in the document and never in a transaction (`editor-ui` U8).
 *
 * Above the docking layout rather than inside the panel, for the reason every
 * other piece of window state is (U9): dockview unmounts a panel's body when
 * its tab is dragged, and a filter typed a moment ago should not be thrown away
 * by moving the panel. The same home the Assets panel's search has, one panel
 * over (`asset-browsing.tsx`), and for the same reason it is not remembered
 * across a reload: a filter is what somebody is doing, not a setting.
 */

export interface OutlinerFilter {
  filter: string
  setFilter: (filter: string) => void
}

const OutlinerFilterContext = createContext<OutlinerFilter | null>(null)

export function OutlinerFilterProvider({ children }: { children: ReactNode }): ReactElement {
  const [filter, setFilter] = useState('')
  const value = useMemo<OutlinerFilter>(() => ({ filter, setFilter }), [filter])
  return <OutlinerFilterContext.Provider value={value}>{children}</OutlinerFilterContext.Provider>
}

export function useOutlinerFilter(): OutlinerFilter {
  const filter = useContext(OutlinerFilterContext)
  if (filter === null) throw new Error('useOutlinerFilter was called outside the editor shell')
  return filter
}

/**
 * Whether a name says every word of the filter, in any order, whatever the
 * case — the Assets search's rule (`asset-rows.ts`, `searchRows`), so the two
 * boxes on screen behave as one kind of thing. Blank matches everything: no
 * filter is the whole list.
 */
export function nameMatches(name: string, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter((word) => word.length > 0)
  const lower = name.toLowerCase()
  return words.every((word) => lower.includes(word))
}
