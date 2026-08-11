# CLAUDE.md — kernel-2d

This repo is the reusable 2D game-editor kernel. The methodology: **AI writes all code; the human (Zach) authors the art, levels, and game design that ship — and never reads code.**
Full architecture and rationale: `docs/ai-game-tooling-report.md`. Read it if anything below is unclear.

## The division of labor

- AI owns 100% of `src/`, `editor/`, `sidecar/`, tests, and build config.
- The human owns the **shipping** contents of `assets/`, `scenes/`, `prefabs/`, and `data/`, authored through the editor tools, Photoshop, and Blender.

### Tool or code? The deciding question

For anything that shapes the game, ask: **would a human meaningfully author this through a UI?**

- **Yes → build the tool.** Anything a designer would want to place, tune, sequence, curve, or iterate on belongs in an authoring surface backed by a text format: level layout, entity placement, wave tables, spline paths, tuning values, economy curves. Build the tool, then use it.
- **No → keep it as code.** Mechanics, systems, and behavior that a UI would only obscure stay in `src/` as ordinary game code: collision resolution, state machines, input handling, render sync, save/load plumbing. Don't build editors for things nobody would edit.

When it's genuinely ambiguous, say which way you're leaning and why, then ask. Over-tooling is as costly as under-tooling — a panel nobody opens is dead weight the kernel carries forever.

### AI-generated content

AI may create assets, scenes, prefabs, and data — including content produced via image and 3D generation models as those get integrated into the pipeline. Whether any given piece ships or gets replaced by human-authored work is the human's call, made per-piece, not a standing rule. Conditions:

1. **Mark it.** Every AI-authored file carries `"generatedBy"` and a date in its JSON, or in the `.meta` sidecar for binaries. Schemas must permit these fields. This keeps the record straight for Steam disclosure and for knowing at a glance what's still scaffolding.
2. **It must align with the tools.** Generated content conforms to the same schemas and conventions as human-authored content: scenes, prefabs, and data files open, edit, and re-save cleanly in the editor; generated art and models import correctly with valid `.meta` sidecars and behave normally in the level editor. This does *not* mean images or 3D models are editable in-engine — they aren't, and shouldn't be unless specifically requested. It means nothing generated is a special case the tools can't handle.
3. **Prefer the tool path.** Where practical, produce content by driving the editor's own tools or public APIs rather than hand-writing files. This exercises the tool, catches format drift, and guarantees the output is loadable.
4. **Never overwrite human work.** If a file lacks the `generatedBy` marker, treat it as human-authored: don't modify or delete it. Ask instead.

## Architecture (three layers, all text)

1. **Runtime** — ships with the game. Phaser 4 + TypeScript strict. Loads the text formats and plays the game. Zero editor code.
2. **Editor** — never ships. Vite web app (React + docking layout + Zustand/immer) embedding the actual runtime as its viewport. Node sidecar (chokidar + REST + WebSocket) owns the filesystem.
3. **Data** — the game itself as human-readable JSON. Sidecar `.meta` files next to binary assets, Unity-style. Stable IDs paired with human-readable paths in all references. Every format defined as a Zod schema — the schema file is the single source of truth.

All editor mutations go through the transaction API (document-level undo via immer patches). Never implement per-tool undo. Never create a second serialization path.

## Folder map

Two distinct structures are in play. **This repo** is the editor software. A **game project folder** is what the editor opens — a separate folder, one per game.

### This repo (`kernel-2d/`) — the editor software, 100% AI-owned

| Folder | What it is |
|---|---|
| `runtime/` | The engine: Phaser 4 setup, render loop, entity/component layer, input, and the loaders that turn project JSON into a running game. **The only part that ships inside an exported game.** Contains zero editor code — that separation is what keeps exports clean. |
| `editor/` | The editor web app: React panels, docking layout, asset browser, inspector, viewport wrapper, gizmos, transaction/undo system. Imports `runtime/` as a library and embeds it as the viewport, so the editor preview is the actual game. Never ships. |
| `sidecar/` | The Node background process that owns the disk: chokidar file watching, `.meta` generation, JSON read/write API, static asset serving. Development-only, never ships. |
| `tests/` | Vitest unit tests and Playwright browser tests. Sample data lives in `tests/fixtures/` — never in a real content folder. |
| `docs/` | The feasibility report; genre specs as they're written. |

