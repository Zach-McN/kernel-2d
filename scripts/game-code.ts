import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'

import { toPosixPath } from '../sidecar/paths.js'

/**
 * How a game folder's own code reaches the game.
 *
 * The kernel is the application and a game folder is a document it opens, so the
 * kernel cannot import a game — `tests/architecture/boundaries.test.ts` fails if it
 * ever does. But a game's systems have to end up inside the thing that runs, on
 * both sides of the export. This plugin is the entire answer, and being *one*
 * plugin is the load-bearing part: the editor's Vite dev server and the export's
 * `vite build` construct it with the same project path and get the same module, so
 * "what runs when I press Play" and "what runs in the folder I hand somebody"
 * cannot become two answers (`editor-kernel` D2's failure with a new fuse).
 *
 * Two things are provided.
 *
 * **An alias, so a game can name the kernel.** A system is typed against `System`
 * and `Entity`, and the alternative — a relative path climbing out of the game
 * folder — would hard-code where the kernel sits on disk and break the day either
 * folder moved. A bare specifier names a package instead, and this resolves it.
 *
 * **A virtual module holding the project's systems.** `virtual:game-systems`
 * re-exports the list from the project's own entry file, or is an empty list when
 * the project has no code. A project with no `src/systems/index.ts` is an ordinary
 * state, not a fault: most projects start that way and the sample was every project
 * until now.
 *
 * ## Why the project runs *all* of its own systems
 *
 * There is no per-level system list, and that was a decision rather than an
 * omission (`genre-spinup`, parked item 1, sub-decision 2). A field in the scene
 * format naming systems would be a change to every level ever saved, and — the part
 * that actually decided it — very hard to take back out once levels carry it. A
 * project running its own list, in the order the list gives, is the smaller answer
 * and nothing about it forecloses the larger one.
 *
 * ## Why the editor gets a getter rather than a list
 *
 * Everything else in this kernel reloads within the second, and code had no obvious
 * equivalent. The answer chosen: **pressing Play re-reads the game's code.** Editing
 * a system hot-replaces this module rather than reloading the page, so the open
 * level, the selection and the camera all survive; the next Play picks up the change.
 *
 * That is why `currentSystems()` exists beside `systems`. The holder it reads lives
 * on `import.meta.hot.data`, which Vite preserves across a hot replacement — so a
 * caller holding the getter from *before* an edit still sees the systems from
 * *after* it. A module-scope `let` would not survive: a replaced module is a new
 * scope, and the old closure would go on reading the old one. In a built export
 * there is no `import.meta.hot` at all, the branch is eliminated, and the getter
 * answers with the same static list `systems` holds.
 *
 * ## Why the module counts itself and says so
 *
 * `gameCodeVersion()` is how many times this module has been evaluated — one on
 * load, one more per hot replacement — and each evaluation in the editor fires a
 * `kernel2d:game-code` event on the window. A replacement is otherwise silent:
 * nothing on screen changes until the next Play, and the only way to *know* the
 * dev server had noticed an edit was to press Play and look. That is exactly the
 * wait the browser suite used to guess at with a twenty-second poll of whole
 * Play/Stop cycles, and lose on a loaded machine (`editor-verification` W26).
 * With a version to read and an event to wait on, the editor can say the code
 * has changed and a test can wait for the fact rather than for the clock. In a
 * built game the version is 1 forever and no event is ever sent.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * What the alias points at: the game-facing surface, not the full barrel.
 *
 * The barrel reaches the renderer and therefore Phaser and therefore `window`,
 * and a game's own tests run in plain Node — `runtime/game/api.ts` says the
 * rest.
 */
const RUNTIME_ENTRY = path.join(REPO_ROOT, 'runtime', 'game', 'api.ts')

/** What a game folder calls the kernel. A package name, never a path. */
export const KERNEL_RUNTIME_ALIAS = 'kernel-2d/runtime'

/** The module the page and the editor import to get a project's systems. */
export const GAME_SYSTEMS_MODULE = 'virtual:game-systems'

/** Rollup's convention: a resolved virtual id nobody else will claim. */
const RESOLVED_ID = `\0${GAME_SYSTEMS_MODULE}`

/** Where a project keeps the list of systems it runs. One fixed place, like `project.json`. */
export const GAME_SYSTEMS_ENTRY = 'src/systems/index.ts'

