import { defineConfig, devices } from '@playwright/test'

import { EDITOR_HOST, EDITOR_PORT_ENV_VAR, OPEN_BROWSER_ENV_VAR } from './scripts/editor-server.js'
import { PORT_ENV_VAR, PROJECT_ENV_VAR } from './sidecar/config.js'
import { buildEditorTestProject } from './tests/editor/test-project.js'

/**
 * The browser test harness.
 *
 * It starts the editor with the same one command a human uses, so the command
 * itself is under test — if `npm run editor` stops working, the browser suite
 * goes red rather than passing against a hand-assembled substitute.
 *
 * Both ports differ from the defaults on purpose: a run must not collide with,
 * or quietly attach to, an editor the human already has open.
 */

const EDITOR_PORT = 5273
const SIDECAR_PORT = 7431

const projectPath = buildEditorTestProject()

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
  webServer: {
    command: 'npm run editor',
    url: `http://${EDITOR_HOST}:${EDITOR_PORT}`,
    // Never adopt a server this harness did not start: it would be watching
    // some other folder, and every assertion about the project would be a lie.
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
})
