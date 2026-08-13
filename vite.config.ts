import fs from 'node:fs'
import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { EDITOR_HOST, resolveEditorPort } from './scripts/editor-server.js'
import { gameCode } from './scripts/game-code.js'
import { DEFAULT_PORT, PORT_ENV_VAR, PROJECT_ENV_VAR, SIDECAR_HOST } from './sidecar/config.js'

/**
 * The editor window. `editor/` is the Vite root, so `editor/index.html` is the
 * page and everything it imports is the app.
 *
 * The browser reaches the sidecar through `/api`, proxied here. That keeps the
 * sidecar's port out of the editor's code entirely — the launcher tells this
 * config which port it chose, and the editor just asks its own origin.
 *
 * The launcher tells it the project folder the same way, and for the same reason:
 * the game's own code is compiled into the editor's preview by `gameCode`, which
 * is the identical plugin the export command builds with. One plugin, one module,
 * two surfaces.
 */

const sidecarPort = process.env[PORT_ENV_VAR]?.trim() || String(DEFAULT_PORT)

/**
 * The project the editor is open on, or null.
 *
 * Null is an ordinary state rather than a failure: `npm run dev` starts this
 * config with no project at all, and a build of the editor itself has none
 * either. The game's systems are simply an empty list, and every refusal about a
 * missing folder stays where it already is, in the launcher.
 */
const projectPath = ((): string | null => {
  const raw = process.env[PROJECT_ENV_VAR]?.trim()
  if (raw === undefined || raw === '') return null
  try {
    return fs.realpathSync(path.resolve(raw))
  } catch {
    return null
  }
})()

export default defineConfig({
  root: 'editor',
  plugins: [react(), gameCode({ projectPath })],
  server: {
    host: EDITOR_HOST,
    port: resolveEditorPort(process.env),
    // A busy port should say so, not quietly move the editor somewhere the
    // launcher's banner and the test harness are not looking.
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${SIDECAR_HOST}:${sidecarPort}`,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: '../dist/editor',
    emptyOutDir: true,
  },
})
