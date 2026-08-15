import type { Entity } from '../formats/scene-schema.js'
import { CAMERA_ENTITY_ID, cameraIn } from './camera.js'
import { DOOR_ENTITY_ID, takeDoor } from './door.js'
import { NOTHING, inputEntity, writeInput, type InputSample, type ScenePoint } from './input.js'
import { createLoop, type LoopOptions } from './loop.js'
import { factsIn, storyEntity } from './story.js'
import { stepSystems, type System } from './system.js'

/**
 * A level, running.
 *
 * The glue between the three things that are each simple on their own: a copy of
 * the level, a fixed-step clock, and a list of systems. It owns no timer, no
 * renderer and no files — where frames come from and what to do with the result
 * both arrive as plain functions, which is what lets the whole of this be driven
 * by a clock a test moves by hand, in Node, with no browser (`editor-kernel`
 * D26's seam, applied to time instead of to files).
 *
 * **The running level is a copy, and that is the load-bearing sentence.** The
 * entities a system mutates were deep-copied when the run started, so nothing a
 * system does can reach the file the level was read from, the editor's document
 * store, or the undo stack. Three guarantees fall out of one line rather than
 * being arranged for by three pieces of care:
 *
 *   - pressing Stop puts everything back exactly as the file has it, because
 *     nothing else ever changed;
 *   - a running level writes nothing, because the only thing it can write to is
 *     an object that is about to be thrown away;
 *   - the editor's own picture of the level carries on being maintained behind
 *     the running one, so Stop has nothing to rebuild.
 *
 * The copy goes through JSON rather than `structuredClone`, for the reason
 * `copyEntity` gives: an entity *is* a JSON document, so the round trip is
 * faithful by construction, and `structuredClone` throws on the immer draft the
 * editor may be holding — a failure that only appears when Play is pressed
 * mid-edit.
 *
 * **Redrawing happens when the simulation moved, not once per frame.** A 144Hz
 * display buys no steps on most frames, and drawing the same positions again
 * would be work with nothing to show for it.
 */

export interface RunState {
  /** Steps run since the level started. */
  steps: number
  /** Simulated time in milliseconds — steps times the step size, never the wall clock. */
  elapsedMs: number
  /** The level as it is now. The live array, not a copy: read it, do not keep it. */
  entities: readonly Entity[]
}

export interface RunLevelOptions {
  /**
   * The level to run. **Copied, never mutated** — the caller may carry on
   * holding, drawing and comparing against this exact list.
   */
  entities: readonly Entity[]
  /** In order. Nothing moves when this is empty, which is a case worth being able to ask for. */
  systems: readonly System[]
  /**
   * Subscribes to frames, answering with the way to unsubscribe. In a browser
   * this is the engine's own ticker; in a test it is a function that keeps the
   * callback and calls it on demand.
   */
  onFrame: (tick: (elapsedMs: number) => void) => () => void
  /** Draws the level as it is now. Called only on a frame where at least one step ran. */
  draw: (entities: readonly Entity[]) => void
  /**
   * The player since last asked — keys as `KeyboardEvent.code` values, clicks
   * as scene-unit points already converted by the host that has the camera —
   * asked once per frame that runs a step, and forgotten by the asker once
   * answered.
   *
   * Optional because a test driving systems needs no player, and absent means
   * absent: no input entity joins the level at all. When present, the runner
   * injects the carrier (`input.ts`) and hands each batch to exactly one step —
   * the first step of the frame that drained it, so a press or a click is
   * acted on once however many catch-up steps that frame runs.
   */
  input?: () => InputSample
  /**
   * Told when the game asks to be in another scene (`door.ts`): the game
   * pushed the door entity, the runner took it at the end of the frame, and
   * what "opening a scene" means — loading it, stopping this run, starting
   * that one — is entirely the host's. Fired at most once per run, because a
   * host that is already leaving has no use for a second destination. Absent
   * means doors go nowhere: the ask stays in the level for a test to read.
   */
  door?: (scene: string) => void
  /**
   * Told where the game wants the view centred (`camera.ts`), on every moved
   * frame with an ask standing — told *before* that frame's draw, so the
   * picture and the viewpoint arrive together rather than a frame apart. The
   * focus is in scene units; the scale, and any clamping to what there is to
   * see, stay the host's. Absent means asks go nowhere: the ask stays in the
   * level for a test to read.
   */
  camera?: (focus: ScenePoint) => void
  /**
   * What the game remembers between runs, and which scene this is (`story.ts`).
   * When present, the runner injects the story carrier with `recall`'s facts,
   * and calls `remember` at the end of any frame that changed them — with the
   * whole map, which is the natural unit for something kept as one small text.
   * Absent means absent: no carrier joins the level, nothing is remembered.
   */
  story?: {
    /** The project-relative path of the scene being run, stated by the host. */
    scene: string
    recall: () => Record<string, unknown>
    remember: (facts: Record<string, unknown>) => void
  }
  /**
   * Told how the run is going, no more often than `notifyEveryMs` of simulated
   * time. Optional, because a shipped game has nobody to tell.
   */
  watch?: (state: RunState) => void
  /**
   * How often a watcher hears about the run, in milliseconds of simulated time.
   *
   * **Ten times a second, not sixty**, and the gap is the decision. The picture
   * is drawn every frame by the runtime; a watcher is something being *told
   * about* the picture — the editor putting a caption or a test hook on a panel —
   * and a React render per frame would be the editor driving the game rather than
   * describing it. Ten is above the rate a human reads a changing number at and
   * an order of magnitude below the rate that would cost anything.
   */
  notifyEveryMs?: number
  loop?: LoopOptions
}

