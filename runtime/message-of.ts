/**
 * The sentence inside whatever was thrown.
 *
 * Everything that catches in this kernel wants the same thing from an `unknown`:
 * the message if it was an `Error`, and the value spelled out if it was not —
 * a rejected promise can carry a string, and a `throw` can carry anything. The
 * shipped runtime, the editor, the filesystem service and the command-line
 * scripts all import this one, which is why it lives in `runtime/`: a module the
 * shipping layer reads belongs to the shipping layer, whoever else uses it
 * (`editor-kernel` D20).
 *
 * Seventeen private copies of this line had grown, one per file that caught,
 * before a gardening pass folded them together.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
