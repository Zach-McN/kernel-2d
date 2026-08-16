import fs from 'node:fs/promises'
import path from 'node:path'

import type { ProjectReader } from '../../runtime/scene/load-scene.js'
import { messageOf } from '../../runtime/message-of.js'

/**
 * The runtime's `ProjectReader`, over a folder on this machine.
 *
 * The third answer to the same two questions, and the plainest: the editor's reads
 * out of a development service and takes a `.meta` suffix off on the way past
 * (`editor/shell/project-reader.ts`), the shipped game's reads out of `fetch`
 * (`runtime/web/start-game.ts`), and this one reads the file.
 *
 * It exists so the export command can validate a project **with the loader the game
 * will use** rather than with a second opinion about what a level reaches. Anything
 * else would be two derivations of "which files does this game need", and the one
 * that is wrong would be the one nobody runs until somebody opens the folder.
 *
 * The version is a constant, for the same reason the shipped game's is: nothing
 * changes underneath a build.
 */
export function nodeProjectReader(projectPath: string): ProjectReader {
  return {
    readJson: async (relativePath) => {
      const absolute = path.join(projectPath, relativePath.replaceAll('/', path.sep))

      let text: string
      try {
        text = await fs.readFile(absolute, 'utf8')
      } catch (error) {
        // Nothing there is an ordinary answer, not a fault — the loader decides
        // whether a given absence is fatal.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw new Error(`it could not be read (${messageOf(error)})`)
      }

      try {
        return JSON.parse(text) as unknown
      } catch (error) {
        throw new Error(`it is not readable JSON — ${messageOf(error)}`)
      }
    },

    assetVersion: () => 1,
  }
}