export interface RunningLevel {
  /** Unsubscribes from frames. Safe to call twice; the copy is simply dropped. */
  stop: () => void
  /** The current state, for a caller that would rather ask than be told. */
  state: () => RunState
}

/** Ten times a second. See `notifyEveryMs`. */
export const NOTIFY_EVERY_MS = 100

export function runLevel(options: RunLevelOptions): RunningLevel {
  const entities = copyEntities(options.entities)
  const loop = createLoop(options.loop ?? {})
  const notifyEveryMs = options.notifyEveryMs ?? NOTIFY_EVERY_MS

  // The input carrier joins the copy, never the caller's list — it is run
  // state in the strictest sense, and it exists only when something feeds it.
  const drain = options.input
  const carrier = drain === undefined ? null : inputEntity()
  if (carrier !== null) entities.push(carrier)

  // The story carrier likewise: recalled once, at the moment the run starts.
  const story = options.story
  const memory = story === undefined ? null : storyEntity(story.scene, story.recall())
  if (memory !== null) entities.push(memory)
  /** The facts as last remembered, for telling a change from a re-statement. */
  let remembered = memory === null ? '' : JSON.stringify(factsIn(entities))
  /** A host is told about one door per run; it is already on its way out. */
  let doored = false

  const state = (): RunState => ({ steps: loop.steps, elapsedMs: loop.elapsedMs, entities })

  /** Simulated time at the last notification, or null before the first one. */
  let notifiedAtMs: number | null = null
  let running = true

  const unsubscribe = options.onFrame((frameMs) => {
    if (!running) return

    let firstStepOfFrame = true
    let frameSample: InputSample = NOTHING
    const ran = loop.advance(frameMs, (dtSeconds) => {
      // Drained inside the step rather than before the frame, because most
      // frames at a high refresh rate run no steps — draining on one of those
      // would throw a press away between steps.
      if (carrier !== null && drain !== undefined) {
        // Presses and clicks are events and belong to exactly one step; held
        // keys are state and belong to every step of the frame — a catch-up
        // frame that blanked them would read as the player letting go.
        if (firstStepOfFrame) frameSample = drain()
        writeInput(
          carrier,
          firstStepOfFrame ? frameSample : { pressed: [], clicked: [], held: frameSample.held ?? [] },
        )
        firstStepOfFrame = false
      }
      stepSystems(options.systems, entities, dtSeconds)
    })

    // Nothing moved, so there is nothing to draw and nothing to say. This is the
    // ordinary case on a display faster than the step rate.
    if (ran === 0) return

    // Whatever the run learned this frame, the host now remembers — compared
    // as text because that is what the host keeps, and only on change so a
    // quiet run costs a comparison and nothing more.
    if (memory !== null && story !== undefined) {
      const learned = JSON.stringify(factsIn(entities))
      if (learned !== remembered) {
        remembered = learned
        story.remember(factsIn(entities))
      }
    }

    // The carriers are what the systems see, never what the picture holds:
    // they draw nothing, stand nowhere, and are not part of the level anybody
    // authored — a report that listed them would put runner bookkeeping into
    // every consumer's idea of "the level's entities". A level carrying none
    // of them is handed over as-is, so what the systems mutate *is* what gets
    // drawn, identity included.
    // The viewpoint moves before the picture is drawn, so the two arrive in
    // the same frame — a camera told afterwards trails the game by one frame,
    // which reads as the level jittering against its own background.
    if (options.camera !== undefined) {
      const focus = cameraIn(entities)
      if (focus !== null) options.camera(focus)
    }

    const hidden = (one: Entity): boolean =>
      one === carrier || one === memory || one.id === DOOR_ENTITY_ID || one.id === CAMERA_ENTITY_ID
    options.draw(entities.some(hidden) ? entities.filter((one) => !hidden(one)) : entities)

    // A door the game opened this frame, told to the host after the picture —
    // the host will stop this run, and a half-drawn last frame helps nobody.
    if (options.door !== undefined && !doored) {
      const scene = takeDoor(entities)
      if (scene !== null) {
        doored = true
        options.door(scene)
      }
    }

    const watch = options.watch
    if (watch === undefined) return
    // The first step always reports, so a watcher hears that the level is moving
    // at the moment it starts rather than a tenth of a second later.
    if (notifiedAtMs !== null && loop.elapsedMs - notifiedAtMs < notifyEveryMs) return
    notifiedAtMs = loop.elapsedMs
    watch(state())
  })

  return {
    stop: () => {
      if (!running) return
      running = false
      unsubscribe()
    },
    state,
  }
}

/**
 * A deep copy of the level's entities.
 *
 * Deep rather than a copy of the list: a shallow copy would share every
 * transform object with the caller, so the first step a system took would move
 * the level the editor is holding — silently, and only while a level happened to
 * be running.
 */
function copyEntities(entities: readonly Entity[]): Entity[] {
  return JSON.parse(JSON.stringify(entities)) as Entity[]
}