/** The absolute path of a project's systems entry, whether or not it is there. */
export function gameSystemsEntry(projectPath: string): string {
  return path.join(projectPath, ...GAME_SYSTEMS_ENTRY.split('/'))
}

/**
 * The source of the virtual module, for a project that has systems and for one
 * that has not.
 *
 * Exported so it can be tested directly: what a build produces from a folder is
 * exactly this string, and asserting on it needs neither a bundler nor a browser.
 */
export function gameSystemsSource(projectPath: string | null): string {
  const entry = projectPath === null ? null : gameSystemsEntry(projectPath)
  const hasSystems = entry !== null && fs.existsSync(entry)

  const head = hasSystems
    ? `import { systems as gameSystems } from ${JSON.stringify(toPosixPath(entry))}\n`
    : 'const gameSystems = []\n'

  return `${head}
/**
 * Survives a hot replacement, so that whoever took the getter before an edit reads
 * the list from after it. Generated by scripts/game-code.ts — not a file on disk.
 */
function holder() {
  if (!import.meta.hot) return { systems: gameSystems }
  if (!import.meta.hot.data.holder) import.meta.hot.data.holder = { systems: gameSystems }
  return import.meta.hot.data.holder
}

const current = holder()
current.systems = gameSystems
// Counts every evaluation of this module: 1 on load, one more per hot
// replacement. Lives on the holder, so a getter taken before an edit reads
// the count from after it — the same reason the systems do.
current.version = (current.version || 0) + 1

export const systems = gameSystems
export function currentSystems() {
  return current.systems
}
export function gameCodeVersion() {
  return current.version
}

if (import.meta.hot) import.meta.hot.accept()
// Said out loud, so the editor can show that the code on screen is not the
// code that last ran — and so a test can wait for the replacement itself
// rather than guessing how long the dev server will take to notice a file.
if (import.meta.hot) window.dispatchEvent(new Event('kernel2d:game-code'))
`
}

export interface GameCodeOptions {
  /**
   * The project folder the editor is open on, or that is being exported. `null`
   * means no project — the module is an empty list, and nothing about the build
   * fails for the want of one.
   */
  projectPath: string | null
}

export function gameCode(options: GameCodeOptions): Plugin {
  const { projectPath } = options
  const entry = projectPath === null ? null : gameSystemsEntry(projectPath)

  return {
    name: 'kernel-2d:game-code',

    config: () => ({
      resolve: {
        alias: { [KERNEL_RUNTIME_ALIAS]: RUNTIME_ENTRY },
      },
      server: {
        fs: {
          // The game's code sits outside the Vite root, which the dev server
          // refuses to serve from unless it is told the folder is allowed. The
          // export's build has no such notion and ignores this.
          allow: projectPath === null ? [REPO_ROOT] : [REPO_ROOT, projectPath],
        },
      },
    }),

    resolveId: (id) => (id === GAME_SYSTEMS_MODULE ? RESOLVED_ID : null),

    load: (id) => (id === RESOLVED_ID ? gameSystemsSource(projectPath) : null),

    configureServer: (server) => {
      if (projectPath === null || entry === null) return

      /*
       * The dev server watches its own root, and a game folder is not in it.
       *
       * Without this the whole "Play re-reads the code" decision quietly does not
       * happen: the module graph knows about the game's files, Vite never hears
       * that one changed, and the editor goes on running the systems it compiled
       * at startup. It fails as *nothing happening*, which is the worst way for a
       * reload mechanism to fail — indistinguishable from an edit that did not do
       * what the author expected.
       *
       * The whole folder rather than the entry file: a project's systems are as
       * many files as it likes, and the entry is only the one that lists them.
       */
      server.watcher.add(path.join(projectPath, 'src'))

      // A project that gains its first system while the editor is open. The
      // virtual module said "no systems" and has to stop saying it — and unlike an
      // ordinary edit there is no module in the graph to hot-replace, because the
      // file was not imported by anything. So this one case reloads the page.
      const reloadOnEntryAppearing = (changed: string): void => {
        if (path.resolve(changed) !== entry) return
        const module = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (module !== undefined) server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      }

      server.watcher.on('add', reloadOnEntryAppearing)
      server.watcher.on('unlink', reloadOnEntryAppearing)
    },
  }
}
