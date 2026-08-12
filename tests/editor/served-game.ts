import { SERVE_HOST } from '../../scripts/serve-folder.js'

/**
 * Where the harness serves the exported game.
 *
 * A module of its own so the spec and `playwright.config.ts` can agree about the
 * address without the spec importing the config — which would re-run the config's
 * top-level work (writing the sample project, building the export) inside the test
 * process, once per worker, for no reason.
 *
 * Off the default serve port for the same reason both editor ports are off theirs: a
 * run must not attach to a folder the human happens to be serving.
 */

export const GAME_PORT = 5274
export const GAME_URL = `http://${SERVE_HOST}:${String(GAME_PORT)}`
