# Prompting the Tools, Not the Game
## Feasibility Report & Recommended Stack for AI-Built, Genre-Specific Game Editors

**Prepared for:** Zach / Unreal Sensei
**Date:** August 6, 2026

---

## 1. Executive Summary

**Verdict: Highly feasible — and you're proposing the correct methodology.** The "prompt for the tools, not the game" approach is the single biggest unlock in AI-assisted game development right now, and almost nobody is doing it deliberately. Prompting a model to "make a platformer" produces a fragile demo. Prompting a model to build a *level editor, an entity inspector, a tilemap painter, and a data-driven behavior system* — and then hand-authoring your game inside those tools — produces something that compounds. Every hour of AI work goes into infrastructure you keep, and every design decision stays human. That last clause is the real unlock, and worth stating as the thesis of this whole document: this methodology is the structural antidote to slop. A "one-shotted" AI game is a probability cloud — nobody chose anything, so it reads as generic because it *is* generic, an average of everything in the training data. In your model, the AI never makes a single creative decision: every sprite, every enemy placement, every difficulty curve, every second of pacing exists because you put it there, through tools built to express your intent. The output is a fully human-authored game with full creative control — it just happens to have been made by a designer whose engine team is a frontier model. (The Steam AI-tag benefit, covered in Section 2, is real and substantial, but it's downstream of this: the game avoids the tag because it genuinely isn't AI-generated content.)

Your instincts on the stack are correct with minor adjustments:

**For 2D:** Phaser 4 (released April 2026, now at 4.1.x+) running inside a custom web-based editor shell. Phaser 4's ground-up renderer rewrite and clean TypeScript API make it the strongest 2D target for AI code generation today.

**For 3D:** Three.js with the WebGPURenderer (production-ready since r171, automatic WebGL 2 fallback), TSL for shaders, and an ECS data layer on top. Three.js is the most heavily represented 3D library in every frontier model's training data, which matters more than raw features for this workflow.

**For the editor shell (both):** A local web app served by Vite, with a small Node.js sidecar process that owns the filesystem — file watching, asset scanning, and JSON read/write. This is what makes the 1:1 asset browser and "everything is text" requirements trivial rather than painful. Package it in Tauri later if you want a double-clickable app.

**On skills: yes, emphatically.** A custom skill library is the difference between "relatively from scratch each time" being a two-week grind versus a two-day sprint. The report below specifies exactly which skills to build and how the kernel/genre split should work so each new genre editor gets faster to produce, not slower.

