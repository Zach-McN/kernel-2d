import { PROJECT_FORMAT, ProjectSchema } from '../formats/project-schema'
import { runLevel, type RunningLevel } from '../game/run-level'
import { collectKeys } from './keyboard'
import { storyStore } from './story-store'
import type { System } from '../game/system'
import { clampFocus, framing, toScenePoint, type Camera } from '../scene/coordinates'
import type { ScenePoint } from '../game/input'
import { inSceneUnits, type DrawnInScene } from '../scene/drawn-in-scene'
import { describeLoadProblem, loadScene, type LoadProblem, type ProjectReader } from '../scene/load-scene'
import { fitStep } from '../scene/scale-steps'
import { createSceneView, type SceneRequest, type ShownScene } from '../scene/scene-view'

/**
 * The game, starting.
 *
 * This is the whole of what an exported folder runs, and the other half of the
 * seam `editor-kernel` D26 opened: the loader takes "read one JSON file" and "what
 * version is this asset" as arguments, the editor answers out of its development
 * service, and **this answers out of `fetch` and a build number**. Nothing between
 * the two is different — the same loader, the same prefab resolution, the same
 * `.meta` reading, the same renderer — which is the only reason the picture here
 * and the picture in the editor can be expected to match.
 *
 * It ships. So it may not import the editor, the filesystem service, the scripts or
 * the tests, and `tests/architecture/boundaries.test.ts` fails if it ever does.
 *
 * **It runs, and that is the same runner the editor's Play button uses.** The level
 * is drawn, framed, and then handed to `runLevel` with the same systems — so the
 * folder somebody is given and the picture in the editor are the same game in the
 * strong sense, not merely the same drawing. Time here is Phaser's ticker cut into
 * fixed steps, exactly as it is there.
 *
 * **What this deliberately is still not.** It is not physics, and it is not a
 * scene *graph*: one level runs at a time, and the only way to another is the
 * game itself asking through the door seam (`runtime/game/door.ts`) — which
 * arrived, like the keyboard and the pointer before it, when a real game
 * demanded it: tower-defense's level select. The story seam (`story.ts`)
 * arrived on the same day and the same terms, so a shipped folder remembers
 * which levels are done across visits.
 *
 * **The page says what went wrong, in the runtime's own words.** `describeLoadProblem`
 * has always lived in the runtime precisely so a shipped game can say it cannot find
 * one of its own textures. A player should never see one, because the export command
 * refuses to produce a folder that would — so showing them is strictly better than
 * swallowing them, and it means a folder somebody was sent can explain itself.
 */

/**
 * What an asset's bytes are keyed by. In the editor this is a file's modification
 * time, because Photoshop can re-save a texture while the editor is open. Here
 * nothing changes underneath the page: one build, one number, and every texture is
 * uploaded to the graphics card exactly once.
 */
const BUILD = 1

/** Where the settings live, relative to the page. Fixed, like the folder shape. */
const PROJECT_FILE = 'project.json'

export interface GameHandle {
  /** What the renderer drew most recently, or null while nothing has been drawn yet. */
  shown: () => ShownScene | null
  /**
   * The level's picture in its own units, **as it was first drawn** — the same
   * report the editor publishes for a level that has just started, and the one
   * the two are compared through.
   */
  drawn: () => DrawnInScene[]
  /** Where the level has got to since, in the same units. */
  drawnNow: () => DrawnInScene[]
  /** Fixed steps run since the level started. */
  steps: () => number
  /** References the level could not resolve. It runs regardless. */
  problems: () => LoadProblem[]
}

/**
 * Whatever the page ends up doing, it says which of these it is doing — as an
 * attribute on the host, so it can be read without reaching into the page.
 */
type GameState = 'loading' | 'drawn' | 'failed'

/**
 * The systems this game runs, handed in rather than reached for.
 *
 * The same shape as `runLevel`'s own argument and for the same reason: a game's
 * systems come from the game's folder, and this file has no business knowing how
 * that folder is found or compiled. The page next door composes the two, which
 * keeps every question about *where code comes from* out of the thing that runs it.
 */
