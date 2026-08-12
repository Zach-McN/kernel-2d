import { describe, expect, it } from 'vitest'

import { SIDECAR_HOST } from '../../sidecar/config.js'
import { startServer } from '../../sidecar/server.js'
import { SidecarStatusSchema, type SidecarStatus } from '../../sidecar/status-schema.js'
import { makeTempProject } from '../fixtures/project-fixture.js'

/**
 * The round-trip tripwire (editor-kernel G1) for the format the editor reads to
 * learn which project it is looking at.
 */
describe('the sidecar status format survives a round trip', () => {
  const status: SidecarStatus = {
    format: 'kernel2d.sidecar-status',
    version: 1,
    projectPath: 'C:/games/my-game',
    projectName: 'my-game',
    endpoints: { tree: '/tree', events: '/events', meta: '/meta' },
  }

  it('reads back identical to what was written', () => {
    const roundTripped = SidecarStatusSchema.parse(JSON.parse(JSON.stringify(status)))

    expect(roundTripped).toEqual(status)
  })

  it('survives the trip over the wire, not just through memory', async () => {
    const project = await makeTempProject({ 'scenes/level-01.json': '{}' })
    const server = await startServer({ projectPath: project.root, host: SIDECAR_HOST, port: 0 })

    try {
      const served = SidecarStatusSchema.parse(await (await fetch(`${server.url}/`)).json())

      expect(served.projectName).toBe(project.root.split(/[\\/]/).at(-1))
      expect(served.projectPath).not.toContain('\\')
      expect(SidecarStatusSchema.parse(JSON.parse(JSON.stringify(served)))).toEqual(served)
    } finally {
      await server.close()
      await project.cleanup()
    }
  })
})

describe('the sidecar status format rejects what it should', () => {
  const valid = {
    format: 'kernel2d.sidecar-status',
    version: 1,
    projectPath: 'C:/games/my-game',
    projectName: 'my-game',
    endpoints: { tree: '/tree', events: '/events', meta: '/meta' },
  }

  it('accepts a well-formed status written by hand', () => {
    expect(() => SidecarStatusSchema.parse(valid)).not.toThrow()
  })

  it('rejects a status from a format version it does not know', () => {
    expect(() => SidecarStatusSchema.parse({ ...valid, version: 2 })).toThrow()
  })

  it('rejects a status with no project named', () => {
    expect(() => SidecarStatusSchema.parse({ ...valid, projectName: '' })).toThrow()
  })

  it('rejects some other service answering on the same port', () => {
    expect(() => SidecarStatusSchema.parse({ status: 'ok', service: 'something else' })).toThrow()
  })
})
