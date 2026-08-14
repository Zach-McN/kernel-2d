# Using the editor

This page is for the human, not for a session. It says what the editor can do
today, how to run it, and what it deliberately cannot do yet — in observable
behaviour, with no code in it.

It is kept current by the definition of done in `CLAUDE.md`: a session that
changes what you can do, or how you do it, changes this page in the same commit.
If this page and the editor disagree, the editor is right and the page is a bug.

Last true as of: **grabbing an entity with `G` and copying one with `Shift-D`**
(2026-08-14).

---

## Running it

**The short version: open your game folder in Explorer and double-click
`Open editor.cmd`.** A black window appears and the editor opens in your browser
a few seconds later. That window *is* the editor running — leave it alone, and
close it when you are finished. Everything below is the same thing typed out, and
the other commands that have no button.

Everything below needs one terminal, in the `kernel-2d` folder.

**Make a project to work in.** The folder has to exist first — the command fills
a folder, it does not create one:

```bash
mkdir ../my-game
```

```bash
npm run sample-project -- ../my-game
```

That writes sample content: pixel art, a sprite sheet, two levels, a prefab
placed twice, import settings beside every asset, and — in `src/systems/` — two
lines of the project's own game code, so there is a working example of behaviour
to read. It prints how many files it wrote and names any it left alone.

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

**Give a folder its button.** Writes `Open editor.cmd` into it, which is the
double-click above. A folder made by `npm run sample-project` already has one;
run this for a folder that does not:

```bash
npm run launcher -- ../my-game
```

It will not touch a file of that name that it did not write itself, so a launcher
you have edited by hand is safe.

**Moving folders.** The button remembers where the `kernel-2d` folder was, so
moving a game folder away from it — or moving `kernel-2d` — leaves it pointing at
nothing. Double-clicking it then says so and waits, and the fix is to **ask a
session to refresh the launcher**, which is the command above run once. Moving the
whole `gamedev` folder as one piece changes nothing and needs no refresh.

**Make a folder that plays your game:**

```bash
npm run export -- ../my-game
```

It prints the folder it wrote and every file in it. By default that folder is
`dist/<your-game>` inside `kernel-2d`; `--out ../somewhere-else` puts it wherever
you like, as long as that is not inside your project folder.

**Take pictures of the editor**, for a devlog or to send someone. It opens your
project, saves a few PNGs into `kernel-2d/shots/`, and closes again — it never
changes anything in your folder:

```bash
npm run shot -- ../my-game
```

Name one — `editor`, `level`, `texture` or `tabs` — to take just that one, and add
`--scale 3` for a close-up worth zooming into.

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

**Your first real game folder is `../games/tower-defense`**, and it is a different
thing from the sample. The sample is a scratch folder full of generated content to
try the editor against; the game folder is yours, it is its own repository, and its
`docs/GENRE-SPEC.md` is the document that decides what gets built in it. Open it by
double-clicking `Open editor.cmd` inside it, or the long way:

```bash
npm run editor -- ../games/tower-defense
```

It has a level in it now — a field with a road across it and a monster that walks the
road when you press Play. All of that is generated scaffolding meant to be replaced,
and every file in it says so inside itself.

**How to author that game is its own page**, not this one: `games/tower-defense/docs/authoring.md`
says how a road is drawn and a monster placed. This page stays about the editor, which
is the same editor for every game.

An export goes the other way and is the one thing that does copy: it writes a new
folder holding a copy of the parts of your game it needs, plus the engine. It
never writes inside your project folder, and refuses if you ask it to — the editor
watches that folder and would start annotating the copies.

### After an update

If a session changed the editor or the game runtime, a browser refresh is enough
and usually not even that. If it changed the filesystem service, the launcher, or
a dependency, close the black window and double-click again (or press Ctrl-C and
re-run the command). A session should tell you which.

An exported folder is a snapshot and does not update itself. After a session
changes the runtime, or after you change your levels, run `npm run export` again.

A refresh loses which level was open, what was selected and where the camera was
— none of that is written to a file, on purpose. Your work is safe: changes are
written about a fifth of a second after you stop making them.

