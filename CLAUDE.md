# CLAUDE.md — kernel-2d

This repo is the reusable game-editor kernel — **one kernel for 2D and 3D games alike** (`editor-kernel` D38; the `-2d` in the folder name is historical, see "One kernel, two dimensions" below). The methodology: **AI writes all code; the human (Zach) authors the art, levels, and game design that ship — and never reads code.**
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

1. **Mark it.** Every AI-authored file carries `"generatedBy"` and a date. **Three places, chosen by what the file can hold** — a JSON document carries it inside itself; a binary carries it in the `.meta` sidecar beside it; **a source file carries it in a comment.** Schemas must permit these fields. This keeps the record straight for Steam disclosure and for knowing at a glance what's still scaffolding.

   The third case is not a loophole, it is the only honest answer: a `.ts` has nowhere structural to put a marker, and a `.meta` beside code would be the asset pipeline annotating something that is not an asset — it would appear in the Assets panel as one. Whatever reads the marker must therefore know all three ways of carrying it, and any *new* kind of file that AI can author is a fourth answer to be decided rather than assumed.
2. **It must align with the tools.** Generated content conforms to the same schemas and conventions as human-authored content: scenes, prefabs, and data files open, edit, and re-save cleanly in the editor; generated art and models import correctly with valid `.meta` sidecars and behave normally in the level editor. This does *not* mean images or 3D models are editable in-engine — they aren't, and shouldn't be unless specifically requested. It means nothing generated is a special case the tools can't handle.
3. **Prefer the tool path.** Where practical, produce content by driving the editor's own tools or public APIs rather than hand-writing files. This exercises the tool, catches format drift, and guarantees the output is loadable.
4. **Never overwrite human work.** If a file lacks the `generatedBy` marker, treat it as human-authored: don't modify or delete it. Ask instead.

## Architecture (three layers, all text)

1. **Runtime** — ships with the game. TypeScript strict over a renderer chosen by the project's dimension: Phaser 4 for 2D, Three.js/WebGPU for 3D (not yet begun). Loads the text formats and plays the game. Zero editor code. An exported game carries the one renderer it uses, never both.
2. **Editor** — never ships. Vite web app (React + docking layout + Zustand/immer) embedding the actual runtime as its viewport. The viewport is the one panel that knows which dimension the project is. Node sidecar (chokidar + REST + WebSocket) owns the filesystem.
3. **Data** — the game itself as human-readable JSON. Sidecar `.meta` files next to binary assets, Unity-style. Stable IDs paired with human-readable paths in all references. Every format defined as a Zod schema — the schema file is the single source of truth.

All editor mutations go through the transaction API (document-level undo via immer patches). Never implement per-tool undo. Never create a second serialization path.

## One kernel, two dimensions

Decided 2026-09-03 (`editor-kernel` D38), superseding the report's "build this once per dimension" (§5) and its separate "Kernel 3D" (§14). A 3D game opens in this editor, in the same window with the same panels. The rules that follow:

- **Dimension is a project property**, declared in `project.json` beside the starting level. Nothing infers it from the assets or the scenes.
- **The shell is dimension-blind.** Assets, Outliner, Inspector, undo, saving, prefabs, the sidecar — none of it may branch on dimension. A panel that finds it needs to has found a viewport concern that leaked, and the fix is in the viewport.
- **The viewport and the runtime it embeds are what differ.** Neither dimension's renderer loads into a project of the other, and an export carries exactly one.
- **A panel that serves one dimension says so**, and is not offered to a project of the other — a tilemap painter does not appear in a 3D project.
- **The one shared format the dimension reaches into is the transform.** Today it is `x, y, rotation, scaleX, scaleY`; 3D needs three of each. That is the file every level is written in, so the change is made once, deliberately, with its round-trip tests — never by accretion.
- **Knowledge splits the same way:** `phaser4-runtime` for the 2D side, `threejs-runtime` for the 3D side, `editor-kernel` for what is shared.

The folder is still `kernel-2d`, the alias games import is still `kernel-2d`, and the launcher writes that name into every game. Renaming is its own session, with the browser suite and both games re-verified; until then the name is a label.

## Folder map

Two distinct structures are in play. **This repo** is the editor software. A **game project folder** is what the editor opens — a separate folder, one per game.

### This repo (`kernel-2d/`) — the editor software, 100% AI-owned

| Folder | What it is |
|---|---|
| `runtime/` | The engine: renderer setup (Phaser 4 today; Three.js once the first 3D project exists), render loop, entity/component layer, input, and the loaders that turn project JSON into a running game. **The only part that ships inside an exported game.** Contains zero editor code — that separation is what keeps exports clean. |
| `editor/` | The editor web app: React panels, docking layout, asset browser, inspector, viewport wrapper, gizmos, transaction/undo system. Imports `runtime/` as a library and embeds it as the viewport, so the editor preview is the actual game. Never ships. |
| `sidecar/` | The Node background process that owns the disk: chokidar file watching, `.meta` generation, JSON read/write API, static asset serving. Development-only, never ships. |
| `scripts/` | Development entry points and their settings — `npm run editor` lives here, along with the editor window's host/port knobs. Never ships. |
| `tests/` | Vitest unit tests and Playwright browser tests. Sample data lives in `tests/fixtures/` — never in a real content folder. |
| `docs/` | The feasibility report, and `using-the-editor.md` — the human's page of what the editor can do and how to run it. **Genre specs do not live here**: a spec belongs to a game, so it is `games/<name>/docs/GENRE-SPEC.md`, and G5 is checked against that file. |

Plus root-level `CLAUDE.md`, `.gitattributes`, `package.json`, and the symlink to the `gamedev-skills` library.

### A game project folder (`my-game/`) — the game itself, as text

