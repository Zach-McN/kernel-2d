import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SIDECAR_HOST } from '../../sidecar/config.js'
import { scanProject } from '../../sidecar/scan.js'
import { startServer, type ServerHandle } from '../../sidecar/server.js'
import { ProjectTreeSchema } from '../../sidecar/tree-schema.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

describe('looking at the project through a browser', () => {
  let project: TempProject
  let server: ServerHandle

  beforeEach(async () => {
    project = await makeTempProject({
      'README.md': '# sample',
      'assets/textures/knight.png': 'pretend-png-bytes',
      'scenes/level-01.json': '{}',
    })
    // Port 0 asks the operating system for a free port, so tests never collide
    // with a sidecar the human has running.
    server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })
  })

  afterEach(async () => {
    await server.close()
    await project.cleanup()
  })

  it('serves the whole project tree at one URL', async () => {
    const response = await fetch(`${server.url}/tree`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')

    const parsed = ProjectTreeSchema.parse(await response.json())
    expect(parsed).toEqual(await scanProject(project.root))
  })

  it('sends the tree indented, so it is readable raw in a browser window', async () => {
    const body = await (await fetch(`${server.url}/tree`)).text()
    const lines = body.split('\n')

    expect(body.startsWith('{\n  "format"')).toBe(true)
    expect(lines.length).toBeGreaterThan(20)
    // Nested folders and files are indented further than the top level.
    expect(lines.some((line) => line.startsWith('        "'))).toBe(true)
  })

  it('shows what happened since the last look, rather than a cached answer', async () => {
    const before = await (await fetch(`${server.url}/tree`)).json()
    expect(ProjectTreeSchema.parse(before).fileCount).toBe(3)

    await makeFile(project, 'scenes/level-02.json')

    const after = ProjectTreeSchema.parse(await (await fetch(`${server.url}/tree`)).json())
    expect(after.fileCount).toBe(4)
  })

  it('points a visitor at the tree from the front page', async () => {
    const response = await fetch(`${server.url}/`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ endpoints: { tree: '/tree' } })
  })

  it('answers plainly when asked for something that is not there', async () => {
    const response = await fetch(`${server.url}/scenes`)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Not found' })
  })

  it('refuses anything but a read', async () => {
    const response = await fetch(`${server.url}/tree`, { method: 'POST' })

    expect(response.status).toBe(405)
  })

  it('listens on this machine only', () => {
    expect(server.url.startsWith('http://127.0.0.1:')).toBe(true)
  })
})

describe('starting the server when the port is taken', () => {
  it('explains the clash instead of crashing with a stack trace', async () => {
    const project = await makeTempProject()
    const first = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })

    try {
      await expect(
        startServer({ projectPath: project.root, host: SIDECAR_HOST, port: first.port }),
      ).rejects.toThrow(/already in use/)
    } finally {
      await first.close()
      await project.cleanup()
    }
  })
})

async function makeFile(project: TempProject, relativePath: string): Promise<void> {
  const fs = await import('node:fs/promises')
  await fs.writeFile(project.file(relativePath), '{}')
}
