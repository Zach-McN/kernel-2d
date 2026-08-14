import { createServer, type ViteDevServer } from 'vite'

import { PORT_ENV_VAR, PROJECT_ENV_VAR, type SidecarConfig } from '../../sidecar/config.js'
import { startSidecar } from '../../sidecar/start.js'
import { EDITOR_PORT_ENV_VAR } from '../editor-server.js'

/**
 * Starting the editor: the Vite dev server that serves the window, and the
 * sidecar that owns the disk, as one process.
 *
 * Extracted the day a second command needed to open the editor — the
 * screenshot tool (`scripts/shot.ts`). Two copies of a startup sequence is how
 * a tool ends up testing something subtly unlike what the human runs; this way
 * a picture of the editor is a picture of the editor.
 */

export interface RunningEditor {
  /** Where the window is, for a banner or for a browser to be pointed at. */
  url: string
  close: () => Promise<void>
}

export interface StartOptions {
  /** Whether starting it also opens a browser. */
  open: boolean
  /**
   * The window's port, when the caller needs one that is not the default. The
   * sidecar's is `config.port`, and the two are always chosen together.
   */
  port?: number
}

/**
 * Both halves, or neither.
 *
 * Vite comes up first so its address can go in the sidecar's banner, and a
 * sidecar that refuses to start takes the window down with it rather than
 * leaving a half-started editor pointed at nothing.
 *
 * **The browser is opened last, deliberately.** Letting Vite open it as part of
 * starting means the page loads while the sidecar is still sweeping `.meta`
 * files, its first call is proxied to a port nothing is listening on yet, and
 * the terminal prints `http proxy error: ECONNREFUSED` above the banner. The
 * editor recovers on its own — it has a connecting state and retries — so the
 * error is a lie about a working editor, which is the worst kind to leave in a
 * launcher a human reads.
 */
export async function startEditor(config: SidecarConfig, options: StartOptions): Promise<RunningEditor> {
  // The editor talks to the sidecar through Vite's proxy, so the browser never
  // needs to know this port. Vite does, and this is how it is told.
  process.env[PORT_ENV_VAR] = String(config.port)

  // And the same for the project folder, which Vite needs for a different reason:
  // the game's own code is compiled into the preview from there. Written back as
  // the resolved, symlink-free path the caller already worked out, so the config
  // and the filesystem service are looking at the same folder rather than at two
  // spellings of it.
  process.env[PROJECT_ENV_VAR] = config.projectPath

  if (options.port !== undefined) process.env[EDITOR_PORT_ENV_VAR] = String(options.port)

  const editor: ViteDevServer = await createServer({
    // Vite's own startup box is replaced by the sidecar banner, so starting the
    // editor prints one thing rather than two.
    logLevel: 'warn',
    server: { open: false },
  })
  await editor.listen()

  const url = editor.resolvedUrls?.local[0] ?? `http://localhost:${editor.config.server.port ?? ''}`

  try {
    const sidecar = await startSidecar(config, { editorUrl: url })

    // Now, and not before: the page's first call to the sidecar is answered by
    // a sidecar that exists.
    if (options.open) editor.openBrowser()

    return {
      url,
      close: async () => {
        await Promise.allSettled([editor.close(), sidecar.close()])
      },
    }
  } catch (error) {
    await editor.close()
    throw error
  }
}
