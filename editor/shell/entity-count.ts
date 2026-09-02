/**
 * What the undo history calls a step taken over one or several entities.
 *
 * The count is in the label because the history is read by somebody deciding
 * whether to press Ctrl-Z again, and "Delete entity" against a step that
 * removed six of them is the one wrong answer available. Every step that can
 * take a whole selection — move, turn, scale, delete — names itself through
 * here, so they agree on the sentence.
 */
export function entitiesLabel(verb: string, count: number): string {
  return count === 1 ? `${verb} entity` : `${verb} ${count} entities`
}