export async function startGame(host: HTMLElement, systems: readonly System[]): Promise<GameHandle> {
  const say = sayInto(host)

  let shown: ShownScene | null = null
  let problems: LoadProblem[] = []
  /**
   * The level as it was first drawn, kept for the life of the page.
   *
   * Separate from `shown` because the two answer different questions the moment
   * anything moves, and it is the *starting* picture that is comparable with
   * anything else: the editor's play mode publishes the frame a level started on
   * for the same reason, and a comparison between two moving pictures taken at
   * two unrelated instants would be a test of nothing (`editor-verification`
   * V26).
   */
  let started: DrawnInScene[] = []
  let steps = 0

  const handle: GameHandle = {
    shown: () => shown,
    drawn: () => started,
    drawnNow: () => (shown === null ? [] : inSceneUnits(shown)),
    steps: () => steps,
    problems: () => problems,
  }

  /*
   * There is deliberately no "was this opened from the disk?" check here.
   *
   * It belongs in the page, not in the game, and the reason is worth knowing before
   * somebody moves it: a browser refuses to load a **module** script from a
   * `file://` document at all, so this file never runs in the one situation the
   * check would be for. The page says it from a plain inline script instead, which
   * is the only thing that still runs there. See `index.html`.
   */

  const report = (state: GameState, scene: string | null): void => {
    describe(host, state, scene, shown, started, steps, problems.length)
  }

  report('loading', null)
  say('Loading…', false)

  const reader = fetchReader()

  const settings = await readProject(reader)
  if (!settings.ok) {
    report('failed', null)
    say(settings.problem, true)
    return handle
  }

  const startupScene = settings.project.startupScene
  if (startupScene === null) {
    report('failed', null)
    say(`${PROJECT_FILE} names no starting level, so there is nothing for this game to open.`, true)
    return handle
  }

  const level = await loadScene(reader, startupScene)
  if (!level.ok) {
    report('failed', startupScene)
    say(level.problem, true)
    return handle
  }

  problems = level.problems

  const view = await createSceneView({
    // The bytes of a texture sit beside the page at the path the level names, so
    // the URL *is* the path. Nothing is versioned in the query string: the folder
    // is immutable for the life of a build, and a cache-buster would only make one
    // build's URLs differ from the next's for no reader's benefit.
    resolveAssetUrl: (path) => path,
  })

  host.append(view.canvas)

  // What the sound is doing, on the page beside the other attributes, read
  // back off the sound system itself (P4). Refreshed with every report a
  // running level already makes, so `locked` turning into `playing` on the
  // player's first press is visible without anything polling.
  const announceAudio = (): void => {
    host.setAttribute('data-game-music', view.musicState())
    // And the game's own effects, off the audio clock (`runtime/scene/synth.ts`).
    host.setAttribute('data-game-sound', view.soundState())
  }

  const draw = async (request: SceneRequest): Promise<void> => {
    const size = availableSize(host)
    view.resize(size.width, size.height)
    shown = await view.show(request)

    // Framing needs the extent, and the extent is only known once something has
    // been drawn — so the first pass lands at whatever scale the view booted with
    // and this settles it. It settles rather than oscillating for the reason
    // `editor-ui` U17's fit does: after one pass the wanted scale *is* the drawn
    // scale, so nothing asks again.
    if (shown !== null) shown = frame(shown) ?? shown
  }

  const frame = (from: ShownScene): ShownScene | null => {
    const content = from.contentBounds
    const scale =
      content === null || content.width <= 0 || content.height <= 0
        ? 1
        : fitStep(content.width, content.height, from.canvasSize.width, from.canvasSize.height)
    return view.restage(framing(content, scale))
  }

  await draw(level.request)

  // The starting picture, taken here: the level is drawn and framed, and nothing
  // has moved yet because nothing has been started yet. One line below is where
  // that stops being true, and the order of these two is the whole of why this
  // page's report can be checked against the editor's.
  started = shown === null ? [] : inSceneUnits(shown)

  /*
   * A resized window re-frames the level.
   *
   * The editor deliberately does the opposite — a panel dragged wider keeps the
   * human's place, because a scene camera is something you drive. Here there is
   * nothing to drive: no input, no camera controls, and no other thing that would
   * ever move the view. So a window made smaller would simply cut the level in
   * half and leave it that way, which is the worse of the two behaviours by a
   * distance. Revisit the moment a game has a camera of its own.
   */
  window.addEventListener('resize', () => {
    if (shown === null) return
    const size = availableSize(host)
    const resized = view.resize(size.width, size.height)
    if (resized !== null) shown = frame(resized) ?? resized
    report('drawn', startupScene)
  })

  report('drawn', startupScene)
  say(caption(level.request, shown, problems), problems.length > 0)

  /*
   * And then time starts.
   *
   * The same runner and the same systems the editor's Play button uses, over a
   * copy of the level this page just read. There is nothing to stop it: a shipped
   * game runs until the tab closes, and Phaser's ticker stops on its own when the
   * tab is hidden, so a backgrounded game neither burns a core nor comes back to
   * an hour of catching up.
   *
   * The page is told ten times a second rather than sixty, on the same reasoning
   * as the editor: writing attributes is describing the picture, not producing
   * it. Every frame is drawn; not every frame is announced.
   */
  // The same keyboard collector the editor's play mode wires, and the same
  // click conversion — against the renderer's own report — so a key or a click
  // means the same thing in a shipped folder as it does behind the Play button.
  const keys = collectKeys(window)
  let clicked: ScenePoint[] = []
  view.canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || shown === null) return
    const box = view.canvas.getBoundingClientRect()
    clicked.push(
      toScenePoint({ x: event.clientX - box.left, y: event.clientY - box.top }, shown.drawnWith, shown.canvasSize),
    )
  })

  // The game's memory, kept under the page's own path: one exported folder,
  // one story, however many exported games share a host.
  const store = storyStore(window.location.pathname)

  /** The scene the game is in now — the startup scene until a door says otherwise. */
  let sceneNow = startupScene
  let current: RunningLevel | null = null

  /**
   * The host's half of the door seam: load the asked-for scene with the same
   * loader everything uses, stop the run that asked, draw and start the new
   * one. A door to a scene that cannot be loaded is refused with the sentence
   * on the page and the current run keeps running — a menu with one bad
   * banner should not brick the game.
   */
  const travel = async (next: string): Promise<void> => {
    const arrived = await loadScene(reader, next)
    if (!arrived.ok) {
      say(arrived.problem, true)
      return
    }

    current?.stop()
    sceneNow = next
    problems = arrived.problems
    await draw(arrived.request)
    report('drawn', sceneNow)
    say(caption(arrived.request, shown, arrived.problems), arrived.problems.length > 0)
    begin(arrived.request)
  }

  const begin = (request: SceneRequest): void => {
    // The level's music, for as long as this run lasts. A level with none
    // silences whatever the previous level was playing — travelling through a
    // door into a quiet level is the quiet being asked for. The browser holds
    // audio shut until the player's first press; the renderer parks the start
    // on that press, and `data-game-music` says `locked` until it lands.
    if (request.music !== undefined) view.playMusic(request.music)
    else view.stopMusic()
    announceAudio()

    // The game's camera ask (`runtime/game/camera.ts`), applied in the same
    // draw as the frame that asked. The scale is the fit this page framed; the
    // ask is clamped to the extent the level *started* with — the moving
    // level's own bounds follow whatever jumped highest this frame, and a
    // clamp that breathes reads as jitter.
    const startBounds = shown === null ? null : shown.contentBounds
    let aimed: Camera | null = null

    current = runLevel({
      entities: request.scene.entities,
      systems,
      onFrame: view.onFrame,
      input: () => {
        const sample = { pressed: keys.drain(), held: keys.held(), clicked }
        clicked = []
        return sample
      },
      door: (next) => {
        void travel(next)
      },
      story: { scene: sceneNow, recall: store.recall, remember: store.remember },
      camera: (focus) => {
        if (shown === null) return
        const scale = shown.camera.scale
        aimed = { scale, focus: clampFocus(focus, startBounds, shown.canvasSize, scale) }
      },
      draw: (moved) => {
        const redrawn = aimed === null ? view.redraw(moved) : view.redraw(moved, aimed)
        if (redrawn !== null) shown = redrawn
      },
      // Every noise the game made this frame (`runtime/game/sound.ts`),
      // synthesized on the same manager the music plays through. Here a cue
      // really can arrive before the player has touched anything — an
      // autoplaying level with a sound in its first second — and the renderer
      // drops that one rather than playing it late.
      sound: (cues) => {
        for (const cue of cues) view.playCue(cue)
      },
      watch: (state) => {
        steps = state.steps
        report('drawn', sceneNow)
        announceAudio()
      },
    })
  }

  begin(level.request)

  return handle
}