---

## What the editor can do

### Reading the screen

**Every panel is a little window** with rounded corners and a gap around it, and
its tabs sit on top of it the way a browser's tabs sit on a browser window — the
open one is joined to the panel below it, so you can always see which tab belongs
to which panel. The Viewport's canvas sits in a darker well inside its window.

Dark, with one orange. **Orange always means "this is the one you are working on"**
— the tab you are in, the row you have selected, the field you are typing in,
and the zoom button when the view is exactly fitting. Nothing else is orange, so
if you have lost what you selected, look for the orange.

The other three colours mean what they usually do and are never used for
anything else: green is working (the dot at the top right), amber is something
worth knowing, red is something wrong.

Panel furniture — tabs, headings, badges, the boxes you type numbers into — is
in a typewriter face; your own words, like file names and the sentences the
panels tell you things in, are not. It is a way of telling at a glance what is
the editor talking and what is your project.

### Your folder, mirrored

The Assets panel shows your project folder exactly as it is — no import step, no
copying, no renaming. Save a PNG into it from Photoshop and it appears within a
second. Rename a folder in Explorer and the tree follows.

Every asset gets a small settings file beside it (`knight.png` +
`knight.png.meta`) holding its import settings. It never changes what is *inside*
a file it did not make — the only things it will do to one are the three below,
each of which you asked for by name.

### Three ways to look at it

The cog at the top right of the Assets panel offers three, and you can change
your mind at any time:

- **Folder view** — the whole project as a tree, with folders that open and shut.
  This is how the panel opens.
- **Icon view** — one folder at a time, as tiles, the way Explorer shows medium
  icons. **Click a tile to select it, double-click a folder to go into it.** The
  line above the tiles is the trail back out: it reads
  `my-game › assets › textures`, and every step in it is a button that takes you
  there.
- **Split view** — the tree on the left, the tiles on the right. Click a folder in
  the tree and the tiles jump straight into it; walk into a folder on the right and
  the tree opens the way down to it. This is the one to use when you know roughly
  where something is but not exactly.

Whichever you pick lasts until you reload, and moving the panel to a different
corner of the window does not lose your place. Every tile currently wears a plain
folder or blank-page symbol: **pictures of your actual art come later**.

The controls at the bottom — making a level, renaming, deleting — keep a fixed
share of the panel and scroll inside it, so nothing you are pointing at ever
shifts while you are clicking on it. Drag the panel's top edge up if you want more
room for tiles.

### Renaming, moving and deleting

Select anything in the Assets panel and a row appears at the bottom of the panel:
its name, the folder it is in, and a line showing exactly where it is about to end
up. Type a new name and press **Rename**, or pick another folder and press
**Move**. It is one operation either way, and the button says which one it will be.

**Everything that pointed at it follows.** Every level and prefab that drew that
picture keeps drawing it, every level that placed that prefab keeps placing it,
and if you rename the level the game starts on, the starting-level setting moves
with it. Nothing tells you a reference broke, because none did.

**A renamed file keeps its import settings and its identity.** The pivot, the
slicing and the filtering you set travel with it, so nothing is typed twice.

**Folders work the same way**, which is one gesture and a hundred references at
once: rename `textures` to `art` and every level in the project follows.

**Delete tells you first.** Press **Delete** and it names what still uses the
file — "knight.png is still used once, in scenes/level-01.json" — and the button
becomes **Delete anyway**. It never refuses, because deleting something in order
to replace it is a normal thing to do; it just makes sure you knew. The settings
file goes with it, so nothing is left stranded.

It will refuse, in a sentence naming the file, whenever doing it would damage
something:

- a name already taken, and the file that has it is untouched;
- a folder that is not there — it never creates one;
- a path outside the project, or a folder moved inside itself;
- a level, prefab or settings file it cannot read, which would mean it could not
  follow that file's references — nothing is moved at all until you fix it;
- `project.json`, which is the name an export looks for.

**Ctrl-Z does not cover any of this**, deliberately. It reverses changes *inside*
files; it has never made or unmade one.

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
- **Viewport** → click to select, drag to move, `G` to move without holding
  anything, `Shift-D` for a copy.
