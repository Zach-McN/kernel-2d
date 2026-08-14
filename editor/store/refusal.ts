/**
 * The service's own sentence for a refused request.
 *
 * Every refusal the service sends carries `{ error: "one plain sentence" }`
 * written for the human, so that sentence is what a caller surfaces. The
 * fallback covers a refusal with no readable body — a service mid-restart, a
 * proxy answering in its place — where the caller still owes the human a
 * sentence naming what did not happen.
 *
 * Shared by every module here that writes through the service; three copies of
 * this had grown, one per writer, before a gardening pass folded them together.
 */
export async function refusal(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error !== '') return body.error
  } catch {
    // Fall through to the caller's generic sentence.
  }
  return fallback
}
