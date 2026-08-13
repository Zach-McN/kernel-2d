import type { System } from '../system.js'
import { spinSystem } from './spin.js'

/**
 * The systems the kernel *offers*. No longer the systems anything runs.
 *
 * That sentence is the whole of what changed when a game folder became able to
 * supply its own code, and it is worth being exact about, because the old comment
 * here said the opposite. **Nothing runs a system a project did not list.** A
 * project names its systems in `src/systems/index.ts`; a project with none runs
 * none, and a level in it sits still. There is no fallback, deliberately — a
 * kernel that quietly ran its own demo inside somebody's game would be the
 * anticipation `genre-spinup` S1 exists to prevent, and it would make `spin`
 * load-bearing again at the exact moment it was supposed to stop being.
 *
 * **So this list is now a menu rather than a policy.** The sample project's
 * `src/systems/index.ts` imports `spinSystem` by name and lists it, which is why
 * its health icon still turns: the demo is opted into by content rather than
 * imposed by the engine.
 *
 * **It still has one entry, and that is still the honest state of things.** Growing
 * it would be the kernel acquiring game features with no game to justify them. The
 * day `spin` goes — it, its component in the scene format, and its field in the
 * Inspector, together — this file goes with it and nothing else in the kernel
 * changes. That is now checkable rather than promised: no code path reaches this
 * list, so emptying it breaks only `spin`'s own tests.
 */
export const BUILT_IN_SYSTEMS: readonly System[] = [spinSystem]

export { spinSystem }