// --- reading files with no service to ask ----------------------------------

/**
 * The runtime's `ProjectReader`, over static files beside the page.
 *
 * Compare `editor/shell/project-reader.ts`, which is the same two functions
 * answered out of a development service, with a suffix taken off on the way past.
 * This one has no adapting to do at all — it asks for the file the level names,
 * which is the file on disk — and that asymmetry is the point of the seam: the
 * *editor's* half is the special case.
 */
function fetchReader(): ProjectReader {
  return {
    readJson: async (path) => {
      const response = await fetch(path, { cache: 'no-store' })
      // Nothing at that path is an ordinary answer rather than a fault, and it is
      // the loader's job to decide whether it is fatal.
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`the file could not be fetched (${String(response.status)})`)
      return (await response.json()) as unknown
    },

    assetVersion: () => BUILD,
  }
}

type ProjectRead = { ok: true; project: { startupScene: string | null } } | { ok: false; problem: string }

/** The project's settings, or one sentence saying why the game cannot start. */
async function readProject(reader: ProjectReader): Promise<ProjectRead> {
  let raw: unknown
  try {
    raw = await reader.readJson(PROJECT_FILE)
  } catch (error) {
    return { ok: false, problem: `${PROJECT_FILE} could not be read: ${messageOf(error)}.` }
  }

  if (raw === null || raw === undefined) {
    return { ok: false, problem: `There is no ${PROJECT_FILE} beside this page, so this game has no settings.` }
  }

  const parsed = ProjectSchema.safeParse(raw)
  if (!parsed.success) {
    const format = (raw as { format?: unknown }).format
    const what =
      typeof format === 'string' && format !== PROJECT_FORMAT
        ? `it is a ${format}, not a set of project settings`
        : 'it is not a set of project settings this game can read'
    return { ok: false, problem: `${PROJECT_FILE} could not be used: ${what}.` }
  }

  return { ok: true, project: parsed.data }
}

