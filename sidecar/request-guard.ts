/**
 * Who may ask, checked before what is asked.
 *
 * The service binds to 127.0.0.1 (`config.ts`), and it is tempting to read
 * that as "only this machine can reach it". It bounds who can *connect*, not
 * who can *instruct*: every browser on this machine can be told, by any web
 * page it has open, to fire a POST at `http://127.0.0.1:7331`. The page cannot
 * read the answer — this service never sends a CORS header — but `/delete`,
 * `/move`, `/document` and `/meta` do not need their answers read to do
 * damage, and a simple POST or PUT with query parameters never triggers the
 * preflight that would stop it. So: two headers the page cannot forge, two
 * rules.
 *
 * - **A state-changing request whose `Origin` names anywhere but this machine
 *   is refused.** The browser stamps Origin on every cross-site POST and PUT.
 *   The editor's own window reaches this service through the dev server's
 *   proxy, so its writes arrive bearing the editor's loopback origin and pass.
 *   A request with no Origin at all is not from a browser — curl, the tests,
 *   another local process — and passes too: anything already running on this
 *   machine holds the folder itself, so refusing it would protect nothing.
 * - **Any request whose `Host` names anywhere but this machine is refused,
 *   reads included.** This is the DNS-rebinding half: a page whose site name
 *   is re-pointed at 127.0.0.1 becomes same-origin with this service in its
 *   own browser's eyes and *can* read answers — but every request it sends
 *   still says `Host: evil.example`, a name this service has no business
 *   answering to.
 *
 * "This machine" is the loopback spellings and nothing else, deliberately
 * *not* "the editor's exact origin": the editor's port is a knob
 * (`scripts/editor-server.ts`), the sidecar runs with no editor at all
 * (`npm run sidecar`), and a page served from this machine's own loopback is
 * software that could already open the folder directly — a boundary drawn
 * there is one this service cannot actually hold. Ports are ignored for the
 * same reason on both headers: the proxy hands over the editor's, a direct
 * call carries this service's own, and neither is a fact about *who* is
 * asking.
 *
 * Refusals are 403 with one plain sentence, like every other refusal here —
 * distinct from the 400s, which mean "yours to fix": a 403 is not an invitation
 * to adjust the request until it works.
 */

/**
 * `localhost` is a hand-typed browser address, `[::1]` the same journey over
 * IPv6. Neither can be re-pointed by an attacker's DNS, which is the property
 * this list is actually about.
 */
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * The refusal sentence this request has earned, or null for one that may
 * proceed. Takes the method and the two headers rather than the request, so
 * the rule is testable as a function of four strings.
 */
export function guardRefusal(
  method: string,
  headers: { host?: string | undefined; origin?: string | undefined },
): string | null {
  if (!isLoopbackName(hostnameOfHost(headers.host))) {
    return `This service answers only to this machine, and that request was addressed to "${headers.host ?? ''}".`
  }

  // Reading is open (to this machine — the Host rule above still applies);
  // GET is the only reading method this service answers at all.
  if (method === 'GET') return null

  const origin = headers.origin
  if (origin === undefined) return null

  if (!isLoopbackName(hostnameOfOrigin(origin))) {
    return `This service does not take instructions from other sites' web pages, and that request came from one at "${origin}".`
  }

  return null
}

function isLoopbackName(hostname: string | null): boolean {
  return hostname !== null && LOOPBACK_NAMES.has(hostname)
}

/** The name inside a `Host` header — `127.0.0.1:5173` is `127.0.0.1`. Null when it cannot be read, and unreadable is refused. */
function hostnameOfHost(host: string | undefined): string | null {
  if (host === undefined || host === '') return null
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return null
  }
}

/** The name inside an `Origin` header. `null` (a sandboxed page) and anything unparseable both come back null, and both are refused. */
function hostnameOfOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}
