import { defineConfig, devices } from '@playwright/test'

import { EDITOR_HOST, EDITOR_PORT_ENV_VAR, OPEN_BROWSER_ENV_VAR } from './scripts/editor-server.js'
import { PORT_ENV_VAR, PROJECT_ENV_VAR } from './sidecar/config.js'
import { GAME_PORT, GAME_URL } from './tests/editor/served-game.js'
import { buildEditorTestExport } from './tests/editor/test-export.js'
import { buildEditorTestProject } from './tests/editor/test-project.js'

/**
 * The browser test harness.
 *
 * Two servers, and both of them are the command a human would run — the editor with
 * `npm run editor`, and the exported game with `npm run serve`. That is one line of
 * config buying a real assertion (`editor-verification` V8): if either command breaks,
 * the browser suite goes red rather than passing against something only the tests know
 * how to start.
 *
 * The order here matters and is not obvious. The sample project is written first, the
 * export is built from it second — by running the real export command — and only then
 * can the static server be pointed at the folder. Playwright starts its servers before
 * anything else it does, so both have to be finished by the time this file finishes
 * loading.
 *
 * Every port differs from its default on purpose: a run must not collide with, or
 * quietly attach to, an editor or a served folder the human already has open.
 */

const EDITOR_PORT = 5273
const SIDECAR_PORT = 7431

const projectPath = buildEditorTestProject()
const exportPath = buildEditorTestExport()

export default defineConfig({
  testDir: './tests/editor',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://${EDITOR_HOST}:${EDITOR_PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run editor',
      url: `http://${EDITOR_HOST}:${EDITOR_PORT}`,
      // Never adopt a server this harness did not start: it would be watching some
      // other folder, and every assertion about the project would be a lie.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        [PROJECT_ENV_VAR]: projectPath,
        [PORT_ENV_VAR]: String(SIDECAR_PORT),
        [EDITOR_PORT_ENV_VAR]: String(EDITOR_PORT),
        [OPEN_BROWSER_ENV_VAR]: '0',
      },
    },
    {
      // The exported game, served the way the export command tells the human to serve
      // it. Nothing about this server is part of the folder — that is the point of
      // checking it this way round.
      command: `npm run serve -- "${exportPath}" --port ${String(GAME_PORT)}`,
      url: `${GAME_URL}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
