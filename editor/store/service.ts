import type { ZodType } from 'zod'

/**
 * One request to the editor service, and what every request to it owes.
 *
 * Three files in this folder write through the service — settings, documents,
 * files — and each had grown the same four lines: send, and if the service said
 * no, throw its sentence; if it said yes, parse the answer against the schema
 * before believing it. This is those four lines once. Each writer still owns
 * *which* request it makes and *what* the fallback sentence says; what they no
 * longer own is the shape of asking.
 *
 * **Validated rather than trusted**, the same as every other answer this editor
 * reads: a service speaking a shape this editor does not know is treated as a
 * failed operation, not as a successful one.
 *
 * **The service's own refusals are carried through unchanged.** Every refusal
 * it sends carries `{ error: "one plain sentence" }` written for the human, so
 * that sentence is what a caller surfaces. The fallback covers a refusal with no
 * readable body — a service mid-restart, a proxy answering in its place — where
 * the caller still owes the human a sentence naming what did not happen.
 */
export async function askService<T>(
  url: string,
  init: RequestInit,
  answer: ZodType<T>,
  fallback: string,
): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' })

  if (!response.ok) throw new Error(await refusal(response, fallback))

  return answer.parse(await response.json())
}

/** The service's own sentence for a refused request, or the caller's fallback. */
export async function refusal(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error !== '') return body.error
  } catch {
    // Fall through to the caller's generic sentence.
  }
  return fallback
}

/** A JSON body, for the requests that carry one. */
export function jsonBody(method: 'PUT' | 'POST', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
