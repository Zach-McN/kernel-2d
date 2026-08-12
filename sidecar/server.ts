import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { toFileEventMessage } from './event-schema.js'
import { createEventFeed, type EventFeed } from './feed.js'
import { BadPathError, readMetaView } from './meta-files.js'
import { scanProject } from './scan.js'
import { toPosixPath } from './paths.js'
import { SIDECAR_STATUS_FORMAT, SIDECAR_STATUS_VERSION, type SidecarStatus } from './status-schema.js'

export interface ServerOptions {
  projectPath: string
  host: string
  /** 0 asks the operating system for any free port — used by the tests. */
  port: number
  /** Where change events arrive from. Defaults to a feed nobody publishes to. */
  feed?: EventFeed
}

export interface ServerHandle {
  port: number
  /** e.g. `http://127.0.0.1:7331` */
  url: string
  close: () => Promise<void>
}

/**
 * How often a comment is written down an idle change stream. Nothing reads it;
 * it exists so a proxy or a sleeping network stack does not decide a quiet
 * connection is a dead one.
 */
const HEARTBEAT_MS = 15_000

interface ServerContext {
  options: ServerOptions
  feed: EventFeed
  /** Every open change stream, so the server can end them when it shuts down. */
  streams: Set<() => void>
}

export function startServer(options: ServerOptions): Promise<ServerHandle> {
  const context: ServerContext = {
    options,
    feed: options.feed ?? createEventFeed(),
    streams: new Set(),
  }

  const server = http.createServer((request, response) => {
    void handleRequest(context, request, response)
  })

  return new Promise<ServerHandle>((resolve, reject) => {
    const onStartupError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening)
      reject(startupError(options, error))
    }

    const onListening = (): void => {
      server.removeListener('error', onStartupError)
      const address = server.address() as AddressInfo
      const url = `http://${options.host}:${address.port}`
      let closed = false

      resolve({
        port: address.port,
        url,
        close: () =>
          new Promise<void>((done, fail) => {
            // Shutting down twice is a normal race between a signal handler and
            // whatever else decided to stop, not a fault worth reporting.
            if (closed) {
              done()
              return
            }
            closed = true
            // A change stream is a response that never ends on its own, so
            // closing the server without ending them first waits forever.
            for (const endStream of [...context.streams]) endStream()
            server.close((error) => (error ? fail(error) : done()))
          }),
      })
    }

    server.once('error', onStartupError)
    server.once('listening', onListening)
    server.listen(options.port, options.host)
  })
}

function startupError(options: ServerOptions, error: NodeJS.ErrnoException): Error {
  if (error.code === 'EADDRINUSE') {
    return new Error(
      `Port ${options.port} is already in use — another sidecar may still be running. ` +
        `Start this one on a different port with: npm run sidecar -- <project> --port 7332`,
    )
  }
  return error
}

async function handleRequest(
  context: ServerContext,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed', method: request.method ?? null })
    return
  }

  const url = new URL(request.url ?? '/', `http://${context.options.host}`)
  const pathname = url.pathname

  if (pathname === '/') {
    sendJson(response, 200, statusOf(context.options))
    return
  }

  if (pathname === '/tree') {
    try {
      sendJson(response, 200, await scanProject(context.options.projectPath))
    } catch (error) {
      sendJson(response, 500, {
        error: 'Could not read the project folder',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }

  if (pathname === '/meta') {
    // A missing parameter is answered the same way a bad one is: this endpoint
    // only ever speaks about one named file.
    const requested = url.searchParams.get('path') ?? ''
    try {
      sendJson(response, 200, await readMetaView(context.options.projectPath, requested))
    } catch (error) {
      if (error instanceof BadPathError) {
        sendJson(response, 400, { error: error.message, path: requested })
        return
      }
      sendJson(response, 500, {
        error: 'Could not read the import settings for that file',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }

  if (pathname === '/events') {
    streamEvents(context, request, response)
    return
  }

  sendJson(response, 404, { error: 'Not found', path: pathname })
}

/**
 * The change feed, as server-sent events.
 *
 * One direction only — the sidecar tells the editor what moved — which is
 * exactly the shape of the problem, and it costs no dependency and no
 * reconnect logic: the browser's own EventSource retries by itself.
 */
function streamEvents(
  context: ServerContext,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // Dev proxies buffer responses by default, which would hold every change
    // back until enough bytes had piled up to be worth forwarding.
    'X-Accel-Buffering': 'no',
  })

  // Flushes the headers straight away, so a listener knows it is connected now
  // rather than when the folder first changes.
  response.write(': connected\n\n')

  const unsubscribe = context.feed.subscribe((event) => {
    response.write(`data: ${JSON.stringify(toFileEventMessage(event))}\n\n`)
  })

  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), HEARTBEAT_MS)
  // Never a reason for a heartbeat to hold the process open.
  heartbeat.unref()

  const endStream = (): void => {
    if (!context.streams.delete(endStream)) return
    clearInterval(heartbeat)
    unsubscribe()
    response.end()
  }

  context.streams.add(endStream)
  request.on('close', endStream)
}

/** Who this sidecar is and which folder it is holding open. */
function statusOf(options: ServerOptions): SidecarStatus {
  return {
    format: SIDECAR_STATUS_FORMAT,
    version: SIDECAR_STATUS_VERSION,
    projectPath: toPosixPath(options.projectPath),
    projectName: path.basename(options.projectPath),
    endpoints: { tree: '/tree', events: '/events', meta: '/meta' },
  }
}

/** Pretty-printed so the tree URL is readable straight in a browser window. */
function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(`${JSON.stringify(body, null, 2)}\n`)
}