- **Inspector** → name, position, rotation, scale, spin, and which texture it draws.

### Your game's own code

**A game's behaviour lives in its own folder**, in `src/systems/`, and the editor
compiles it in. There is no engine to install and nothing to configure: put the
code there and it runs.

One file decides what runs, `src/systems/index.ts`, and it lists the systems in
the order they should happen. **The engine runs nothing you have not listed** — a
project with no `src/systems/index.ts` has no behaviour at all, and a level in it
sits still. That is the honest state rather than a fault.

A *system* is a rule handed everything in the running level and how much time just
passed. The sample's own one walks the slime along the ground and starts it over,
and it reads a `patrol` component the engine has never heard of — which is the
point worth knowing: **your levels can carry data of your own, and your code can
read it.** Nothing has to be added to the editor for that to work.

**Pressing Play re-reads your code.** Edit a system, press **Stop** and **Play**,
and the new behaviour runs. The page does not reload, and the level you have open,
what you had selected and where the camera was all survive. This is the one thing
in the editor that does not update on its own within a second, and it is that way
on purpose — code changing under a running level mid-frame is worse than pressing
a button.

An exported folder is built the same way from the same files, so what you see
behind Play is what somebody you hand the folder gets.

### Spin — the engine's own example

The Inspector has a **Spin** field: degrees per second, counter-clockwise, the
same unit and direction as Rotation just above it. Set it and the entity turns
while the level is running. `0` means it does not turn, and setting it back to
`0` takes the setting out of the file rather than leaving a nought behind.

Nothing turns while you are editing — press **Play** to see it, **Stop** to put
it back. The sample project's health icon is set to `90`, a quarter turn a second.

**It turns because the sample asked for it.** Spin comes with the engine, but the
engine does not impose it: the sample's `src/systems/index.ts` imports it by name
and lists it alongside its own system. Delete that line and the icon stops.

**It is still scaffolding and it is still meant to leave.** It was here so the
update loop had something driving it before there was a game to drive it. Now that
there is, Spin and its field go together — nothing depends on them any more, which
is exactly the state that makes removing them safe. Do not build a level around it.

### Prefabs

Define a thing once and place it many times. Every instance carries only a
reference, so editing the prefab changes every instance at once — while each
placement keeps its own position, rotation and scale. Select an instance and the
Inspector offers *Open prefab* and *Place another*, and tells you how many
instances the level has.

**Place by clicking** is the button for putting a lot of them down. Press it and
every click in the picture puts another one where you clicked, on the snap,
until you press `Esc` or press the button again. It is on the prefab's panel and
on any instance of it, so you can start from either.

Two things it deliberately does *not* do, because both would stop you at the
second one: it does not select what it places, so the Inspector stays on the
prefab and the panel does not jump about; and it does not care what is already
under the pointer, so clicking on top of your backdrop puts a tile down rather
than picking the backdrop up. The bar under the picture names what you are
placing the whole time it is on, and the cursor changes.

Everything else still works while it is on — `Ctrl-Z` takes them back one at a
time, space-drag still pans, and the wheel still zooms.

### The viewport

| Gesture | What it does |
|---|---|
| Middle-drag, or hold Space and drag | Pan |
| Mouse wheel | Zoom, keeping what is under the cursor under the cursor |
| `Home` | Frame the whole level |
| `F` | Frame the selected entity |
| `−` `+` buttons | Zoom a whole step at a time |
| Drag a sprite | Move it, landing on the snap |
| Hold `Alt` while dragging | Ignore the snap and put it anywhere |
| `G` | Grab the selected entity — it moves with the pointer, nothing held |
| `X` / `Y` while grabbing | Hold it to that axis, from where it started |
| `Esc` while grabbing | Put it back exactly where it was |
| `Shift-D` | A copy of the selected entity, in the same place, selected |
| `Esc` | Stop placing by clicking |

#### Grabbing