Plus root-level `CLAUDE.md`, `.gitattributes`, `package.json`, and the symlink to the `gamedev-skills` library.

### A game project folder (`my-game/`) — the game itself, as text

| Folder | What it is |
|---|---|
| `assets/` | Raw art, models, and audio in whatever structure the human chooses (conventionally `textures/`, `models/`, `audio/`). **The asset browser mirrors this 1:1** — no import step, no copying, no renaming. Each binary gets a `.meta` sidecar beside it (`knight.png` + `knight.png.meta`) holding import settings: sprite slicing, pivot, pixel-art filtering, collision generation. The `.meta` is how the editor annotates files without touching them. `assets/source/` optionally holds `.blend`/`.psd` originals the engine ignores. |
| `scenes/` | Levels as JSON — entity lists with components, transforms, and asset references. One file per level. |
| `prefabs/` | Reusable entity templates. Define an enemy once, place it fifty times by reference; editing the prefab updates every instance. |
| `data/` | Genre-specific tables that aren't scenes or entities: wave schedules, item databases, dialogue, economy curves. This is what bespoke genre tools write to. |
| `src/` | Gameplay code for *this specific game*, AI-written: `components/` for data schemas (Health, Velocity, AttackPattern), `systems/` for behavior (MovementSystem, CombatSystem). Distinct from the kernel's `runtime/`, which is the reusable engine. |
| `project.json` | Project settings: startup scene, input map, window size. |

The split to hold in mind: **in this repo, everything is AI's. In a game folder, `src/` is AI's and the rest is the human's** — with AI-generated content permitted there under the marking rules above.

## Phaser 4, not Phaser 3

Training data skews heavily Phaser 3. **Check the vendored Phaser 4 docs before writing Phaser code — do not trust memory.** The `phaser4-runtime` skill's gotcha G1 lists the known silent failures (`Math.TAU` value change, `roundPixels` default flip, buffered DynamicTexture draws) and removed APIs. Pin the exact Phaser version; never upgrade it casually.

## Definition of done (every session)

1. `tsc --noEmit` (strict) passes.
2. Vitest passes, including round-trip tests (`load(save(x)) === x`) for every schema touched.
3. Playwright smoke pass is green; visual changes are screenshot-verified.
4. **Dual-write:** the relevant SKILL.md files are updated. A session must either record at least one new Decision, Gotcha, or Contract, or state plainly that nothing new was learned and why. A code change without a skill update is an incomplete change, same as a change without tests.
5. **Both repos clean.** Skill edits land in the linked `gamedev-skills` repo — commit and push there as well as here. Commit before starting work and after finishing.
6. **Hand off a test plan.** End every session with concrete steps for the human to verify by hand ("open the editor, drop a PNG in assets/textures, confirm it appears within a second"), phrased as observable behavior.

No session ends red. If checks fail, fix them or revert. If work must stop mid-feature, park it on a branch marked WIP — never leave `main` red.

## Tests assert behavior, never implementation

Tests check behavior, data formats, and schemas — never internal structure. Any kernel that satisfies the suite is a valid kernel; this is what makes regeneration from skills possible.

## Session conduct

- **One feature per session.** Build exactly what was asked. Propose adjacent improvements; don't perform them unasked.
- **Stop and ask.** When a standing rule blocks the requested work, stop and ask. Never interpret around a rule, and never silently choose the workaround.
- **Dependencies are proposed, not added.** Before installing anything new, name it, say what it replaces or adds, and wait.
- Plan mode first for anything nontrivial; plans are reviewed in plain language.
- **Report in designer language** — capabilities ("the inspector now supports color fields; undo covers path edits"), never implementation ("refactored the store"). If a report can't be phrased without code terms, recalibrate.
- Acceptance criteria are observable behaviors. If a requirement can't be phrased without mentioning code, ask for clarification instead of guessing.
- End any session that hit a snag with: what did we learn that isn't yet in a skill? Draft the additions.
- A second model (ChatGPT) reviews diffs at end-of-feature. Prepare diffs cleanly for handoff when asked.

## Skills

The skill library lives in the linked `gamedev-skills` folder and loads into every session. It is the real engine; this codebase is its currently-cached output. Treat skill updates with the same rigor as code. Keep three registers distinct: **decisions** (with reasons), **gotchas**, and **contracts** (schemas/APIs referenced as file paths, not paraphrased prose).
