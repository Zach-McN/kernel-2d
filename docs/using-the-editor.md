# Using the editor

This page is for the human, not for a session. It says what the editor can do
today, how to run it, and what it deliberately cannot do yet — in observable
behaviour, with no code in it.

It is kept current by the definition of done in `CLAUDE.md`: a session that
changes what you can do, or how you do it, changes this page in the same commit.
If this page and the editor disagree, the editor is right and the page is a bug.

Last true as of: **an exported game** (2026-08-12).

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

**Make a folder that plays your game:**

```bash
npm run export -- ../my-game
```

It prints the folder it wrote and every file in it. By default that folder is
`dist/<your-game>` inside `kernel-2d`; `--out ../somewhere-else` puts it wherever
you like, as long as that is not inside your project folder.

**Look at the folder you just made:**

```bash
npm run serve -- dist/my-game
```

Then open the address it prints. Ctrl-C stops it.

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

`npm run build:editor` builds the *editor*, not a game. It is not part of
exporting and you will not normally run it.

### One installation, many games

The `kernel-2d` folder is the application; a game folder is the document it
opens. Nothing is copied into your game folder except the content you author —
no engine, no dependencies, no repository. You can keep several game folders
anywhere and open each with the same command.

An export goes the other way and is the one thing that does copy: it writes a new
folder holding a copy of the parts of your game it needs, plus the engine. It
never writes inside your project folder, and refuses if you ask it to — the editor
watches that folder and would start annotating the copies.

### After an update

If a session changed the editor or the game runtime, a browser refresh is enough
and usually not even that. If it changed the filesystem service, the launcher, or
a dependency, press Ctrl-C and run `npm run editor` again. A session should tell
you which.

An exported folder is a snapshot and does not update itself. After a session
changes the runtime, or after you change your levels, run `npm run export` again.

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

### Which level the game starts on

Click **project.json** in the Assets panel and the Inspector shows *Starting level*.
Choose any level in the project and that is where an exported game begins. It is
saved like anything else, so it survives a reload, and `Ctrl-Z` takes it back.

Two things it will tell you rather than let you find out later:

- Choosing something that is not a level — a prefab, a data file — is refused in a
  sentence, and the setting does not change.
- If the level you chose has since been renamed or deleted, the Inspector says so,
  and says an export will refuse until it is pointed at a level again.

`project.json` holds this one setting and nothing else yet. An input map, a window
size and the rest arrive with the features that read them; a field that looks
authoritative and does nothing is worse than no field.

### Exporting a game

`npm run export -- ../my-game` writes a folder you can give somebody.

**What is in it.** The page, the game, and the parts of your project the starting
level actually reaches — that level, every prefab it places from, every picture
those draw, and the import settings beside each of them. Your levels and art are
in there as the same files they are in your project, at the same paths, so you can
open the folder and read it.

It deliberately leaves out everything the starting level does not reach: your
`assets/source` originals, the audio nothing plays yet, the levels you have not
pointed at. The command prints what it left out, by folder, so it is never a
silent decision. When a level can eventually send you to another level, the export
will follow that and grow with the game.

**How you open it.** The folder has to be *served* rather than opened by
double-clicking. That is a browser rule and not a shortfall in the export: a page
opened straight off the disk is not allowed to read the files sitting beside it.
So use `npm run serve -- dist/my-game`, or upload the folder to any web host that
serves static pages and it works untouched. If you do double-click the page, it
says that in one sentence rather than showing you a blank screen.

**You can move it anywhere.** Copy it, zip it, put it on a memory stick, hand it
to somebody. Nothing in it points back at your machine or at this folder.

**It refuses rather than hand over a broken game.** If anything in your project
would mean something is not drawn, the command stops, names the file and why, and
writes nothing at all:

- no `project.json`, or no starting level chosen;
- a starting level that is missing, unreadable, or not a level;
- a prefab that has gone;
- a picture with no import settings beside it, or whose file is not there.

Fix it in the editor and export again — every one of those is something the editor
already shows you. The one thing it warns about and carries on with is a reference
pointing at a file that is no longer the one it was written against: that still
draws, and swapping one picture for another is something you might have meant.

**Exporting twice gives you the same folder.** Nothing changed means nothing
churns, and anything a previous export left that the game no longer needs is taken
out rather than left behind. It refuses to write into a folder that holds something
no export put there, so it cannot quietly overwrite somewhere you keep other work.

**There is no editor in it.** No panels, no inspector, no filesystem service. The
command checks its own output for that before it finishes and refuses if it finds
any — and the folder is short enough to read, so you can see it for yourself.

**It is not a small folder.** `game.js` is a few megabytes because nothing is
compressed or minified yet. Making it small is a separate job that has not been
done.

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
  an entity can have is a picture. An exported game is your level, drawn, and
  nothing happens in it.
- **Choose which levels go in an export.** There is one starting level and the
  export takes what it reaches. Nothing yet gets you from one level to another, so
  there is nothing else for an export to include.
- **Make a `project.json` from inside the editor.** A project made with
  `npm run sample-project` has one. If yours has not got one, the export says so
  and nothing in the editor will create it.
- **Any project setting but the starting level.** No window title, no icon, no
  input map, no window size.
- **A desktop or double-clickable build.** Web only, and served.
- **A small export.** Nothing is minified, packed or turned into an atlas.
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
- **An exported page is blank and says nothing** — it is almost certainly being
  opened from the disk rather than served, and the sentence saying so is at the
  bottom of the window. Serve the folder instead.
- **An export refuses** — it names the file and why, and it wrote nothing. Every one
  of those is something the editor can show you; open the level and look.
- **An export says it found editor code** — that is a bug in the editor rather than
  anything about your project. The folder is left there to be looked at. Worth
  reporting.
- **The port is already in use** — an editor is still running. Close it, or start
  this one with `--port 7332`. The same for `npm run serve`, which takes `--port`
  too.
- **The status strip does not say Connected** — the filesystem service is not
  running. Ctrl-C and start the command again.
- **A change in a text editor did not appear** — check the file is inside the
  folder the banner named when the editor started.
