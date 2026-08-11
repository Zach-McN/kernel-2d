import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { scanProject } from './scan.js'
import { toPosixPath } from './paths.js'

export interface ServerOptions {
  projectPath: string
  host: string
  /** 0 asks the operating system for any free port — used by the tests. */
  port: number
}

export interface ServerHandle {
  port: number
  /** e.g. `http://127.0.0.1:7331` */
  url: string
  close: () => Promise<void>
}

export function startServer(options: ServerOptions): Promise<ServerHandle> {
  const server = http.createServer((request, response) => {
    void handleRequest(options, request, response)
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
      resolve({
        port: address.port,
        url,
        close: () =>
          new Promise<void>((done, fail) => {
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
  options: ServerOptions,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed', method: request.method ?? null })
    return
  }

  const pathname = new URL(request.url ?? '/', `http://${options.host}`).pathname

  if (pathname === '/') {
    sendJson(response, 200, {
      name: 'kernel-2d sidecar',
      project: toPosixPath(options.projectPath),
      endpoints: { tree: '/tree' },
    })
    return
  }

  if (pathname === '/tree') {
    try {
      sendJson(response, 200, await scanProject(options.projectPath))
    } catch (error) {
      sendJson(response, 500, {
        error: 'Could not read the project folder',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }

  sendJson(response, 404, { error: 'Not found', path: pathname })
}

/** Pretty-printed so the tree URL is readable straight in a browser window. */
function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(`${JSON.stringify(body, null, 2)}\n`)
}