| Folder | What it is |
|---|---|
| `assets/` | Raw art, models, and audio in whatever structure the human chooses (conventionally `textures/`, `models/`, `audio/`). **The asset browser mirrors this 1:1** — no import step, no copying, no renaming. Each binary gets a `.meta` sidecar beside it (`knight.png` + `knight.png.meta`) holding import settings: sprite slicing, pivot, pixel-art filtering, collision generation. The `.meta` is how the editor annotates files without touching them. `assets/source/` optionally holds `.blend`/`.psd` originals the engine ignores. |
| `scenes/` | Levels as JSON — entity lists with components, transforms, and asset references. One file per level. |
| `prefabs/` | Reusable entity templates. Define an enemy once, place it fifty times by reference; editing the prefab updates every instance. |
| `components/` | This game's own component types, described as JSON — one file each, naming the fields a `patrol` or a `door` has and how to show them. **The editor draws Inspector fields from these**, so a game adds an authorable noun by adding a file here rather than by a kernel change. A description buys an inspector and deliberately not validation: a level carrying a component nobody described is still carried untouched, and no file here can stop a level opening. |
| `data/` | Genre-specific tables that aren't scenes or entities: wave schedules, item databases, dialogue, economy curves. This is what bespoke genre tools write to. |
| `src/` | Gameplay code for *this specific game*, AI-written: `components/` for data readers (Health, Velocity, AttackPattern), `systems/` for behavior (MovementSystem, CombatSystem). Distinct from the kernel's `runtime/`, which is the reusable engine — and distinct from the top-level `components/` above, which is what the *editor* reads: one describes a component to a designer, the other reads it at sixty frames a second. Keeping the two in step is the game's job, and nothing but a test in the game's own folder can enforce it. |
| `docs/` | `GENRE-SPEC.md`, the human's plain-language fence around this game: what it is, what the player does, and the game's nouns. Nothing is built for a game unless a noun in its spec justifies it (`genre-spinup` G5). |
| `project.json` | Project settings: startup scene, input map, window size. |

The split to hold in mind: **in this repo, everything is AI's. In a game folder, `src/` is AI's and the rest is the human's** — with AI-generated content permitted there under the marking rules above.

## Phaser 4, not Phaser 3

Training data skews heavily Phaser 3. **Check the vendored Phaser 4 docs before writing Phaser code — do not trust memory.** The `phaser4-runtime` skill's gotcha G1 lists the known silent failures (`Math.TAU` value change, `roundPixels` default flip, buffered DynamicTexture draws) and removed APIs. Pin the exact Phaser version; never upgrade it casually.

## Definition of done (every session)

1. `tsc --noEmit` (strict) passes.
2. Vitest passes, including round-trip tests (`load(save(x)) === x`) for every schema touched.
3. Playwright smoke pass is green; visual changes are screenshot-verified.
4. **Dual-write:** the relevant SKILL.md files are updated. A session must either record at least one new Decision, Gotcha, or Contract, or state plainly that nothing new was learned and why. A code change without a skill update is an incomplete change, same as a change without tests.
   The decision includes **whether a new skill file is warranted**, not only which existing one to update. Create one when a distinct domain has accumulated several decisions or gotchas of its own, or when adding the knowledge to an existing skill would muddle what that skill is about. Do *not* create one for a single bug, a log of what was built, knowledge the source makes obvious, or anything that has not survived real use — a thin true skill beats a speculative one, and most sessions correctly create none. Knowledge true of one game only goes in that game's own `.claude/skills/`, not the shared library (`genre-spinup` S2).
5. **Update the human's page.** `docs/using-the-editor.md` says what the editor can do, how to run it, and what it deliberately cannot do yet. If a session changed any of those three, that page changes in the same commit — including deleting a line from "cannot do yet". If it changed none of them, say so. It is written in observable behavior with no code in it, and it is the human's page rather than a session's: the skills hold *why*, this holds *what*.
6. **Both repos clean.** Skill edits land in the linked `gamedev-skills` repo — commit and push there as well as here. Commit before starting work and after finishing.
7. **Hand off a test plan.** End every session with concrete steps for the human to verify by hand ("open the editor, drop a PNG in assets/textures, confirm it appears within a second"), phrased as observable behavior.

8. **Leave the ports free.** Anything a session started that listens on a port — the editor (5173, with its sidecar on 7331), a preview server, a test harness — is stopped before the session ends, whether or not the work went well. **Port 5173 belongs to the human's `Open editor.cmd` window**, and a session that walks away still holding it turns the next double-click into "Port 5173 is already in use", which reads as the editor being broken. Stop what you started rather than waiting to be asked; if a server is genuinely still needed at hand-off, say so by name and port in the report.

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

## Skills — the engine behind this codebase

The skill library lives in `gamedev-skills`, linked into this project and loaded into every session. **The skills are the real engine; this codebase is their currently-cached output.** The paradigm only works if the library grows alongside the kernel — a skill set that can't regenerate the code is stale, and periodic parity drills (regenerate from skills alone, run the real test suite against it) exist to prove it hasn't gone stale.

**Edit skills freely and directly.** The link points at the real library, not a copy. Updating it is the point of the work, not a side effect of it — never treat the skills as another repo's business, and never defer a skill update for time.

**What earns a skill entry:** knowledge that would be needed to rebuild the kernel from nothing. A **decision** with its reason ("document-level undo via immer patches, because per-tool undo is where editor jank comes from"). A **gotcha** with its fix. A **contract**, referenced as a file path rather than paraphrased as prose. Not a log of what was built this session — that's what commit messages are for. The test: if an entry wouldn't help a fresh session working on an empty machine, it doesn't belong in a skill.

Keep the three registers distinct within each skill, and record dates on entries so version-dependent knowledge can be aged out later.
