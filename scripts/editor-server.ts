/**
 * Knobs for the editor window itself — where it listens, and whether starting
 * it also opens a browser. The sidecar's own port lives in
 * `sidecar/config.ts`; these are the other half of the pair, kept here so the
 * dev server, the launcher, and the browser test harness read one value rather
 * than three copies of the same number.
 */

/**
 * Loopback only, and spelled as an address rather than as `localhost`: on
 * Windows `localhost` resolves to the IPv6 loopback first, so a server bound to
 * the name is not reachable at 127.0.0.1 — which is where anything else looking
 * for it will knock.
 */
export const EDITOR_HOST = '127.0.0.1'

export const EDITOR_PORT_ENV_VAR = 'KERNEL_EDITOR_PORT'
export const DEFAULT_EDITOR_PORT = 5173

/** Falls back to the default for anything that is not a whole port number. */
export function resolveEditorPort(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env[EDITOR_PORT_ENV_VAR]?.trim()
  if (raw === undefined || raw === '' || !/^\d+$/.test(raw)) return DEFAULT_EDITOR_PORT
  const port = Number(raw)
  return port > 65535 ? DEFAULT_EDITOR_PORT : port
}

/**
 * Starting the editor opens a browser, because that is the point of the
 * command. The browser tests turn it off — they drive their own window, and a
 * second one stealing focus mid-run is both useless and disruptive.
 */
export const OPEN_BROWSER_ENV_VAR = 'KERNEL_OPEN_BROWSER'

export function shouldOpenBrowser(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env[OPEN_BROWSER_ENV_VAR]?.trim().toLowerCase()
  return !(raw === '0' || raw === 'false' || raw === 'no')
}
