# Using the editor

This page is for the human, not for a session. It says what the editor can do
today, how to run it, and what it deliberately cannot do yet — in observable
behaviour, with no code in it.

It is kept current by the definition of done in `CLAUDE.md`: a session that
changes what you can do, or how you do it, changes this page in the same commit.
If this page and the editor disagree, the editor is right and the page is a bug.

Last true as of: **play mode** (2026-08-12).

---

## Running it

Everything needs one terminal, in the `kernel-2d` folder.

**Make a project to work in.** The folder has to exist first — the command fills
a folder, it does not create one:

```bash
mkdir ../my-game
```

```bash
npm run sample-project -- ../my-game
```

That writes sample content: pixel art, a sprite sheet, two levels, a prefab
placed twice, and import settings beside every asset. It prints how many files it
wrote and names any it left alone.

Safe to re-run: it refuses to touch any file that does not carry its generated
marker, and produces identical bytes each time, so re-running never churns the
folder.

**Open the editor on a project.** Starts the app and the filesystem service
together and prints the folder it resolved:

```bash
npm run editor -- ../my-game
```

Add `--port 7332` if it says the port is busy — usually another editor still
running. Ctrl-C stops both halves.

**Check everything still works:**

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

**There is no export command yet.** `npm run build:editor` builds the *editor*,
not a game. Making a folder you can ship is the next feature.

### One installation, many games

The `kernel-2d` folder is the application; a game folder is the document it
opens. Nothing is copied into your game folder except the content you author —
no engine, no dependencies, no repository. You can keep several game folders
anywhere and open each with the same command.

### After an update

If a session changed the editor or the game runtime, a browser refresh is enough
and usually not even that. If it changed the filesystem service, the launcher, or
a dependency, press Ctrl-C and run `npm run editor` again. A session should tell
you which.

A refresh loses which level was open, what was selected and where the camera was
— none of that is written to a file, on purpose. Your work is safe: changes are
written about a fifth of a second after you stop making them.

---

## What the editor can do

### Your folder, mirrored

The Assets panel shows your project folder exactly as it is — no import step, no
copying, no renaming. Save a PNG into it from Photoshop and it appears within a
second. Rename a folder in Explorer and the tree follows.

Every asset gets a small settings file beside it (`knight.png` +
`knight.png.meta`) holding its import settings. That file is the editor's only
privilege over art it did not make: it never modifies, moves or renames your
actual files.

### Import settings, per texture

Select a texture and the Inspector shows:

- **Filtering** — nearest (crisp, the default) or linear.
- **Pivot** — where the sprite hangs off its position, as a fraction. `0.5, 1` is
  the middle of the bottom edge, which is a character's feet.
- **Slicing** — one image, or a grid with a frame size, margin and spacing.

The **Texture** tab shows that texture on its own with the frame guides and the
pivot drawn over it, so you can see what the settings actually did.

### Levels

A level is a flat, ordered list of entities. **List order is draw order** — the
last row is drawn in front.

- **Assets panel** → *New scene* / *New prefab*, with a name and a folder.
- **Hierarchy** → add, duplicate, delete, and move a row back or forward.
- **Viewport** → click to select, drag to move.
- **Inspector** → name, position, rotation, scale, and which texture it draws.

### Prefabs

Define a thing once and place it many times. Every instance carries only a
reference, so editing the prefab changes every instance at once — while each
placement keeps its own position, rotation and scale. Select an instance and the
Inspector offers *Open prefab* and *Place another*, and tells you how many
instances the level has.

### The viewport

| Gesture | What it does |
|---|---|
| Middle-drag, or hold Space and drag | Pan |
| Mouse wheel | Zoom, keeping what is under the cursor under the cursor |
| `Home` | Frame the whole level |
| `F` | Frame the selected entity |
| `−` `+` buttons | Zoom a whole step at a time |
| Drag a sprite | Move it, on whole level units |
| Hold `Alt` while dragging | Place it between whole units |

Zoom is always a whole number of screen pixels per level unit, so pixel art never
lands half on a pixel. Each level remembers where you were looking for as long as
the window is open. Where you are looking is never saved into the level, so undo
never reverses a pan.

### Play mode

Press **▶ Play** and the open level runs from the file, drawn by the game runtime
having read it itself — not by the editor. Press **■ Stop** and you are back
exactly where you were: same level, same selection, same camera.

- A change made a moment before you press Play is in what runs; there is no save
  button and you do not need one.
- The bar tells you whether the running level matches what the editor was showing
  you, and names any difference in pixels.
- A level that cannot be fully loaded — a prefab that is gone, broken import
  settings, a missing picture — says so in a sentence and runs the rest.
- While it is running the rest of the editor is dimmed and read-only, and nothing
  is written to your files at all.

**Nothing moves yet.** There is no input, no update loop and no physics; "run"
means loaded and drawn by the runtime rather than by the editor. Motion arrives
with the first game.

### Undo

One `Ctrl-Z` history for the whole project, in the order you did things —
including adding, deleting and reordering. A whole drag is one press. `Ctrl-Y` or
`Ctrl-Shift-Z` redoes.

Two things Ctrl-Z deliberately does not cover: panning or zooming (a look, not a
change), and creating a file (its opposite would be deleting one).

### Saving

There isn't any. Every change is written to its file about a fifth of a second
after you stop. If a write is ever refused, the editor says so against that file
and keeps your change rather than discarding it.

If you edit a file in a text editor while the editor is open, the file wins and
the editor takes the change.

---

## What it cannot do yet

- **Anything that moves.** No input, no update loop, no collision. The only thing
  an entity can have is a picture.
- **Export a game you can ship.** Play mode is what makes it possible; it does not
  exist yet.
- **Rename, move or delete files.** Those are still jobs for Explorer. The editor
  can make a level or a prefab and change what is inside one.
- **Fix a reference after you move a file.** The editor notices and tells you that
  a reference now points at a different file; nothing reconciles it for you yet.
- **Parenting or nesting.** The entity list is flat.
- **Select more than one thing at a time.**
- **Rotate or scale handles in the viewport.** Position is the one thing the
  picture can change; everything else is typed in the Inspector.
- **A grid, rulers or a settable snap size.** Dragging lands on whole units and
  `Alt` frees it; nothing is configurable.
- **Two levels open at once.**
- **Saved panel layouts.** Drag the panels wherever you like; the arrangement
  resets when the page reloads.

---

## When something looks wrong

- **The panel is empty and says nothing** — that should never happen. Every state
  has a sentence under the canvas; if you get a blank one, that is a bug worth
  reporting.
- **A sprite is missing** — the bar under the viewport names the file and why.
- **The port is already in use** — an editor is still running. Close it, or start
  this one with `--port 7332`.
- **The status strip does not say Connected** — the filesystem service is not
  running. Ctrl-C and start the command again.
- **A change in a text editor did not appear** — check the file is inside the
  folder the banner named when the editor started.
