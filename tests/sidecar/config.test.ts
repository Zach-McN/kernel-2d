import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PORT, PORT_ENV_VAR, SIDECAR_HOST, resolveConfig } from '../../sidecar/config.js'
import { makeTempProject, type TempProject } from '../fixtures/project-fixture.js'

describe('starting the sidecar against a project folder', () => {
  let project: TempProject

  beforeEach(async () => {
    project = await makeTempProject({ 'scenes/level-01.json': '{}' })
  })

  afterEach(async () => {
    await project.cleanup()
  })

  it('accepts a folder and reports it back, on the default port and loopback only', () => {
    const result = resolveConfig([project.root], {}, process.cwd())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.projectPath).toBe(project.root)
    expect(result.config.projectName).toBe(path.basename(project.root))
    expect(result.config.port).toBe(DEFAULT_PORT)
    expect(result.config.host).toBe(SIDECAR_HOST)
  })

  it('shows the watched folder with forward slashes, whatever the operating system uses', () => {
    const result = resolveConfig([project.root], {}, process.cwd())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.displayPath).not.toContain('\\')
    expect(result.config.displayPath.endsWith(path.basename(project.root))).toBe(true)
  })

  it('resolves a folder given relative to where the command was run', () => {
    const parent = path.dirname(project.root)
    const result = resolveConfig([path.basename(project.root)], {}, parent)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.projectPath).toBe(project.root)
  })

  it('refuses to start, with a plain explanation, when no folder is given', () => {
    const result = resolveConfig([], {}, process.cwd())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('No project folder given')
    expect(result.message).toContain('Usage')
  })

  it('refuses to start when the folder does not exist, and names the path it looked for', () => {
    const missing = path.join(project.root, 'no-such-folder')
    const result = resolveConfig([missing], {}, process.cwd())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Project folder not found')
    expect(result.message).toContain('no-such-folder')
  })

  it('refuses to start when handed a file instead of a folder', () => {
    const result = resolveConfig([project.file('scenes/level-01.json')], {}, process.cwd())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Not a folder')
  })

  it('refuses to watch two folders at once', () => {
    const result = resolveConfig([project.root, project.root], {}, process.cwd())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('one project folder at a time')
  })

  it('rejects options it does not understand instead of ignoring them', () => {
    const result = resolveConfig([project.root, '--watch-everything'], {}, process.cwd())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Unknown option')
  })
})

describe('choosing the port', () => {
  let project: TempProject

  beforeEach(async () => {
    project = await makeTempProject()
  })

  afterEach(async () => {
    await project.cleanup()
  })

  it.each([
    ['--port 8080', ['--port', '8080']],
    ['--port=8080', ['--port=8080']],
  ])('takes the port from %s', (_label, portArgs) => {
    const result = resolveConfig([project.root, ...portArgs], {}, process.cwd())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.port).toBe(8080)
  })

  it('takes the port from the environment when the command line does not say', () => {
    const result = resolveConfig([project.root], { [PORT_ENV_VAR]: '9001' }, process.cwd())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.port).toBe(9001)
  })

  it('lets the command line override the environment', () => {
    const result = resolveConfig([project.root, '--port', '8080'], { [PORT_ENV_VAR]: '9001' }, process.cwd())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.port).toBe(8080)
  })

  it.each(['abc', '-1', '70000', '80.5'])('refuses to start on a nonsense port: %s', (badPort) => {
    const result = resolveConfig([project.root, `--port=${badPort}`], {}, process.cwd())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Port must be a whole number')
  })

  it('refuses to start when --port is given with nothing after it', () => {
    const result = resolveConfig([project.root, '--port'], {}, process.cwd())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('--port needs a number')
  })
})
