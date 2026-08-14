import { createReadStream } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { NotFoundError, resolveAssetBytes } from './asset-files.js'
import { createDocumentFor, readDocumentView, writeDocumentFor } from './document-files.js'
import { toFileEventMessage } from './event-schema.js'
import { deleteFile, moveFile } from './file-operations.js'
import { createEventFeed, type EventFeed } from './feed.js'
import { RefusedError, readMetaView, writeMetaFor } from './meta-files.js'
import { guardRefusal } from './request-guard.js'
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

/**
 * The largest body this service will read, per kind of thing being written.
 *
 * Reading an unbounded body from a socket is how a service is talked into
 * exhausting its own memory, so both are capped — but they are capped
 * separately because they are different sizes of thing. A `.meta` is a handful
 * of settings and anything approaching 64KB is not one. A scene is a level, and
 * a level with thousands of entities in it is a large file rather than a
 * mistake, so the cap there is a backstop rather than a statement about what is
 * reasonable.
 */
const MAX_META_BYTES = 64 * 1024
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

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
  const url = new URL(request.url ?? '/', `http://${context.options.host}`)
  const pathname = url.pathname

  // Who may ask, before what is asked. The loopback bind bounds who can
  // connect, not who can instruct — any web page in any browser on this
  // machine can aim a blind POST at this port. The whole rule and its reasons
  // are stated at the top of `request-guard.ts` and not restated here.
  const refused = guardRefusal(request.method ?? 'GET', request.headers)
  if (refused !== null) {
    sendJson(response, 403, { error: refused })
    return
  }

  // Reading is open. Writing is five requests and nothing else: two PUTs that
  // each replace one named thing, one POST that makes one document where there
  // was nothing, and two POSTs that each do one thing to one named file. They
  // are the only non-GETs this service answers at all.
  //
  // Every one of them is its own route rather than a mode of another, and the
  // reason is worth knowing before adding a sixth: kept apart, the create
  // refuses when anything is there, the replace refuses when nothing is, the
  // move refuses when the destination is taken and the delete never touches a
  // folder — so a confused caller gets a sentence instead of a destroyed level.
  // The whole of what each will and will not do is stated at the top of
  // `document-files.ts` and `file-operations.ts` and is not restated here; two
  // copies of a privilege is how one of them quietly gets wider than the other.
  if (request.method === 'PUT' && pathname === '/meta') {
    await handleMetaWrite(context, request, response, url)
    return
  }

  if (request.method === 'PUT' && pathname === '/document') {
    await handleDocumentWrite(context, request, response, url, 'replace')
    return
  }

  if (request.method === 'POST' && pathname === '/document') {
    await handleDocumentWrite(context, request, response, url, 'create')
    return
  }

  if (request.method === 'POST' && pathname === '/move') {
    await handleFileOperation(context, response, url, 'move')
    return
  }

  if (request.method === 'POST' && pathname === '/delete') {
    await handleFileOperation(context, response, url, 'delete')
    return
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed', method: request.method ?? null })
    return
  }

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
      if (error instanceof RefusedError) {
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

  if (pathname === '/document') {
    const requested = url.searchParams.get('path') ?? ''
    try {
      sendJson(response, 200, await readDocumentView(context.options.projectPath, requested))
    } catch (error) {
      if (error instanceof RefusedError) {
        sendJson(response, 400, { error: error.message, path: requested })
        return
      }
      sendJson(response, 500, {
        error: 'Could not read the document at that path',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }

  if (pathname === '/asset') {
    await handleAssetRead(context, response, url)
    return
  }

  if (pathname === '/events') {
    streamEvents(context, request, response)
    return
  }

  sendJson(response, 404, { error: 'Not found', path: pathname })
}

/**
 * The editor asking for the bytes of one asset, so the runtime can draw it.
 *
 * Streamed rather than read into memory: a 4K texture is tens of megabytes, and
 * this service should not grow a heap the size of somebody's art folder. The
 * rule about which files this will and will not hand over is stated in full at
 * the top of `asset-files.ts` — it is not restated here, because two copies of
 * a privilege is how one of them quietly gets wider than the other.
 *
 * Never cached. The file on disk is the record, and the editor is expected to
 * show a re-saved texture within the second.
 */
async function handleAssetRead(
  context: ServerContext,
  response: http.ServerResponse,
  url: URL,
): Promise<void> {
  const requested = url.searchParams.get('path') ?? ''

  let asset
  try {
    asset = await resolveAssetBytes(context.options.projectPath, requested)
  } catch (error) {
    if (error instanceof NotFoundError) {
      sendJson(response, 404, { error: error.message, path: requested })
      return
    }
    if (error instanceof RefusedError) {
      sendJson(response, 400, { error: error.message, path: requested })
      return
    }
    sendJson(response, 500, {
      error: 'Could not read that file',
      detail: error instanceof Error ? error.message : String(error),
    })
    return
  }

  response.writeHead(200, {
    'Content-Type': asset.contentType,
    'Content-Length': String(asset.size),
    'Cache-Control': 'no-store',
  })

  try {
    await pipeline(createReadStream(asset.absolutePath), response)
  } catch {
    // The headers are already out, so there is no status left to change: the
    // browser sees a short body and reports a failed load, which is the truth.
    // The common cause is the reader hanging up mid-download, which is not a
    // fault worth logging.
    response.destroy()
  }
}

/**
 * The editor asking for one set of import settings to be replaced.
 *
 * Every refusal is a 400 carrying one plain sentence, because this answer is
 * shown to a human rather than logged: a validator dump would tell them nothing
 * they could act on. Nothing on disk is touched unless the whole document was
 * understood first.
 */
async function handleMetaWrite(
  context: ServerContext,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
): Promise<void> {
  const requested = url.searchParams.get('path') ?? ''

  let document: unknown
  try {
    document = JSON.parse(await readBody(request, MAX_META_BYTES))
  } catch (error) {
    sendJson(response, 400, {
      error: `Those import settings did not arrive as readable JSON: ${(error as Error).message}.`,
      path: requested,
    })
    return
  }

  try {
    sendJson(response, 200, await writeMetaFor(context.options.projectPath, requested, document))
  } catch (error) {
    if (error instanceof RefusedError) {
      sendJson(response, 400, { error: error.message, path: requested })
      return
    }
    sendJson(response, 500, {
      error: 'Could not write the import settings for that file',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The editor asking for one document to be made, or one to be replaced.
 *
 * The same shape as the `.meta` write and held to the same discipline: every
 * refusal is a 400 carrying one plain sentence meant for a human, and nothing on
 * disk is touched unless the whole document was understood first. What each of
 * the two will and will not do is stated in full at the top of
 * `document-files.ts` and is not restated here — two copies of a privilege is
 * how one of them quietly gets wider than the other.
 */
async function handleDocumentWrite(
  context: ServerContext,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  intent: 'create' | 'replace',
): Promise<void> {
  const requested = url.searchParams.get('path') ?? ''

  let document: unknown
  try {
    document = JSON.parse(await readBody(request, MAX_DOCUMENT_BYTES))
  } catch (error) {
    sendJson(response, 400, {
      error: `That document did not arrive as readable JSON: ${(error as Error).message}.`,
      path: requested,
    })
    return
  }

  const apply = intent === 'create' ? createDocumentFor : writeDocumentFor

  try {
    sendJson(response, intent === 'create' ? 201 : 200, await apply(context.options.projectPath, requested, document))
  } catch (error) {
    if (error instanceof RefusedError) {
      sendJson(response, 400, { error: error.message, path: requested })
      return
    }
    sendJson(response, 500, {
      error: intent === 'create' ? 'Could not make a document at that path' : 'Could not write the document at that path',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The editor asking for one file to be moved, or one to be deleted.
 *
 * No body at all: both requests are entirely described by the paths they name,
 * and a body would be a place for a caller to put something this service would
 * then have to decide whether to believe. Every refusal is a 400 carrying one
 * plain sentence, because it is shown to a human against the file they picked.
 *
 * The two are separate routes for D22's reason, and the reason survives being
 * restated: kept apart, neither can do the other's job however confused the
 * caller is.
 */
async function handleFileOperation(
  context: ServerContext,
  response: http.ServerResponse,
  url: URL,
  intent: 'move' | 'delete',
): Promise<void> {
  const requested = url.searchParams.get('path') ?? ''
  const destination = url.searchParams.get('to') ?? ''

  try {
    const change =
      intent === 'move'
        ? await moveFile(context.options.projectPath, requested, destination)
        : await deleteFile(context.options.projectPath, requested)
    sendJson(response, 200, change)
  } catch (error) {
    if (error instanceof RefusedError) {
      sendJson(response, 400, { error: error.message, path: requested })
      return
    }
    sendJson(response, 500, {
      error: intent === 'move' ? 'Could not move that file' : 'Could not delete that file',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

function readBody(request: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        // Stop reading rather than keep accepting bytes that will be thrown
        // away: the point of the cap is to bound what is held, not to count it.
        request.destroy()
        reject(new Error(`that is larger than the ${maxBytes} bytes this endpoint accepts`))
        return
      }
      chunks.push(chunk)
    })

    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
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
    endpoints: {
      tree: '/tree',
      events: '/events',
      meta: '/meta',
      document: '/document',
      asset: '/asset',
      move: '/move',
      delete: '/delete',
    },
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