**Press `G` and the selected entity follows the pointer** — no button held, and it
does not matter where the pointer is. It can be on the other side of the panel or
on top of something else; the entity moves by however far you then move the mouse,
so nothing jumps when you press the key. Click to put it down.

This is Blender's `G`, and it is here for the reason Blender has it: the thing you
are placing is usually the thing your cursor is covering, and a gesture that has to
start on the sprite starts by hiding it.

- **`X` and `Y` hold it to one axis**, measured from where it was before you pressed
  `G` — so `G`, `X`, and a wave of the mouse slides it along the ground it is
  standing on and nowhere else. A dashed line through the entity shows the axis it
  is running along. Press the same key again to free it.
- **`Esc` puts it back**, exactly, and leaves nothing behind: the next `Ctrl-Z`
  reverses whatever you did *before* the grab, not the grab you called off.
- **The snap and `Alt` work exactly as they do for a drag.**
- **While a grab is running it has the picture.** The wheel will not zoom, `Home`
  and `F` will not move the camera, and a click puts the entity down rather than
  selecting something else. All of those would move the entity out from under your
  cursor, so they wait until you have finished.
- Anything that takes the level away — pressing Play, closing the level, clicking
  another row in the Hierarchy, or the window losing focus — puts the entity back
  the way `Esc` does. Nothing was decided, so nothing is kept.

**`Shift-D` copies the selected entity** onto exactly the same spot and selects the
copy, which is the same thing the Hierarchy's *Duplicate* button does. `Shift-D`
then `G` is how you make a second one and put it somewhere, without your hand
leaving the picture.

Zoom is always a whole number of screen pixels per level unit, so pixel art never
lands half on a pixel. Each level remembers where you were looking for as long as
the window is open. Where you are looking is never saved into the level, so undo
never reverses a pan.

#### The snap

Two numbers in the bar under the picture, **Snap** and **from**, decide where a
drag or a click is allowed to put something.

- **Snap** is how far apart those positions are, in level units. It starts at
  `1`, which is the whole units everything landed on before. Set it to `16` and
  things land sixteen apart.
- **from** is where that grid starts. `16 from 0` reaches 0, 16, 32; `16 from 8`
  reaches 8, 24, 40.

That second number matters more than it looks. A sprite hangs off the *middle* of
its position, so a board of 16-unit tiles laid corner to corner has its tiles at
8, 24, 40 — and a grid starting at 0 cannot land on any of them. If you are
tiling something, the offset is usually half the step.

`0` in the first box turns snapping off altogether, which is what holding `Alt`
does for one drag.

**It is not saved anywhere.** Like the zoom and where you are looking, it belongs
to the window: reload and it is back to `1 from 0`. It never reaches your level,
so `Ctrl-Z` cannot see it either.

### Play mode

Press **▶ Play** and the open level runs from the file, drawn by the game runtime
having read it itself — not by the editor. Press **■ Stop** and you are back
exactly where you were: same level, same selection, same camera.

- A change made a moment before you press Play is in what runs; there is no save
  button and you do not need one.
- **Time passes**, and your project's own systems are what make it do anything.
  In the sample that is the health icon turning and the slime walking, and both
  keep going until you stop.
- A level that cannot be fully loaded — a prefab that is gone, broken import
  settings, a missing picture — says so in a sentence and runs the rest.
- While it is running the rest of the editor is dimmed and read-only, and nothing
  is written to your files at all.

**What is running is a copy.** Everything that moves is moving in a copy the
runtime made when you pressed Play, so nothing a level does while it runs can
reach your file. Stop throws the copy away, which is why everything is back at
the angle and the position the file gives it, every time and immediately.

**The bar's "started exactly as the editing view had it" is about the first
frame**, and that is deliberate. It is checking that the runtime read your level
the same way the editor did — which is a question about the *file*, and one that
is answered before anything has moved. A second later the running level and the
editing view disagree, because one of them is playing. If the two ever disagree
at the start, the bar names every difference in pixels.

**Nothing responds to you yet.** There is no input: no keys, no clicks, nothing
a player could do. A level runs; nobody plays it. There is no collision and no
sound either. Those arrive with the first game.

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

