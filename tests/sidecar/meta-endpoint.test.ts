import { describe, expect, it } from 'vitest'

import { SIDECAR_HOST } from '../../sidecar/config.js'
import { sweepProjectMetas } from '../../sidecar/meta-files.js'
import { MetaViewSchema, type MetaView } from '../../sidecar/meta-view-schema.js'
import { startServer, type ServerHandle } from '../../sidecar/server.js'
import { SidecarStatusSchema } from '../../sidecar/status-schema.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

/**
 * The answer the Inspector actually receives, over the wire.
 *
 * The round trip is checked here as well as in memory, because this format only
 * ever exists as a served answer — if it survives memory but not JSON, nothing
 * else in the suite would notice (editor-verification V7, text-formats T4).
 */

const SAMPLE = {
  'assets/textures/knight.png': 'pretend-png',
  'assets/source/README.txt': 'originals live here',
  'assets/textures/gone.png.meta': '{ "format": "kernel2d.asset-meta", "version": 1 }',
  'scenes/level-01.json': '{}',
}

async function withServer<T>(
  body: (ask: (path: string) => Promise<Response>, project: TempProject) => Promise<T>,
): Promise<T> {
  const project = await makeTempProject(SAMPLE)
  await sweepProjectMetas(project.root)

  let server: ServerHandle | null = null
  try {
    server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })
    const url = server.url
    return await body((path) => fetch(`${url}/meta?path=${encodeURIComponent(path)}`), project)
  } finally {
    await server?.close()
    await project.cleanup()
  }
}

const view = async (response: Response): Promise<MetaView> => MetaViewSchema.parse(await response.json())

describe('asking the editor service what one file holds', () => {
  it('hands back the settings of an asset that has them', async () => {
    await withServer(async (ask) => {
      const answer = await view(await ask('assets/textures/knight.png'))

      expect(answer.status).toBe('ok')
      expect(answer.meta?.type).toBe('texture')
      expect(answer.meta?.importSettings).toEqual({
        type: 'texture',
        filter: 'nearest',
        pivot: { x: 0.5, y: 0.5 },
        slice: { mode: 'single' },
      })
    })
  })

  it('survives the trip over the wire, not just through memory', async () => {
    await withServer(async (ask) => {
      const answer = await view(await ask('assets/textures/knight.png'))

      expect(MetaViewSchema.parse(JSON.parse(JSON.stringify(answer)))).toEqual(answer)
    })
  })

  it('says plainly that a file the editor does not import has no settings', async () => {
    await withServer(async (ask) => {
      const answer = await view(await ask('scenes/level-01.json'))

      expect(answer.status).toBe('none')
      expect(answer.metaPath).toBeNull()
      expect(answer.meta).toBeNull()
    })
  })

  // No startup sweep in this one: the sweep is what clears strays out, so a
  // folder it has already been through has none left to ask about.
  it('answers about a stranded sidecar asked for by its own name', async () => {
    const project = await makeTempProject(SAMPLE)
    const server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })

    try {
      const response = await fetch(`${server.url}/meta?path=assets%2Ftextures%2Fgone.png.meta`)
      const answer = await view(response)

      expect(answer.metaPath).toBe('assets/textures/gone.png.meta')
      expect(answer.status).toBe('unreadable')
      expect(answer.problem).toContain('format this editor knows')
      expect(answer.text).toContain('kernel2d.asset-meta')
    } finally {
      await server.close()
      await project.cleanup()
    }
  })

  it('advertises itself alongside the other endpoints, so nothing has to guess', async () => {
    const project = await makeTempProject(SAMPLE)
    const server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })

    try {
      const status = SidecarStatusSchema.parse(await (await fetch(`${server.url}/`)).json())

      expect(status.endpoints.meta).toBe('/meta')
    } finally {
      await server.close()
      await project.cleanup()
    }
  })
})

describe('the editor service refuses a path it has no business reading', () => {
  it.each([
    ['a step out of the project folder', '../../secrets.txt'],
    ['a step out in the middle of one', 'assets/../../secrets.txt'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows absolute path', 'C:\\Windows\\System32\\config'],
    ['a folder it never reads', 'node_modules/thing/index.js'],
    ['no path at all', ''],
  ])('refuses %s, with a reason rather than a stack trace', async (_description, path) => {
    await withServer(async (ask) => {
      const response = await ask(path)
      const body = (await response.json()) as { error?: string }

      expect(response.status).toBe(400)
      expect(body.error ?? '').toMatch(/^[A-Z].*\.$/)
    })
  })
})
