import fs from 'node:fs'

/**
 * Who the generators say they are, and how a file that cannot hold structure
 * says it was generated.
 *
 * Both live here rather than beside any one generator because more than one
 * writes into a human's project folder — the sample content and the editor
 * launcher, so far — and they must agree. Two spellings of the marker would
 * mean each generator could only recognise its own output, and the rule that
 * matters (a file without the marker is human-authored and is never
 * overwritten) would quietly become a rule about who wrote it last.
 */

export const GENERATED_BY = 'claude-opus-5'

/**
 * The marker as a file with no structure carries it: in a comment, not in a
 * field. A `.ts` has nowhere structural to put one and a `.meta` beside it
 * would be the asset pipeline annotating something that is not an asset — so
 * the marker is a comment, and finding it is a text search rather than a parse.
 *
 * Deliberately looks for the bare word rather than for any one comment syntax:
 * the files that need this are a TypeScript source and a Windows command file,
 * and the next one will be a third syntax.
 *
 * Unreadable, or not text at all, means not ours — which is the safe answer,
 * because the only thing this decides is whether a file may be overwritten.
 */
export function marksItself(absolutePath: string): boolean {
  try {
    return fs.readFileSync(absolutePath, 'utf8').includes('generatedBy')
  } catch {
    return false
  }
}