**It runs the same way Play does.** The folder is not a picture of your level: it
opens the file, draws it and then starts the same clock the editor's Play button
starts, from the same files, through the same code. Anything with a spin turns
there too.

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

The "picture whose file is not there" refusal used to be the common one, because
every rename was a trip to Explorer. Renaming and moving inside the editor
reconciles the references as it goes, so you should now only reach that refusal by
moving something outside the editor — or by deleting a picture after being told
what still used it.

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
including adding, deleting and reordering. A whole drag is one press, and so is a
whole grab. A grab you called off with `Esc` is no press at all: it leaves the
history exactly as it was, so the next `Ctrl-Z` reverses whatever came before it.
`Ctrl-Y` or `Ctrl-Shift-Z` redoes.

Two things Ctrl-Z deliberately does not cover: panning or zooming (a look, not a
change), and anything that makes, moves or removes a file. It reverses changes
*inside* files. Making one has never been undoable because its opposite is
deleting one, and renaming is left off the same stack for a different reason: it
would be the one press of Ctrl-Z that could fail — the old name taken again, the
file gone — and a key that usually works and occasionally reports an error is a
different key.

### Saving

There isn't any. Every change is written to its file about a fifth of a second
after you stop. If a write is ever refused, the editor says so against that file
and keeps your change rather than discarding it.

If you edit a file in a text editor while the editor is open, the file wins and
the editor takes the change.

---

## What it cannot do yet

- **Anything a player can do.** No input at all: no keys, no mouse, no touch.
  A level runs and things in it move, but nobody plays it. This is the next big
  gap and it is waiting on the game design, because what the first verb is is a
  question about the game rather than about the editor.
- **Write or edit code from inside the editor.** Your game's systems are files in
  `src/`, edited in a text editor. The editor compiles them and re-reads them when
  you press Play; it does not show them to you or let you change them.
- **See a system's data in the Inspector.** A component the engine does not know —
  like the sample's `patrol` — is named there but cannot be edited. Setting one up
  means typing it into the level file, or a tool built for it later.
- **Collision, gravity or physics.** Two sprites in the same place are two
  sprites in the same place.
- **Sound.** The sample has audio files in it and nothing plays them.
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
- **Delete a folder.** It can be renamed and moved from the editor; getting rid of
  one, with everything inside it, is still a job for Explorer.
- **Rename or delete `project.json`.** It is the name an export looks for, and
  nothing in the editor will make another one.
- **Take a rename back with Ctrl-Z.** Rename it back instead; the references
  follow either way.
- **Fix up a file you moved in Explorer.** The editor still cannot pair a
  disappearance with an appearance, so a file moved outside the editor loses its
  import settings at the next start and leaves its references pointing at where it
  was. Doing it inside the editor is what avoids both.
- **Parenting or nesting.** The entity list is flat.
- **Select more than one thing at a time.**
- **Rotate or scale handles in the viewport.** Position is the one thing the
  picture can change; everything else is typed in the Inspector.
- **A grid or rulers you can see.** The snap is two numbers in the bar and
  nothing is drawn for it, so a board lines up without ever showing you the
  lines it lined up to.
- **Two levels open at once.**
- **Saved panel layouts.** Drag the panels wherever you like; the arrangement
  resets when the page reloads. Which of the three Assets views you chose, and the
  folder you were in, reset with it.
- **Pictures of your assets on the tiles.** The icon view draws a folder or a
  blank page, never a thumbnail of the art itself.
- **Sort, search or filter the icon view.** Folders first and then files,
  alphabetically, the same order the tree uses, and everything in the folder is
  shown.
- **Drag a file from one folder into another.** Moving is still the name field and
  the folder chooser at the bottom of the panel.
- **A back button, or a bigger and smaller icon size.** The trail above the tiles
  is how you go back up, and the tiles are one size.

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
- **A rename refuses over a file you were not renaming** — it means that file is a
  level, prefab or settings file the editor cannot read, so it could not promise to
  follow its references. Nothing was moved. Open the file it named and fix it, or
  move it out of the project.
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
