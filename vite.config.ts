import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { EDITOR_HOST, resolveEditorPort } from './scripts/editor-server.js'
import { DEFAULT_PORT, PORT_ENV_VAR, SIDECAR_HOST } from './sidecar/config.js'

/**
 * The editor window. `editor/` is the Vite root, so `editor/index.html` is the
 * page and everything it imports is the app.
 *
 * The browser reaches the sidecar through `/api`, proxied here. That keeps the
 * sidecar's port out of the editor's code entirely — the launcher tells this
 * config which port it chose, and the editor just asks its own origin.
 */

const sidecarPort = process.env[PORT_ENV_VAR]?.trim() || String(DEFAULT_PORT)

export default defineConfig({
  root: 'editor',
  plugins: [react()],
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
