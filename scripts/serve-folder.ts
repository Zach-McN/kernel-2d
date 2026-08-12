import fs from 'node:fs'
import { createReadStream } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * A folder, served over http, so an exported game can be looked at.
 *
 * It exists because of a browser rule rather than a shortfall in the export: a page
 * opened straight off the disk gets its own opaque origin, so it may not read the
 * files beside it and may not put an image from one of them onto the graphics card.
 * A web game is served or it is nothing. This is the shortest honest way to do that
 * locally, and it is what the browser suite uses to open an export as well.
 *
 * **It is not part of an export.** The folder an export produces is static files and
 * nothing else — no service, no server, no editor — which is what makes it uploadable
 * to any host and inspectable by eye. This lives in the kernel, beside the command
 * that produced the folder, and is development-only like everything else in
 * `scripts/`.
 *
 * The read privilege is narrow on purpose, and stated in full because that is the
 * discipline every reading surface in this repo is held to (`editor-kernel` D21):
 * anything under the folder it was pointed at, resolved and checked to still be
 * inside it; never a path that climbs out; never a directory listing; and a content
 * type from the extension, never guessed from the bytes.
 *
 * The content types are its own rather than the filesystem service's. That map is the
 * written statement of which files the *editor* will hand over, and widening it to
 * cover pages and scripts so this could borrow it would damage the one place that
 * answer is recorded.
 */

/** The npm script that runs this, named once so a printed instruction cannot go stale. */
export const SERVE_SCRIPT = 'serve'

/** Loopback only. It serves a folder off somebody's disk; it has no business on the LAN. */
export const SERVE_HOST = '127.0.0.1'
export const DEFAULT_SERVE_PORT = 5175

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.meta': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',

  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',

  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',

  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const OCTET_STREAM = 'application/octet-stream'

export interface ServeOptions {
  /** Absolute path to the folder to serve. */
  root: string
  host?: string
  /** 0 asks the operating system for any free port — used by the tests. */
  port?: number
}

export interface ServeHandle {
  port: number
  /** e.g. `http://127.0.0.1:5175` */
  url: string
  close: () => Promise<void>
}

export function startStaticServer(options: ServeOptions): Promise<ServeHandle> {
  const root = fs.realpathSync(options.root)
  const host = options.host ?? SERVE_HOST
  const port = options.port ?? DEFAULT_SERVE_PORT

  const server = http.createServer((request, response) => {
    void handle(root, request, response)
  })

  return new Promise<ServeHandle>((resolve, reject) => {
    const onStartupError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening)
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `Port ${String(port)} is already in use. Serve this folder on a different port with: ` +
                `npm run ${SERVE_SCRIPT} -- <folder> --port ${String(port + 1)}`,
            )
          : error,
      )
    }

    const onListening = (): void => {
      server.removeListener('error', onStartupError)
      const address = server.address() as AddressInfo
      let closed = false

      resolve({
        port: address.port,
        url: `http://${host}:${String(address.port)}`,
        close: () =>
          new Promise<void>((done, fail) => {
            if (closed) {
              done()
              return
            }
            closed = true
            server.close((error) => (error ? fail(error) : done()))
          }),
      })
    }

    server.once('error', onStartupError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

async function handle(
  root: string,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Only GET is served here.')
    return
  }

  const url = new URL(request.url ?? '/', 'http://localhost')
  const requested = decodeURIComponent(url.pathname)
  // A folder means its page, which is the one convention a static server needs.
  const relative = requested.endsWith('/') ? `${requested}index.html` : requested

  const absolute = path.resolve(root, `.${relative}`)

  // The check is on the resolved path, so `..` and an encoded separator are the same
  // question and get the same answer.
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    send(response, 403, 'That is outside the folder being served.')
    return
  }

  let size: number
  try {
    const stats = fs.statSync(absolute)
    if (stats.isDirectory()) {
      send(response, 404, 'There is no page at that address.')
      return
    }
    size = stats.size
  } catch {
    send(response, 404, `There is nothing at ${requested}.`)
    return
  }

  response.writeHead(200, {
    'Content-Type': CONTENT_TYPE_BY_EXTENSION[path.extname(absolute).toLowerCase()] ?? OCTET_STREAM,
    'Content-Length': String(size),
    // The folder on disk is the record. Nothing here should be able to serve a
    // stale page after a re-export.
    'Cache-Control': 'no-store',
  })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  try {
    await pipeline(createReadStream(absolute), response)
  } catch {
    // The headers are out, so there is no status left to change: the browser sees a
    // short body and reports a failed load, which is the truth. The usual cause is
    // the reader hanging up, which is not worth logging.
    response.destroy()
  }
}

function send(response: http.ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`${message}\n`)
}