// --- what the page says ----------------------------------------------------

/**
 * The one line of prose the page has.
 *
 * Held to one element rather than appended to, so a later message replaces an
 * earlier one: two sentences stacked up, one of them stale, is worse than either.
 *
 * It floats *over* the picture rather than sitting under it, and that is a fix
 * rather than a style: a caption in the same box as the canvas changes the size of
 * that canvas, and the framing is computed from the canvas size — so a sentence
 * appearing would reframe the level and its disappearance would reframe it back
 * (`editor-ui` UG8). Overlaid, it cannot.
 */
function sayInto(host: HTMLElement): (text: string, bad: boolean) => void {
  return (text, bad) => {
    const line = host.ownerDocument.getElementById('say')
    if (line === null) return
    line.textContent = text
    line.classList.toggle('bad', bad)
    // An empty sentence would leave a bar of padding with nothing in it.
    line.hidden = text === ''
  }
}

/** Every problem, not the first — a page that hides four of five is worse than silent. */
function caption(request: SceneRequest, shown: ShownScene | null, problems: LoadProblem[]): string {
  if (problems.length > 0) return problems.map(describeLoadProblem).join(' ')
  if (request.scene.entities.length === 0) return 'This level is empty.'
  if (shown === null) return 'Nothing could be drawn.'

  const undrawable = shown.undrawable
  if (undrawable.length > 0) {
    return `${undrawable.join(', ')} could not be loaded, so anything drawing it is missing.`
  }

  return ''
}

/**
 * What the page is doing, on the host element.
 *
 * Attributes rather than something reached for inside the page, so the state of a
 * shipped game is readable from the outside — by anybody with a browser's inspector
 * open wondering why a folder they were sent is blank, and by the test that checks an
 * exported folder draws what the editor drew.
 *
 * `data-game-units` is the picture in the level's own units, and it is deliberately
 * the same report under the same shape as the editor's `data-scene-units`: the two are
 * meant to be compared, and two hooks of different shapes would mean somebody
 * converting one of them, which is the second derivation this whole arrangement exists
 * to avoid. Both mean **the frame the level started on**, on both sides of the export,
 * which is what keeps them comparable now that a level moves.
 *
 * `data-game-units-now` is where it has got to, and `data-game-steps` is how many fixed
 * steps it took. Those two are how "this folder is running, not merely drawn" is read
 * from outside the page — by a test, and by a human wondering whether what they are
 * looking at is frozen.
 */
function describe(
  host: HTMLElement,
  state: GameState,
  scene: string | null,
  shown: ShownScene | null,
  started: readonly DrawnInScene[],
  steps: number,
  problems: number,
): void {
  const now = shown === null ? [] : inSceneUnits(shown)

  host.dataset['gameState'] = state
  host.dataset['gameScene'] = scene ?? ''
  host.dataset['gameDrawn'] = String(now.filter((entity) => entity.bounds !== null).length)
  host.dataset['gameProblems'] = String(problems)
  host.dataset['gameScale'] = shown === null ? '' : String(shown.camera.scale)
  host.dataset['gameUnits'] = shown === null ? '' : JSON.stringify(started)
  host.dataset['gameUnitsNow'] = shown === null ? '' : JSON.stringify(now)
  host.dataset['gameSteps'] = String(steps)
}

/** The host's own box, in CSS pixels, never zero. */
function availableSize(host: HTMLElement): { width: number; height: number } {
  const box = host.getBoundingClientRect()
  return { width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
