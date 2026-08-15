import { useEffect, useRef, useState } from 'react'

import { currentSystems } from 'virtual:game-systems'

import {
  collectKeys,
  inSceneUnits,
  runLevel,
  toScenePoint,
  type DrawnInScene,
  type Entity,
  type SceneMusic,
  type ScenePoint,
  type ShownScene,
} from '../../runtime'
import { useSceneView } from './scene-view-context'

/**
 * The editor's entire part in a level that is running: start it, stop it, and
 * repeat what it says.
 *
 * Everything that makes a level move — the clock, the fixed step, the systems,
 * the copy they mutate — is in `runtime/game/`, because all of it ships inside
 * an exported game (`editor-kernel` D1/D20). Nothing here decides how fast time
 * goes or what happens when it does. That asymmetry is the point: an editor that
 * drove the simulation would be an editor whose Play button and whose exported
 * game were two different games.
 *
 * **It cannot start until the runtime's picture of the level is on screen**, and
 * that ordering is the whole of what makes the play comparison mean something.
 * The comparison asks whether the running level *started* where the file says;
 * if the first system step could land before the picture being compared was
 * taken, the check would be against a level that had already moved, and it would
 * fail — or worse, pass by a fraction. So `ready` is not a convenience, it is the
 * condition the check rests on (`editor-verification` V24).
 *
 * **Stopping is dropping it.** The systems mutated a copy the runner made, so
 * there is no level to restore, no store to roll back, and nothing on disk that
 * moved. The editor's own resolution of the same level has been kept up to date
 * behind the running picture the whole time, so Stop is one state change.
 *
 * **The systems are asked for when Play starts, never captured at import.** They
 * come from the project's own `src/systems/`, compiled in by `scripts/game-code.ts`,
 * and editing one hot-replaces that module rather than reloading the page. Reading
 * the list here — inside the effect, at the moment a level starts — is the whole of
 * why Stop and Play is enough to see a change, and why the open level, the
 * selection and the camera survive an edit to the game's code.
 */

export interface RunningPicture {
  /** Steps run since the level started. Whole steps of a fixed size. */
  steps: number
  /** Simulated milliseconds. Steps times the step size, not the wall clock. */
  elapsedMs: number
  /**
   * The running level in its own units, from the renderer's own report of what
   * it last drew — never worked out again from the transforms (`editor-kernel`
   * D2). The same projection the editing view and an exported game publish.
   */
  units: DrawnInScene[]
}

/** The host's half of the runtime's door and story seams, both optional. */
export interface RunSeams {
  /** Told when the game asks for another scene (`runtime/game/door.ts`). */
  door?: (scene: string) => void
  /** Which scene this is, and where its memory sleeps (`runtime/game/story.ts`). */
  story?: { scene: string; recall: () => Record<string, unknown>; remember: (facts: Record<string, unknown>) => void }
}

/**
 * @param entities the running level's entities, or null when nothing is running.
 *   Copied by the runner, so what is passed here is never touched.
 * @param ready whether the renderer has drawn this exact level. Until it has,
 *   nothing starts.
 * @param host the element the picture sits in, for the pointer. Clicks on it
 *   while the level runs are converted to scene units against the renderer's
 *   own latest report — the same camera that drew the frame being clicked —
 *   and handed to the game. Falls back to the started frame's report for a
 *   click landed before the first step has drawn.
 * @param started the report of the frame the level started on, the fallback
 *   above.
 * @param seams the door and the story, read through a ref at the moment a run
 *   starts — a re-rendered seam object must not restart a level.
 * @param music the level's music, resolved by the loader, or null for silence.
 *   It starts with the run and stops with it, which is the whole of why
 *   editing is silent: nothing else ever asks.
 */
export function useRunningLevel(
  entities: readonly Entity[] | null,
  ready: boolean,
  host: React.RefObject<HTMLElement | null>,
  started: ShownScene | null,
  seams: RunSeams | null = null,
  music: SceneMusic | null = null,
): RunningPicture | null {
  const view = useSceneView()
  const redraw = view.state === 'ready' ? view.redraw : null
  const onFrame = view.state === 'ready' ? view.onFrame : null
  const playMusic = view.state === 'ready' ? view.playMusic : null
  const stopMusic = view.state === 'ready' ? view.stopMusic : null

  const [picture, setPicture] = useState<RunningPicture | null>(null)

  // Read through a ref so a new report object cannot restart the level — the
  // effect below owns the run, and its dependencies are the things that mean
  // "a different run", which a redrawn starting frame is not.
  const startedRef = useRef(started)
  startedRef.current = started

  const seamsRef = useRef(seams)
  seamsRef.current = seams

  // Same reasoning as the seams: a re-rendered music object must not restart
  // the level. What starts a run is the effect below; the track it plays is
  // whatever this holds at that moment.
  const musicRef = useRef(music)
  musicRef.current = music

  useEffect(() => {
    if (entities === null || !ready || redraw === null || onFrame === null) return

    // The keyboard belongs to the game while a level runs (`runtime/web/keyboard.ts`
    // skips anything editable, so panels keep their text fields). The blur is
    // for the button the human just clicked to start playing: still focused, it
    // would swallow the game's spacebar and press Stop with it.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const keys = collectKeys(window)

    /**
     * The renderer's report of the most recent frame.
     *
     * Kept here rather than pushed into React on every frame: the level is drawn
     * sixty times a second and described ten, so the description has to be able
     * to reach back for the latest picture rather than being handed one.
     */
    let latest: ShownScene | null = null

    // The pointer belongs to the game too: the editing gestures are off while a
    // level runs, so a click on the picture can only mean the player. Converted
    // here and not in the game, because this is where the camera is.
    let clicked: ScenePoint[] = []
    const surface = host.current
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || surface === null) return
      const report = latest ?? startedRef.current
      if (report === null) return
      const box = surface.getBoundingClientRect()
      clicked.push(
        toScenePoint(
          { x: event.clientX - box.left, y: event.clientY - box.top },
          report.drawnWith,
          report.canvasSize,
        ),
      )
    }
    surface?.addEventListener('pointerdown', onPointerDown)

    // The story is captured as the run starts — its facts are recalled once —
    // while the door forwards through the ref, so the handler a later render
    // brought is the one a late click travels through.
    const story = seamsRef.current?.story

    // The level's music, for exactly as long as the run lasts. Pressing Play
    // is the player's gesture, so the browser's autoplay lock is already open
    // here; the exported page is where `locked` earns its keep.
    const track = musicRef.current
    if (track !== null && playMusic !== null) playMusic(track)

    const level = runLevel({
      entities,
      systems: currentSystems(),
      onFrame,
      input: () => {
        const sample = { pressed: keys.drain(), clicked }
        clicked = []
        return sample
      },
      door: (scene) => seamsRef.current?.door?.(scene),
      ...(story === undefined ? {} : { story }),
      draw: (moved) => {
        latest = redraw(moved)
      },
      watch: (state) => {
        setPicture({
          steps: state.steps,
          elapsedMs: state.elapsedMs,
          units: latest === null ? [] : inSceneUnits(latest),
        })
      },
    })

    return () => {
      surface?.removeEventListener('pointerdown', onPointerDown)
      keys.stop()
      level.stop()
      stopMusic?.()
      setPicture(null)
    }
  }, [entities, ready, redraw, onFrame, host, playMusic, stopMusic])

  return picture
}
