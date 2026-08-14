/**
 * One issue, said plainly. A wall of validator output helps nobody read a panel.
 *
 * Shared by every answer the service gives about a document it could not
 * validate, so the same problem is always described in the same words. The
 * export command deliberately phrases its own (`scripts/export/plan.ts`) — a
 * terminal refusal reads differently from a panel sentence — so that one is a
 * decision, not a missed merge.
 */
export function firstIssue(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
}): string {
  const issue = error.issues[0]
  if (issue === undefined) return 'it did not validate'
  const where = issue.path.map(String).join('.')
  return where === '' ? issue.message : `${where}: ${issue.message}`
}