**On the pure vibe-coding constraint** — you never read a line of code; you touch only art, levels, and game design — this is workable, but only because this specific architecture replaces human code review with four mechanisms: behavior-phrased acceptance criteria, an automated test gate, cross-model code review (ChatGPT reviewing Claude's diffs), and designer-language session reports. Section 9 formalizes this as "the vibe-coding contract." Without those mechanisms, never-look-at-the-code collapses within a few weeks of accumulated entropy; with them, it's a sustainable division of labor.

One piece of genuinely good news up front, covered in detail in Section 2: as of Valve's January 2026 policy clarification, AI-generated *code* does not trigger the Steam AI disclosure at all. Your plan is even cleaner from a store-page perspective than you may have assumed.

---

## 2. The Steam AI-Tag Question (A Major Secondary Benefit)

To be clear about the hierarchy: the core motivation for human-authored everything is creative control — the anti-slop guarantee laid out in Sections 1 and 3. But the Steam question is a huge practical benefit riding alongside it, and worth settling before any technical detail because the news is better than you may have assumed.

<time datetime="2026-01-17">In January 2026</time>, Valve rewrote the Steam AI disclosure form to clarify its scope. Developers must disclose pre-made generative AI content only when it appears in marketing materials or content that ships with the game and is consumed by players — final art, sound, writing, and similar. The disclosure requirement is explicitly *not* concerned with AI tools used behind the scenes for efficiency gains, which includes coding assistants. Reporting on the change was consistent across outlets: developers do not need to disclose AI-powered workflow tools like code helpers, only AI used to generate content for the game or AI content generated during gameplay. Valve's own language in the form states that efficiency gains through AI-powered tools are not the focus of the disclosure section, and community guides now state plainly that code from assistants like Claude Code, Copilot, and Cursor is exempt under the efficiency-tool clause.

The practical read for your plan:

**Clearly exempt:** The editors and tools themselves (they don't ship to players at all), and gameplay code written with AI assistance — movement controllers, attack patterns, state machines, save systems. Under the current policy this is workflow tooling, not player-consumed generated content.

**Clearly requires disclosure:** Any AI-generated art, audio, voice, or written dialogue that ships in the game or appears on the store page. Your "all art is human-crafted" rule keeps you entirely clear of this bucket.

**Worth a caveat:** One legal analysis notes a residual gray zone between "AI helping a human write code" and "AI generating shippable code wholesale," and Valve's policies have been rewritten twice already — the trajectory has been toward *more* permissiveness on code, but re-check the form language at submission time. Also note the disclosure is a free-text field shown on the store page, not a binary "AI tag," so even developers who do disclose control the framing. (Standard note: I'm not a lawyer and this isn't legal advice — for a shipped commercial title, have counsel read the current Steam Distribution Agreement language.)

Strategically, your human-made-art constraint is the right call regardless of policy, because the community backlash that actually tanks games is almost entirely about visible AI art and voice, not code. Human-crafted art plus a devlog showing your editor-building process is arguably the strongest possible positioning: you get the "solo dev built their own engine" halo, which players love, powered by AI leverage players never see.

---

## 3. Why "Tools, Not Games" Is the Right Methodology

It's worth being precise about *why* this works, because the reasons dictate the architecture choices later in this report.

**Intentionality — the anti-slop guarantee.** Slop isn't an aesthetic accident; it's what unauthored decisions look like at scale. When a model one-shots a game, thousands of micro-decisions — enemy spacing, color relationships, timing windows, level rhythm — get filled in with the statistical average, and players feel the absence of a mind even when they can't name it. The tools-not-games split makes the opposite structurally true: the AI's output is *capability* (a spline editor, a wave designer), and only your hands turn capability into *content*. Every edit and change in the shipped game is intentional and human-made, which means taste — the thing you actually bring from a decade of Unreal work — is the bottleneck resource, exactly where a creative bottleneck should be.

**Verifiability.** The fundamental problem with "prompt me a game" is that game feel is unverifiable by the model. Claude cannot feel whether a jump is floaty. But Claude can absolutely verify that a tilemap painter writes correct JSON, that an undo stack round-trips, that a gizmo translates a transform. Tools have testable contracts; games have vibes. By restricting AI to the tool layer, you put the model exclusively on problems where it can self-check, and you keep the unverifiable aesthetic layer — where you are world-class — human.

**Leverage asymmetry.** A generated game is consumed once. A generated tool amortizes across every level, every asset, every iteration, and (with the kernel approach in Section 5) every future genre. This is the same insight behind your browser editor startup, applied at personal scale: the AI layer is the wedge, the tooling is the compounding asset.

**Context economics.** A whole game exceeds any context window and degrades as it grows. A well-factored editor is a set of small, independent tools — asset browser, inspector, scene view, genre-specific painters — each of which fits comfortably in context. This is also why "everything is text" isn't just an AI-readability nicety: it means Claude can inspect the *live state of your game data* (scenes, prefabs, entity definitions) with `cat` and `grep` while working, which transforms debugging.

**The Bret Victor / "build your own engine" tradition.** What you're describing is how serious studios have always worked — the tools team *is* the engine team — except the tools team is now a frontier model and the studio is one person. The methodology has a long pedigree; AI just collapsed its cost by two orders of magnitude.

The one place to hold the line: resist the temptation to let the AI "just quickly generate this one level" when a tool doesn't exist yet. The moment level data is authored by prompt instead of by tool, you've broken the human-design guarantee and the data stops reflecting your intent. The rule is absolute: **AI writes code that writes files; only you write files through the tools.** (The narrow exception is migration scripts — AI writing a one-off script to convert data formats is tooling, not authorship.)

---

## 4. The Architecture: Three Layers, All Text

Every genre editor you build — 2D or 3D — should be the same three-layer shape. This shape is what makes the process repeatable, and it's what your skills will encode.

### Layer 1: The Runtime (ships with the game)

A small, dependency-light package that knows how to load your text formats and play the game. It contains the render loop (Phaser or Three.js), the ECS/entity layer, the input system, and the gameplay code the AI generates (movement controllers, attack patterns, spawners, AI behaviors). Crucially, the runtime has **zero editor code** in it. The exported game is the runtime plus your data plus your assets, and nothing else.

Because that runtime is web-native, one export pipeline yields both deployment targets. **Browser build:** Vite production build → static files you can host anywhere (your own site, itch.io, a course platform) — the game runs at a URL with no install, which is also ideal for playtesting and sharing devlog builds. **Desktop build (.app/.exe):** the same build wrapped in a native shell for Steam and direct distribution. Use Tauri for the lightest binaries, or Electron if you want the most battle-tested Steamworks path — the `steamworks.js` ecosystem (achievements, cloud saves, overlay) is Electron-first, and most shipped web-tech Steam games (Vampire Survivors among them) took this route. Either way it's a packaging step over identical game code, so the decision is deferrable and reversible; have Claude build both export targets into the kernel as one-command scripts (`npm run export:web`, `npm run export:desktop`) so every genre editor inherits them.

### Layer 2: The Editor (never ships)

A web app that imports the runtime as a library and embeds it as a viewport. Around that viewport live the tools: asset browser, hierarchy, inspector, and the genre-specific authoring surfaces (tile painter, spline editor, wave designer, dialogue graph — whatever the genre demands). Because the editor embeds the *actual runtime*, there is no "looks different in the editor" divergence, and a Play button is just instantiating the runtime with live data. This is the Godot/Unity architecture, and it's the correct one.

### Layer 3: The Data (the game itself, as text)

This is where your "everything is text" requirement becomes a formal spec. All authored content lives in the project folder as human-readable, git-diffable, AI-greppable files:

```
my-game/
├── project.json              # project settings, startup scene, input map
├── assets/                   # ← the asset browser mirrors THIS, 1:1
│   ├── textures/
│   │   ├── knight.png
│   │   └── knight.png.meta   # sidecar: import settings, sprite slicing, pivot
│   ├── models/
│   │   ├── tower.glb
│   │   └── tower.glb.meta    # sidecar: scale, collision generation, LOD config
│   └── audio/
├── scenes/
│   ├── level_01.scene.json   # entity list: components, transforms, asset refs
│   └── main_menu.scene.json
├── prefabs/
│   ├── enemy_grunt.prefab.json
│   └── pickup_coin.prefab.json
├── data/                     # genre-specific: wave tables, dialogue, item DBs
│   ├── waves.json
│   └── items.json
└── src/                      # AI-generated gameplay code (TypeScript)
    ├── components/           # data schemas (Health, Velocity, AttackPattern)
    └── systems/              # behavior (MovementSystem, CombatSystem)
```

Three format rules that pay for themselves many times over:

**Sidecar `.meta` files, Unity-style.** The binary asset (PNG, GLB, WAV) stays exactly where you put it from Photoshop or Blender; a JSON sidecar next to it holds everything the engine needs to know about it (sprite slicing, pixel-art filtering, pivot points, collision mesh settings, texture compression). This is what makes each file a "self-contained asset" in your browser while keeping the folder structure exactly 1:1 with disk — the editor never copies or renames your files, it only annotates them. It also means Claude can read and reason about every import setting.

**Stable IDs, human-readable references.** Every entity, prefab, and asset gets a short stable ID (generated once, stored in the meta/scene file), but references in JSON should carry both the ID and the human path (`"sprite": {"id": "a3f9", "path": "assets/textures/knight.png"}`). IDs survive renames; paths keep the files greppable and let the AI understand a scene by reading it. A small "fixup" tool reconciles them when files move.

**Schema-validated everything.** Define every file format as a Zod schema in the runtime (`SceneSchema`, `PrefabSchema`, `MetaSchema`). The runtime validates on load, the editor validates on save, and — critically — the AI reads the schema file as the single source of truth for what the data can contain. When you (or Claude) add a component type, the schema changes in exactly one place, and `tsc` plus the validators immediately reveal every tool that needs updating. This is your primary defense against the most common failure mode of AI-built editors: serialization drift, where the save format and load format quietly disagree.

---

## 5. Resolving "From Scratch Each Time": the Kernel/Genre Split

You said each genre build should be "relatively from scratch... although I want systems and skills to make it easier." The way to have both is to be explicit about what regenerates and what persists:

**The kernel persists (a template repo you own and evolve).** Roughly 60% of any editor is genre-agnostic: the Vite + TypeScript scaffold, the filesystem sidecar, the asset browser, the meta-file system, the scene/prefab serialization core, undo/redo, the inspector framework, the play-in-editor harness, and the test setup. Build this once per dimension — a `kernel-2d` (Phaser) and a `kernel-3d` (Three.js) template repo — with heavy AI help, then stop regenerating it *casually*: undo/redo and serialization are exactly the systems you never want rewritten ad hoc, because they're where subtle bugs live. (Deliberate, test-gated regeneration is a different matter — see "Option C" below.)

**The genre layer regenerates (this is the fun part).** Each new game starts by forking the kernel, then prompting the genre-specific tooling into existence: for a tower defense, a path-spline editor, a wave-table designer, a tower placement grid; for a metroidvania, a room-graph editor, an ability-gate annotator, a camera-zone tool; for a tactics game, a hex/grid editor with elevation painting and a unit-stat database UI. This layer genuinely benefits from being purpose-built each time — a bespoke wave designer beats a generic timeline for a TD game — and it's small enough (each tool is a panel + a data format + a system) that Claude produces it quickly and reliably against the kernel's established patterns.

**The skills encode the *knowledge* of both layers** (Section 10), so even when code is written fresh, the architecture, conventions, and hard-won gotchas carry forward. Skills are how "from scratch" gets faster every time instead of resetting to zero.

A note on undo/redo, since it's the kernel's hardest problem: make it data-level, not action-level. Because all authored state is JSON, undo can be implemented once as document snapshots/patches (immer or JSON-patch on the in-memory scene document) rather than as per-tool inverse commands. Every future genre tool then gets undo for free just by mutating the document through the kernel's transaction API. This single decision removes the #1 source of editor jank in AI-generated tools.

### The chosen paradigm: a self-regenerating kernel ("Option C")

The kernel/genre split above admits two pure strategies — maintain the kernel repo forever (accumulated trust, but eventual ossification and drift from current libraries and models), or keep only skills and regenerate everything from scratch each game (always fresh, but you re-pay the hard-systems tax and re-debug novel variations of undo and serialization every time, with no code-reading backstop). The paradigm this project adopts is the synthesis: **the kernel is built for reuse, and is simultaneously condensed into skills that can regenerate a refreshed kernel on demand.** The skills are the real engine; the kernel repo is the currently-cached compilation of them; the persistent test suite is the contract that lets the code be disposable without the knowledge ever being lost.

Four disciplines make this real rather than aspirational:

**Dual-write, enforced as definition-of-done.** Every kernel session ends with two commits — the code change and the matching skill update, written by the same model in the same session while the reasoning is still in context. The standing `CLAUDE.md` rule: *a kernel change without a skill update is an incomplete change, same as a change without tests.*

**The parity drill.** The failure mode is silent divergence — the kernel absorbs fixes, the skills lag, and a future "refresh" would regenerate old bugs. Since no human reads the code, divergence is caught mechanically: periodically (after each shipped genre, or quarterly), Claude regenerates a fresh kernel *from the skills alone* in a scratch directory and runs the real kernel's full test suite against it. Failures mean either the skills are missing knowledge (update skills) or a test encodes an accident rather than a requirement (update test). A clean parity drill is proof the refresh option is real.

**Tests as the third persistent asset.** In this paradigm the artifacts that survive forever are the skills (the why and how) and the tests (the contract); code is disposable. Tests therefore assert behavior, data formats, and schemas — never implementation details — so that *any* kernel satisfying them is a valid kernel. This rule lives in the `editor-verification` skill.

**Event-driven refresh, not scheduled.** The regenerate trigger is a major library break (Phaser 5, a Three.js/TSL shift), a model-generation jump, or the entropy smoke alarm (session costs trending up on similar-sized features). The old kernel isn't retired until the new one passes the full suite *and* one genre has been rebuilt on it.

Skill files supporting regeneration should keep three registers distinct: **decisions** (document-level undo via immer patches, sidecar metas, stable-ID+path refs — each with its recorded reason), **gotchas** (the accumulated cheat sheets), and **contracts** (the Zod schemas and API shapes, referenced as files rather than paraphrased as prose). Prose alone regenerates vibes; decisions + contracts + tests regenerate the kernel. The cost of the whole paradigm is roughly 10–15% overhead per kernel session for the dual-write, plus a few hours of tokens per parity drill — cheap for what it buys: Option A's accumulated trust with a permanent escape hatch from Option A's ossification.

### Distribution: the skills as a product

The same paradigm makes the kernel distributable in two tiers, and the second is the differentiated one. The **fork tier** hands people the reference kernel repo — a working editor in ten minutes, your decisions frozen inside. The **generate tier** hands them the skill library plus the test suite, and they watch their own machine build their own kernel — generated in their environment, against current library versions and whatever model they run, owned rather than forked. For an audience being taught to vibe-code (who, like the author, will never read the code), the generate tier *is* the pedagogy: the product and the lesson are the same artifact.

Distribution adds three requirements beyond personal use. **The test suite ships with the skills as the warranty** — a bundled verification script ("run this; green means your kernel is valid") is the only way a stranger can trust a generation they'll never read; skills without a conformance suite are a prompt and a hope. **Clean-room generation becomes the release gate** — before any skill release, the parity drill must pass on a fresh machine/container with no access to the reference kernel, on both macOS and Windows, and ideally across more than one model, since every clean-room failure is a hidden environmental assumption smoked out. **Skills are versioned like software with pinned library ranges** (e.g. "skills v1.2 targets Phaser 4.1–4.2") so an upstream rename breaks a release note, not every customer's Tuesday; the bundled suite then triages support cleanly — failing verification separates "regenerate, your run went sideways" from "the skill has a gap, patch incoming." The reference kernel doubles as the known-good output for support comparisons, and every personal parity drill doubles as a release-candidate test — the personal discipline and the commercial pipeline are the same loop.

---

## 6. The 2D Stack in Detail (Phaser 4)

Phaser 4 is the right call. It shipped its stable 4.0 release in April 2026 — a ground-up rebuild of the WebGL renderer around a node-based render architecture, a unified filter system, and GPU-powered sprites, while keeping the familiar API — and it's now at 4.1.x with an active release cadence. The API surface is enormous in training data (with the caveat below), the community has already produced a wave of "build games with Phaser 4 + AI coding tools" content, and it handles the unglamorous 90% of 2D engine work (atlases, animation, tilemaps, cameras, arcade physics, audio) so the AI's effort goes into *your tools*, not into reinventing sprite batching.

**The stack Claude should generate against:**

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Types are the AI's guardrails; `tsc --noEmit` is a free correctness check every iteration |
| Engine | Phaser 4 (pin exact version) | Renderer rewrite, stable API, huge training presence |
| Build/dev | Vite | Instant HMR = tight AI iteration loop; official Phaser templates exist |
| Editor UI | React + a docking layout (e.g. Dockview) | Panels, trees, and inspectors are React's home turf and the AI's strongest UI idiom |
| State (editor) | Zustand + immer | Simple stores; immer patches give you undo/redo nearly free |
| Data validation | Zod | Runtime + compile-time schema in one definition |
| Physics | Phaser Arcade (default), Box2D/Rapier2D only if the genre demands | Arcade covers most genres and is far easier for AI to reason about |
| Testing | Vitest (logic) + Playwright (editor E2E + screenshots) | The verification loop in Section 9 depends on this |

**Editor-viewport integration:** run the Phaser game instance inside a canvas in the editor's center panel, with the editor in a special "edit scene" that renders the loaded scene data plus editor-only overlays (grid, selection outlines, gizmos) drawn via Phaser's Graphics layer. Play mode destroys the edit scene and boots the runtime's real scene loader against the same JSON — same window, honest preview.

**Two Phaser 4 gotchas to encode in your skill immediately:** (1) the NPM import changed — `import * as Phaser from 'phaser'`, not the v3-era default import; models trained mostly on Phaser 3 will get this wrong constantly. (2) More broadly, Phaser *3* dominates training data (v4 stabilized only in April 2026), so your `phaser4-runtime` skill should carry a "v3→v4 differences" cheat sheet (render nodes and the unified Filter system replacing the v3 pipeline/FX/mask APIs, the tint overhaul, etc.) and instruct the model to check the bundled API docs rather than trust memory. Vendor the Phaser 4 `.d.ts` files and changelog into the repo so the model can grep ground truth.

**Asset flow from Photoshop:** export PNGs (or Aseprite files if you adopt it for animation — its format is scriptable and its CLI can auto-export). The editor's import step is just "file appears in `assets/`, sidecar gets generated with sane defaults, sprite slicer tool edits the sidecar." For atlases, have Claude build a small atlas-packing step into the export pipeline (free-tex-packer-core or similar) rather than atlas-ing during authoring — you author against raw files, the exporter optimizes.

---

## 7. The 3D Stack in Detail (Three.js)

Three.js is the right default, and the timing is good: the WebGPURenderer has been production-ready since r171 with automatic WebGL 2 fallback, WebGPU reached effectively universal browser support in late 2025, and TSL (Three Shading Language) is now the first-class way to write shaders once and compile to both WGSL and GLSL. New material features are TSL-first going forward. For you specifically there's a compounding benefit: every hour spent in Three.js/WebGPU territory feeds directly into your startup's technical context.

**The stack Claude should generate against:**

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Same reasoning as 2D |
| Engine | Three.js, WebGPURenderer, pinned release | Largest 3D training-data footprint of any library; WebGPU headroom |
| Shaders | TSL node materials | Cross-compiles WGSL/GLSL; composable; the future of Three materials |
| ECS | bitecs (data-oriented) or miniplex (friendlier) | Three.js gives you a scene graph, not a game architecture — the ECS *is* your engine's spine and the AI's contract for gameplay code |
| Editor UI | Same React + docking + Zustand + Zod kernel as 2D | One kernel UI stack, two viewport types |
| Physics | Rapier3D (via `@dimforge/rapier3d-compat`) | Fast, WASM, deterministic-ish, well known to models |
| Asset format | glTF/GLB exclusively for models; KTX2/Basis for shipped textures; Draco/meshopt compression at export | glTF is Blender's first-class export and the web's native 3D format |
| Camera/controls | Custom editor controls (orbit/fly) in the kernel | OrbitControls-style code is deeply familiar to models |
| Testing | Vitest + Playwright with WebGPU flags + screenshot diffing | Visual regression matters much more in 3D |

**Why not Babylon.js?** Babylon is genuinely strong here — it has a built-in inspector, a mature serialization story, and an official editor — and if you wanted to *adopt* an editor it would win. But you're *building* the editor, so Babylon's editor tooling is dead weight, and Three.js beats it decisively on the two axes you care about: model fluency (the volume of Three.js in training data is unmatched) and alignment with your WebGPU-centric startup work. Stick with your instinct.

**The ECS decision is the important one.** Raw Three.js code from an LLM tends toward the "everything in one animate() closure" style of its training examples. Don't let gameplay live there. The runtime's contract should be: *components are Zod-schema'd data, systems are pure-ish functions over queries, Three.js objects are a render layer synced from ECS state.* This gives AI-generated gameplay code (the attack patterns, the movement controllers) a rigid, testable shape — a `PatrolSystem` can be unit-tested with zero rendering — and it makes scene JSON trivially serializable because entities are data all the way down. bitecs if you want performance headroom and don't mind its terse style; miniplex if you want code that reads like the JSON it serializes to. For your purposes I'd lean **miniplex**: legibility (for you and the model) beats raw throughput for authored, non-massive games.

**Blender flow:** author in Blender, export GLB into `assets/models/`, sidecar meta declares import scale, whether to auto-generate colliders (convex hull / trimesh / box), and which animations to register. Have Claude build a small `gltf-transform` post-import step (it's the standard tool) for normalization: apply scale, prune unused nodes, optionally meshopt-compress on export. Keep source `.blend` files in the project too (e.g. `assets/source/`, ignored by the engine) so the whole project remains one folder, one git repo.

---

## 8. The Editor Shell and the 1:1 Asset Browser

The asset browser requirement — a literal mirror of the folder structure, files as self-contained assets — is the reason to make one specific architectural choice: **the editor is a local web app plus a tiny Node sidecar that owns the disk.**

Browsers can't watch folders or write files freely; the File System Access API exists but is Chromium-only, permission-prompty, and can't push change events. A ~300-line Node process (Express or Fastify + chokidar + a WebSocket) solves everything cleanly:

```
┌────────────────────────────┐        ┌──────────────────────────┐
│  Editor (browser, Vite)    │  WS/   │  Sidecar (Node)          │
│  React panels + viewport   │◄──────►│  chokidar file watcher   │
│  Phaser/Three runtime      │  HTTP  │  asset scan + meta gen   │
│                            │        │  JSON read/write API     │
│                            │        │  serves /assets statics  │
└────────────────────────────┘        └──────────────────────────┘
                                                │
                                        my-game/ project folder
```

The workflow this enables is exactly what you described: save a PNG from Photoshop into `assets/textures/`, chokidar fires, the sidecar generates a default `.meta` sidecar if none exists, pushes an event over the WebSocket, and the asset appears in the browser panel with a thumbnail — no import dialog, no copy step, the folder *is* the database. Deleting or moving files in Finder is likewise just reflected. Blender saves a GLB; same thing, and the sidecar can even queue a thumbnail render.

Practical notes:

- **One command to run:** `npm run editor` starts Vite and the sidecar concurrently. The editor is "software that runs without AI" from day one — it's just a local web app.
- **Thumbnails:** generate texture thumbnails in the sidecar with `sharp`; generate model thumbnails in the editor itself (offscreen Three.js render on first sight, cached to a `.thumbs/` folder). 
- **Tauri later, not first.** When a genre editor matures and you want a double-clickable app (or to sell/share it), wrap the same web app in Tauri and swap the sidecar's HTTP calls for Tauri's fs/watch APIs behind the same interface. Starting with the sidecar keeps the dev loop maximally Claude-friendly — Playwright can drive it, curl can poke it, everything is inspectable.
- **Git as the safety net:** because every authored artifact is text (plus binary assets that rarely conflict), the project folder is a clean git repo. Have the AI commit before and after every session. Under the vibe-coding contract (Section 9) you never read these diffs yourself — git is your undo-of-last-resort and the AI's own audit trail, and the only diffs you ever glance at are the *data* files your tools write.

---

## 9. The AI Workflow: How to Actually Run This

### Claude Code as the primary instrument

Run this through Claude Code (terminal or desktop), not chat. The workflow that works, per feature:

1. **Plan first.** Use plan mode for anything nontrivial ("add a wave-table designer panel"). Review the plan — this is where you catch the model inventing a second serialization path or bypassing the transaction API.
2. **Small, verified increments.** One tool/panel/system per session. Each ends with `tsc --noEmit`, Vitest, and a Playwright smoke pass green.
3. **Fresh context per feature, persistent knowledge in files.** Long sessions degrade; instead of one marathon, keep the durable knowledge in `CLAUDE.md` + skills + the schemas, and let each session start clean. Given your existing habit of watching session costs with `/cost`, note that the schema-driven repo layout also keeps sessions cheap — the model greps schemas instead of re-reading the codebase.
4. **You never read the code.** Your review surface is behavior (does the tool work when you use it?), data (do the JSON files your tools write look right?), and the green/red of the automated checks. Code review is delegated entirely, per the contract below.

### The vibe-coding contract (you touch art, levels, and design — never code)

This is a workflow constraint, so make it a system, not a habit. The division of labor is absolute: **AI owns 100% of `src/`, `editor/`, `sidecar/`, tests, and build config; you own 100% of `assets/`, `scenes/`, `prefabs/`, and `data/` — and you author yours only through the tools, Photoshop, and Blender.** You will never open a code file, and the AI will never write a data file. Two symmetric guarantees, both mechanically enforced.

Never reading the code is viable *only because* everything else in this architecture is designed to replace human code review. Four mechanisms carry the load:

**1. Acceptance criteria in your language, not code's.** Every prompt ends with observable behavior: "when I drop a PNG in the folder it appears in the browser within a second," "dragging with snap on lands entities on 16px increments," "the spiral pattern fires 12 projectiles per revolution." You verify by *using the editor*, exactly like a game director reviewing a build. If you can't phrase the acceptance test without mentioning code, the feature isn't specified yet.

**2. The automated gate is the reviewer.** `tsc` strict, Vitest, round-trip invariants, and Playwright screenshots run on every session's work, and the standing rule in `CLAUDE.md` is that no session ends red. You never inspect the tests either — but you do occasionally *sabotage* one thing on purpose ("break the wave designer and confirm the checks catch it") to keep the gate honest.

**3. A second model is the code reviewer.** Since you won't read code, ChatGPT/Codex does: a standing end-of-feature step where Claude's diff is handed to the other model with a reviewer prompt ("find bugs, security issues, violations of the editor-kernel skill conventions, and any path where AI-written code modifies files under assets/, scenes/, prefabs/, or data/"). Findings go back to Claude to fix. Cross-model review catches a meaningful share of what a human reviewer would, and it costs you nothing but tokens.

**4. Report in designer terms.** Instruct Claude to summarize every session as *capabilities* ("the inspector now supports color fields; undo covers path edits"), never as implementation ("refactored the store"). If a summary you can't understand appears, that's the model drifting from the contract — say so and it recalibrates.

The honest trade-off: bugs will occasionally ship into your tools that a code-reading human would have caught, and you'll experience them as tool misbehavior rather than as a stack trace. That's fine — your recourse is the same as any software user's, just supercharged: describe the misbehavior, attach the screenshot, and let the AI (which *can* read the code, the logs, and the git history) do the forensics. The one discipline that keeps this cheap is small increments: a bug introduced in a one-feature session is trivially bisectable; a bug somewhere in a two-week mega-session is archaeology.

### The verification loop (the load-bearing part)

The single highest-leverage thing you can build in week one is the harness that lets Claude *see and test the editor it's building*:

- **Playwright drives the editor.** Claude launches the editor, clicks the tools, and screenshots the result. "Add a snap-to-grid toggle" becomes verifiable: place entity, toggle snap, drag, assert the JSON transform landed on the grid, screenshot the viewport.
- **Screenshot-based visual checks.** Claude reads images, so screenshots of the viewport close the loop for rendering work ("the gizmo renders behind the mesh — fix depth testing" becomes something the model can catch itself).
- **Headless data tests.** Because the runtime is data-in/data-out (ECS systems over JSON-defined entities), gameplay code the AI writes — movement, attack patterns, spawn logic — gets deterministic unit tests without any rendering: tick the system 60 times, assert positions.
- **Round-trip tests as a standing invariant.** `load(save(scene)) === scene` for every schema, run in CI on every change. This is the serialization-drift tripwire.

### Where ChatGPT/Codex fits

Use Claude Code as the builder and keep the OpenAI models in four lanes where a second frontier model earns its seat: (0) **the code reviewer** — under the vibe-coding contract this is its most important job, formalized above; (1) **architecture cross-examination** — paste your kernel design or a schema and ask for failure modes; disagreement between models is a cheap design review; (2) **spec drafting** — o-series/GPT-5-class models are good at turning "I want a roguelike deck-builder editor" into the genre spec document (Section 12) that Claude then implements; (3) **occasional bake-offs** on isolated, testable problems (e.g. "best data model for ability gating in a metroidvania"). Avoid interleaving two agents in the same repo simultaneously — one writer, many reviewers.

---

## 10. Yes, Build Skills — These Skills

Skills are the mechanism that makes "relatively from scratch each time" converge instead of reset. Every genre build will surface gotchas (a Phaser 4 API rename, the gizmo depth-test trick, a meta-file edge case); the discipline is that **every gotcha graduates from the session into a skill file**, so no lesson is ever paid for twice. Structure them as a personal skill library (a folder of `SKILL.md` files with supporting docs/scripts) that you symlink into every project.

The library that matches this methodology:

**`editor-kernel`** — The constitution. The three-layer architecture, the folder/format conventions, sidecar meta rules, stable-ID + path referencing, the transaction/undo API contract, "AI writes code that writes files; only humans author data," and the definition of done (tsc + tests + Playwright green). This is the skill every session loads.

**`text-formats`** — The schema playbook: how to design a new JSON format (Zod first, round-trip test second, migration script template third), versioning fields, and the fixup-tool pattern for renames.

**`phaser4-runtime`** — Phaser 4 specifics: the v3→v4 differences cheat sheet (wildcard import, render nodes, unified Filters, tint modes), scene-embedding-in-editor pattern, atlas/export pipeline, arcade physics conventions. Bundle or link the vendored v4 docs and instruct: *check docs, don't trust memory — your training skews v3.*

**`threejs-runtime`** — WebGPURenderer setup + WebGL fallback, TSL conventions (no raw GLSL strings), the ECS contract (components as Zod schemas, systems as pure functions, render-sync layer), Rapier integration, glTF import pipeline via gltf-transform, editor camera controls.

**`editor-ui`** — The React kernel idioms: docking layout patterns, inspector auto-generation from Zod schemas (huge win — new component types get inspector UI for free), asset browser + drag-and-drop conventions, gizmo implementation notes, keyboard shortcut registry.

**`editor-verification`** — How to test this codebase: Playwright launch recipe, screenshot conventions, the round-trip invariant, headless system-test patterns, "what to check before declaring done."

**`genre-spinup`** — The repeatability engine (Section 12): the step-by-step process for going from genre idea → genre spec → forked kernel → generated tools, including the spec template itself.

Then one thin skill *per genre you've shipped* (`genre-towerdefense`, `genre-metroidvania`, ...) recording that genre's data formats and tool designs, so a future similar game — or a course lesson — starts from a known-good design.

Two meta-recommendations: use the skill-creator tooling to scaffold these rather than hand-rolling the format, and treat the skill library itself as a git repo with the same review discipline as code. Under the Option C paradigm (Section 5), the kernel-related skills carry an extra obligation — the dual-write rule makes updating them part of every kernel session's definition of done, and the parity drill periodically proves they can regenerate the kernel unaided. For your businesses this library is also *directly monetizable*, and under Option C it's monetizable in its strongest form: bundled with the test suite, it is the "generate tier" product itself — customers regenerate their own kernel from it — as well as, almost verbatim, the curriculum spine for an "AI game development" course track and a differentiated asset for the SaaS idea.

---

## 11. Prompt Patterns That Work

The prompts below assume skills are loaded and are deliberately *contract-shaped* — they specify data formats and verification, never implementation minutiae.

**Kernel scaffold (run once per dimension):**

> Using the editor-kernel and phaser4-runtime skills, scaffold `kernel-2d`: Vite + TS strict workspace with `runtime/`, `editor/`, and `sidecar/` packages. Sidecar: chokidar watcher over a target project folder, REST for JSON read/write, WS for change events, auto-generates default `.meta` sidecars for new assets per the text-formats skill. Editor: docking layout with asset browser (1:1 folder mirror, thumbnails), empty viewport panel, inspector panel auto-generated from Zod component schemas. Define `SceneSchema` v1 with entities as component maps. Add the round-trip test and a Playwright smoke test that boots the editor and asserts a dropped PNG appears in the browser. Plan first.

**A genre tool (the recurring case):**

> We're building the tower-defense editor (see genre spec in `docs/genre-spec.md`). Add a **path spline tool**: a viewport mode for click-to-place waypoints forming enemy paths, draggable handles, per-path speed multiplier in the inspector. Persist to `data/paths.json` under a new Zod `PathSchema` with stable IDs. All mutations go through the transaction API so undo works. Verify: round-trip test for PathSchema, Playwright test that places 3 waypoints and asserts the JSON, screenshot the viewport with a path selected.

**AI-generated gameplay against human-authored data (the payoff case):**

> Implement `AttackPatternSystem` in the runtime. It reads `AttackPattern` components (already schema'd) authored in the editor — pattern id, projectile prefab ref, cadence, arc. Support patterns: `radial_burst`, `aimed_shot`, `spiral`. Pure ECS system, no rendering references. Unit tests: tick each pattern 5s at 60Hz with a fixed seed and assert projectile counts and spread angles. Do not modify any JSON in `data/` or `scenes/`.

Note the standing footer on that last one — *do not modify authored data* — worth adding to `CLAUDE.md` as a permanent rule so the human-authorship guarantee is mechanically enforced, not just intended.

**The graduation prompt (end of any session that hit a snag):**

> Before we finish: what did we learn this session that isn't yet in a skill? Draft the additions to the relevant SKILL.md files.

---

## 12. The Repeatability Playbook (Genre Spin-Up)

The process that turns "many genres" from aspiration into pipeline. Target after the kernel matures: **a working genre editor in 2–4 days, a shipped small game in weeks.**

**Step 1 — Genre spec (human + AI, ~1 hour).** A short markdown doc answering: what does the *designer* manipulate in this genre? For a TD: paths, waves, towers, economy curve. For a metroidvania: rooms, connections, ability gates, camera zones. Each noun becomes (a) a data format, (b) an authoring tool, (c) zero or more runtime systems. This doc is the whole contract; ChatGPT is genuinely good at stress-testing it ("what am I forgetting that TD designers need?").

**Step 2 — Fork the kernel (10 minutes).** `degit` your `kernel-2d` or `kernel-3d` template. Asset browser, inspector, undo, serialization, tests: already working.

**Step 3 — Formats first (half a day).** Prompt the Zod schemas + round-trip tests for every noun in the spec before any UI exists. Formats are the keel; tools and systems both hang off them.

**Step 4 — Tools, one per session (1–2 days).** Each authoring surface from the spec, built and Playwright-verified independently.

**Step 5 — Runtime systems (1–2 days).** The gameplay code that consumes the authored data — this is where "AI writes the character movement and attack patterns" happens, always against data you authored in the tools.

**Step 6 — Author the game (the actual fun, human-only).** Photoshop/Blender → assets folder → tools → game. AI is now optional, exactly as required; you reopen Claude Code only to add features.

**Step 7 — Graduate the knowledge (1 hour).** New `genre-x` skill; kernel improvements that emerged get upstreamed to the template repo. This step is what makes build N+1 faster than build N.

For content purposes, note that steps 1–5 are inherently filmable — "I built a bespoke tower-defense editor with AI in 3 days, then hand-made the game" is a stronger video and Steam devlog premise than any AI-makes-a-game demo, and it demonstrates the methodology without ever showing AI art.

---

## 13. Risks and Hard Parts (Eyes Open)

**Serialization drift** is the top structural risk; the Zod-single-source-of-truth + round-trip-CI pattern is the mitigation, and it must exist before the second tool does.

**Undo/redo** is the top quality risk; the document-level transaction API (Section 5) must be a kernel primitive, never per-tool.

**Phaser 3 contamination.** Models will emit v3 idioms into v4 code for at least the next year. Vendored docs + the cheat-sheet skill + `tsc` strictness catch most of it; expect to hand-fix some.

**Gizmos and viewport interaction math** (3D especially — raycasting through transforms, plane-constrained dragging, screen-space handle sizing) is the fiddliest code in any editor. Budget real iteration here; lean hard on screenshot-verified Playwright loops, and consider adopting a known-good reference (three.js TransformControls source) as the pattern the skill points at.

**The unread codebase.** Vibe-coding everything means quality can silently erode in ways behavior tests don't catch — duplication, dead code, creeping complexity that slows future sessions. Mitigation is a scheduled "gardening" session every few features: Claude audits its own codebase against the skills' conventions, the second model reviews the audit, and refactors land behind the same green gate. You still never look; you just order the cleaning. Watch one metric as your smoke alarm: if session times or costs for similar-sized features trend upward, the garden needs tending.

**Scope creep toward "building an engine."** The genre spec is the fence: if a tool isn't justified by a noun in the spec, it doesn't get built this cycle. Your kernel will *become* an engine over time — let that happen by accretion, not ambition.

**Performance ceilings** are real but distant: Phaser 4's rewritten renderer and Three.js/WebGPU (compute shaders, batched/instanced meshes) comfortably cover indie-scope 2D and stylized 3D. The genres to avoid on this stack are open-world streaming scale — which you'd use Unreal for anyway.

**Policy drift on Steam.** Low probability of reversal (the trend is permissive on code), but re-read the disclosure form at each submission.

---

## 14. Suggested Roadmap

**Weeks 1–2 — Kernel 2D.** Sidecar + asset browser + meta system + SceneSchema + inspector-from-Zod + transaction/undo + Playwright harness. Write `editor-kernel`, `text-formats`, `editor-ui`, `editor-verification` skills as you go — the dual-write rule applies from the very first session, since skills written alongside the code are the whole basis of Option C. Run the first parity drill at the end of week 2: it will fail, and each failure is a free itemized list of what the skills haven't captured yet.

**Weeks 3–4 — First genre, 2D.** Pick something tool-rich but runtime-simple (tower defense is ideal: spline tool, wave designer, grid placement, economy table). Ship a small complete game with hand-made art. Write `phaser4-runtime` and `genre-towerdefense` skills.

**Weeks 5–7 — Kernel 3D.** Port the kernel around a Three.js WebGPU viewport: editor camera, selection/raycast, transform gizmos, glTF import path, ECS runtime contract. This is the hardest stretch; the 2D kernel patterns derisk it.

**Week 8+ — First 3D genre** (e.g. a lane-based action game or third-person arena — genres where Blender assets shine and level tooling is bounded), then alternate genres as content/interest dictates, upstreaming kernel improvements each cycle.

By roughly the third genre, the honest description of what you'll own is: a personal, text-native, AI-legible game engine with per-genre bespoke editors; a skill library that provably regenerates that engine on demand (the parity drill is the proof) and that ships to others as a product in its own right; and a paper trail proving every pixel and every level was made by a human. That's the whole thesis, working.
