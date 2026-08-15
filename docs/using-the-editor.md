# Using the editor

This page is for the human, not for a session. It says what the editor can do
today, how to run it, and what it deliberately cannot do yet — in observable
behaviour, with no code in it.

It is kept current by the definition of done in `CLAUDE.md`: a session that
changes what you can do, or how you do it, changes this page in the same commit.
If this page and the editor disagree, the editor is right and the page is a bug.

Last true as of: **right-clicking a file renames, moves or deletes it** (2026-08-15).

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

**The *Windows* button in the top bar lists every panel the editor has**, with a
tick beside the ones on screen. Closing a panel by the ✕ on its tab is no longer
a dead end: pick it from *Windows* and it comes back, as a tab in the panel you
are working in, ready to drag wherever you want it. Picking one that is already
open brings its tab to the front instead.

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

- **Icon view** — one folder at a time, as tiles, the way Explorer shows medium
  icons. This is how the panel opens. **Click a tile to select it, double-click a
  folder to go into it.** The line above the tiles is the trail back out: it reads
  `my-game › assets › textures`, and every step in it is a button that takes you
  there.
- **Folder view** — the whole project as a tree, with folders that open and shut.
- **Split view** — the tree on the left, the tiles on the right. Click a folder in
  the tree and the tiles jump straight into it; walk into a folder on the right and
  the tree opens the way down to it. This is the one to use when you know roughly
  where something is but not exactly. **Drag the line between the two halves** to
  give one of them more room; double-click that line to put it back where it was.

**Your mouse's side buttons hop in and out of folders.** Back leaves the folder
you are in and forward takes you back into it, exactly as they do in Explorer —
and they go *where you were*, not simply up one level, so walking three folders
deep and then jumping out to the top is one press of back away from being three
deep again. Changing your mind and going somewhere else forgets the way forward,
the same as a browser does. They work anywhere over the folder you are browsing,
in the icon and split views.

Whichever you pick lasts until you reload — along with the folder you are in, the
way back and forward, and where you put the split — and moving the panel to a
different corner of the window loses none of it. Every tile currently wears a plain
folder or blank-page symbol: **pictures of your actual art come later**.

**Everything you can do to a file is behind a right-click**, so the panel itself
is the folder and one line of reminder at the bottom. Nothing under the listing
grows or shrinks as you click about, which means a double-click never has the
folder move out from under it.

### Making a level or a prefab

Three ways in, and they open the same little menu:

- **The `+` in the bar**, to the left of the cog.
- **Right-click the empty space** in the folder listing — under the tiles, or
  below the last row of the tree.
- **Right-click a file or folder** and press *New level or prefab here*.

The menu holds a name, **New scene** and **New prefab**, and a line saying the
whole path it is about to create before anything is committed. It closes on
`Esc`, on a press anywhere else, and as soon as the file is made — and what you
had typed goes with it, so a name half typed into a menu you dismissed is not
waiting for you next time.

**Where it goes follows what you have selected**: the selected folder, the
selected file's folder, or the folder the tiles are standing in — and the path
line says which, every time. `.json` is added for you and never doubled. That is
also why *New level or prefab here* needs no folder of its own: right-clicking
picked the folder on its way in.

### Renaming, moving and deleting

**Right-click a file or folder in the Assets panel** and a little menu opens on
it, with the cursor already in the name field: its name, the folder it is in, and
a line showing exactly where it is about to end up. Type a new name and press
**Rename**, or pick another folder and press **Move**. It is one operation either
way, and the button says which one it will be.

`Esc` closes the menu, and so does pressing anywhere else or selecting another
file. A folder gets the same menu without **Delete** — deleting one, with
everything inside it, is still a job for Explorer.

**Everything that pointed at it follows.** Every level and prefab that drew that
picture keeps drawing it, every level that placed that prefab keeps placing it,
and if you rename the level the game starts on, the starting-level setting moves
with it. Nothing tells you a reference broke, because none did.

**A renamed file keeps its import settings and its identity.** The pivot, the
slicing and the filtering you set travel with it, so nothing is typed twice.

**Folders work the same way**, which is one gesture and a hundred references at
once: rename `textures` to `art` and every level in the project follows.

**Delete tells you first.** Press the **Delete** button in that row — the `Delete`
and `Backspace` *keys* are about entities in a level, not files — and it names
what still uses the file: "knight.png is still used once, in
scenes/level-01.json". The button then becomes **Delete anyway**. It never refuses, because deleting something in order
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

- **Assets panel** → the `+` in the bar, or a right-click on the empty space, for
  *New scene* / *New prefab*. Also **drag a file onto the level** — see below.
- **Outliner** → add, duplicate, delete, and reorder — with the `↑` `↓` buttons,
  or by dragging a row to where it should sit. A line shows where it will land;
  `Ctrl-Z` takes either kind of reorder back in one press. Right-click a row for
  the same small window a right-click on the sprite opens — rename, position,
  Frame, Duplicate, Delete.
- **Viewport** → click to select, drag to move, `G` to move without holding
  anything, `R` to turn, `S` to resize, `Shift-D` for a copy, right-click for a
  small window with the entity's position.
- **Inspector** → name, position, rotation, scale, spin, and which texture it draws.

#### Selecting more than one

**Shift-click adds to what is selected. Ctrl-click takes something out of it.**
Both work in the Outliner and in the picture, and they are the same selection:
Shift-click three rows in the list and three outlines appear in the level.

**Press `Delete` — or `Backspace`, if your keyboard has no `Delete` — and
everything selected goes**, from either panel, and the Outliner's Delete button
says how many it is about to remove. However many that is, **one press of
`Ctrl-Z` brings all of them back together.**

Three things worth knowing:

- **A plain click starts again with one.** That is how you let a selection go, in
  the list or in the picture; clicking empty space in the picture selects nothing
  at all. A Shift-click or Ctrl-click that *misses* everything leaves your
  selection exactly as it was, so a stray click near the edge costs nothing.
- **One of them is the one you are working on** — the last one you clicked. It
  keeps the crosshair in the picture and the brighter marker in the list, and it
  is the one the Inspector is describing. With several selected the Inspector says
  so above the fields, because those fields change that one entity and not the
  group.
- **Most things act on all of them.** Dragging, `G`, `R` and the delete keys all
  work on the whole selection. What still acts on the one entity is Duplicate,
  the `↑` `↓` reorder arrows, `F`, and the Inspector's fields.

Selecting is not something `Ctrl-Z` reverses, here or anywhere else in the editor.
It takes back the last thing you *changed*, never the last thing you looked at.

#### Dragging things in

**Pick a file up in the Assets panel and let it go over the level.** The picture
lights up while you are over it and says what you are carrying; where you let go
is where it lands, on the snap like everything else.

- **A texture** becomes a new entity that draws it, named after the file.
- **A prefab** becomes an instance of that prefab — the same thing the *Place*
  button makes, and it still follows the prefab when you change it.

Whatever you drop is selected the moment it lands, so the Inspector is already on
it. One drop is one press of `Ctrl-Z`.

It works from either view of the Assets panel, and folders cannot be picked up.
**Anything else you drop says what it is instead** — "level-02.json is a level, so
it cannot be placed in a level", "jump.wav is a sound" — rather than quietly doing
nothing. Dragging a file in from Explorer does nothing at all; put it in the
project folder and it appears in the panel like any other.

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

### Pinned to the screen

The Inspector has a **Pinned to** picker: choose a corner or edge of the screen
(or the centre) and the entity stays there wherever the camera looks — a coin
counter in the top-right, a message in the middle. Choosing **Not pinned** puts
it back in the world. Nine places are offered; the platformer's coin counter and
its controls hint are the first two things pinned this way.

Three things to know:

- **Pinning does not move it.** The moment you pick a corner, the entity stays
  exactly where it appears; its Position now reads as the distance from that
  corner, in the same units as everything else, and it drags and types like any
  other entity. Ctrl-Z unpins it like any other edit.
- **It grows with the zoom, like the level.** A pinned picture is the same size
  as the same picture would be in the world beside it, so a 16-pixel counter is
  16 level-pixels wide at every zoom rather than 16 screen-pixels.
- **Frame everything ignores it.** `Home` frames the level, not the corner the
  counter sits in — otherwise the level would never fit.

Prefabs can be pinned too, and a placement inherits the pin unless it picks its
own. Anything a game's own code adds while a level runs (the counter's digits,
a banner) can be pinned the same way, and behaves the same in an exported folder.

### Music

**A level can play a sound while it runs.** Click the level's file in the Assets
panel and the Inspector shows a **Music** choice offering every sound in your
project — MP3, WAV or OGG, anything the browser can decode. Pick one and it is
written into the level within the second, like every other choice; `Ctrl-Z` takes
it back, and "Nothing" makes the level silent again.

It plays on a loop behind the **Play** button and in an exported folder, and it
stops the moment you press **Stop**. **Editing stays silent** — nothing plays
until a level runs. Levels reached through doors switch to their own music, or to
silence if they have none.

One thing the browser imposes on an exported game: sound is held shut until the
player's first click or key press. The music starts itself the moment that
arrives — nothing to build, but worth knowing so a quiet first second is not
read as a bug. Behind the editor's Play button your click *is* that press, so it
starts immediately.

Sounds are files in your folder like everything else: drop an MP3 into
`assets/audio` and it appears in the Music choice. If the file a level names
goes missing, the level runs silent and the bar under the picture says which
file, by name. An export refuses to build a folder whose music file is gone.

### Drawing something faintly

A sprite can be drawn see-through. It is a number between 0 and 1 written into the
level — 1 is the picture as it is, 0 is invisible — and a sprite that says nothing
about it is solid, as everything always was.

**There is no control for it yet, on purpose.** Nothing you would author needs one so
far; it exists because a game's own code fades things while a level runs, which is how
the platformer's sparks and dust die away. If you open a level that has one, the
Inspector's Sprite section says so, so a see-through sprite is never a mystery. Say the
word and it becomes a field you can drag.

A number outside 0 to 1 is treated as the nearest one it can be, rather than losing
the picture: a stray digit should not make a sprite disappear.

### Sound effects

**A game's own code can make a noise when something happens** — a jump, a coin, a
stomp — and it does so without any audio file at all. The game describes the
sound as notes (a pitch sliding from one to another, for so many seconds, at a
volume) and the browser plays it. Nothing is loaded, nothing is cached, and
nothing about it appears in your project folder: there is no effect to choose in
the Inspector because there is no file to choose.

You will hear it behind **Play** and in an exported folder, identically. The
sample project demonstrates it: press Play on level one and the slime chirps
each time it starts its walk again.

Whether a game can be muted is the game's own business rather than the editor's.
The platformer mutes with **M**, because its own code says so.

The same first-press rule applies as for music: an effect asked for before the
player has touched anything is skipped rather than played late — a sound is a
moment, and a moment played a second afterwards is worse than one missed.

### Prefabs

Define a thing once and place it many times. Every instance carries only a
reference, so editing the prefab changes every instance at once — while each
placement keeps its own position, rotation and scale. Select an instance and the
Inspector offers *Open prefab* and *Place another*, and tells you how many
instances the level has.

**Place by clicking** is the button for putting a lot of them down. Press it and
every click in the picture puts another one where you clicked, on the snap,
until you press `Esc`, right-click, or press the button again. It is on the
prefab's panel and on any instance of it, so you can start from either.

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
| Click a sprite | Select it, and only it |
| Shift-click a sprite | Add it to what is already selected |
| Ctrl-click a sprite | Take it out of what is selected |
| `Delete`, or `Backspace` | Remove everything selected — one press of `Ctrl-Z` brings it all back |
| Drag a sprite | Move it, landing on the snap |
| Hold `Ctrl` while dragging | Flip the snap switch while you hold it |
| `G` | Grab the selected entity — it moves with the pointer, nothing held |
| `X` / `Y` while grabbing | Hold it to that axis, from where it started |
| `R` | Turn what is selected — it follows the pointer, nothing held |
| `S` | Resize what is selected — out from the middle is bigger, in is smaller |
| `X` / `Y` while resizing | Stretch one side only, along the sprite's own axis |
| Click, or `Enter` | Put down whatever you are moving, turning or resizing |
| `Esc` while grabbing, turning or resizing | Put it back exactly as it was |
| `Shift-D` | A copy of the selected entity, in the same place, selected |
| Right-click a sprite | A small window next to it: name, position, Frame, Duplicate, Delete |
| Right-click empty space | Close that window |
| `Esc`, or right-click | Stop placing by clicking |

#### The right-click window

**Right-click an entity and a small window opens next to it** holding its name,
its position, and three buttons — with the cursor already in the X field. It
opens below what you pressed, or above it when there is not room below.

- **Name and position are the same fields the Inspector has.** Type in either
  and the other follows; one edit is one press of `Ctrl-Z`.
- **Frame** puts the camera on the entity, the same as pressing `F`.
- **Duplicate** makes the copy `Shift-D` makes — on top of this one, just in
  front of it — and moves on to the copy.
- **Delete** removes this one entity, and `Ctrl-Z` brings it back. It only ever
  takes the entity the window is about, even if others were selected before you
  right-clicked.

The window puts itself away after Duplicate and Delete, because in both cases it
is no longer about what you are now looking at. **Frame closes it in the picture
but not in the list** — over the picture it is pinned to a spot on screen, and
moving the camera takes that spot away.

`Esc` closes it, and so does clicking anywhere else, panning, zooming, or
right-clicking empty space.

**It opens from the Outliner too.** Right-click an entity's row in the list and
the same window appears next to the row, about the same entity, with the same
fields and the same three buttons — the right button means one thing in both
places. Only ever one window is open: opening it from the list closes it over
the picture, and the other way round. In the list it closes on `Esc`, on
selecting another row, or on scrolling the list, and closing it hands the keys
back to the row so you can carry on with the keyboard.

The browser's own right-click menu never opens over the picture or over a row —
the right button belongs to the editor there, and to your game while one is
running.

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
- **The snap and `Ctrl` work exactly as they do for a drag.**
- **It carries everything you have selected**, exactly as a drag does.
- **While a grab is running it has the picture.** The wheel will not zoom, `Home`
  and `F` will not move the camera, and a click puts the entity down rather than
  selecting something else. All of those would move the entity out from under your
  cursor, so they wait until you have finished.
- Anything that takes the level away — pressing Play, closing the level, clicking
  another row in the Outliner, or the window losing focus — puts the entity back
  the way `Esc` does. Nothing was decided, so nothing is kept.

#### Moving several at once

**Drag any one of the selected sprites and they all come**, keeping their spacing
exactly. `G` does the same. The one under your cursor is the one that lands on the
snap, and the rest are carried by the same distance — so a row of tiles you have
lined up stays lined up.

Two rules about what a press picks up, and they are the same ones every editor
has:

- **Press a sprite that is already selected and the selection stays**, so the
  whole group moves.
- **Press one that is not, and the selection is replaced by it** — you drag just
  that one, and whatever was selected before stays where it is.

**Clicking one of several without dragging selects just that one.** That is how
you get out of a group without clicking empty space first.

However many you move, it is one press of `Ctrl-Z`.

#### Turning things with `R`

**Press `R` and what you have selected turns with the pointer.** A small ring
follows the cursor with a line running back to the point everything is turning
around, and a wedge fills in to show how far round you have come. The bar says the
angle. **Click or press `Enter` to keep it; `Esc` puts it back exactly.**

It is `G` with a different verb, and everything you know about `G` applies: the
pointer can be anywhere when you press the key, the gesture owns the picture while
it runs, and anything that takes the level away puts everything back.

- **The angle is measured from where the pointer was when you pressed `R`**, so
  nothing jumps, and taking the mouse right round and back leaves things exactly
  where they started.
- **With several selected they turn as one piece.** They swing around the point
  midway between them — marked by the dot the line runs to — *and* each one turns
  on its own axis, so the group keeps its shape. That midpoint is the average of
  their positions, so it is not necessarily on top of any of them.
- **The Snap switch governs the angle too**, in 15° steps. Hold `Ctrl` to turn
  smoothly, or — with snapping off — to land on 15° after all. It takes effect the
  moment you press the key, like it does for moving.
- **However far you turn, it is one press of `Ctrl-Z`**, and so is turning six
  things at once.
- Very close to the middle the pointer stops steering, because an angle measured
  from a point you are sitting on is meaningless and would spin wildly. Move
  further out and it picks up again.

#### Sizing things with `S`

**Press `S` and what you have selected grows and shrinks with the pointer.** Take
the mouse away from the middle to make it bigger and back in to make it smaller —
twice as far out is twice the size, however far out you started. The same ring
follows the cursor, with a line back to the middle and a small mark on that line
showing where you began, so which side of it you are on is bigger or smaller. The
bar says the factor. **Click or press `Enter` to keep it; `Esc` puts it back
exactly the size it was.**

It is `R` with a different number, and everything you know about `R` applies.

- **`X` or `Y` stretches one side only** — and it is the sprite's *own* side, so
  a tile turned on its side stretches along its own length rather than along the
  screen. Press the same key again to go back to both. It takes effect the moment
  you press it, without waiting for you to move the mouse.
- **With several selected they scale as one piece**: each one grows *and* moves
  away from the midpoint between them, so the group keeps its shape and spreads
  out rather than overlapping.
- **The Snap switch governs the size too**, in steps of 0.1. Hold `Ctrl` to size
  smoothly, or — with snapping off — to land on tenths after all.
- **However much you resize, it is one press of `Ctrl-Z`**, and so is resizing
  six things at once.
- It will not scale anything down to nothing, and it never flips a sprite
  inside out however far in you take the pointer.

Only one of `G`, `R` and `S` runs at a time: while one is going the other two do
nothing, so nothing can be moved and turned and resized by three gestures at
once.

**`Shift-D` copies the selected entity** onto exactly the same spot and selects the
copy, which is the same thing the Outliner's *Duplicate* button does. `Shift-D`
then `G` is how you make a second one and put it somewhere, without your hand
leaving the picture.

Zoom is always a whole number of screen pixels per level unit, so pixel art never
lands half on a pixel. Each level remembers where you were looking for as long as
the window is open. Where you are looking is never saved into the level, so undo
never reverses a pan.

#### The snap

Three controls in the bar under the picture — a **Snap** switch, an interval, and
a **from** — decide where a drag or a click is allowed to put something.

- **Snap** turns the grid on and off. It lights up when it is on, and it starts
  on. With it off, things land wherever you put them.
- **The interval** is how far apart those positions are, in level units. Click the
  box for the usual sizes — 1, 2, 4, 8, 16, 32, 64, 128 — or type any number over
  it if your level wants something else, like `24`.
- **from** is where that grid starts. `16 from 0` reaches 0, 16, 32; `16 from 8`
  reaches 8, 24, 40.

That last number matters more than it looks. A sprite hangs off the *middle* of
its position, so a board of 16-unit tiles laid corner to corner has its tiles at
8, 24, 40 — and a grid starting at 0 cannot land on any of them. If you are
tiling something, the offset is usually half the interval.

**Hold `Ctrl` while you are moving something and the switch flips for as long as
you hold it.** With snapping on, `Ctrl` places it anywhere; with snapping off,
`Ctrl` puts it on the grid — which is the useful half most of the time: lay a
level out by eye, then hold `Ctrl` for the one piece you want lined up. It takes
effect the moment you press the key, and undoes the moment you let go, without
having to move the mouse.

Press `Ctrl` *during* the move, not before it — holding `Ctrl` and then clicking
means "take this out of the selection", so it never starts a move at all.

Switching the grid off does not forget it. Turn it back on and your interval and
offset are where you left them.

**None of it is saved anywhere.** Like the zoom and where you are looking, it
belongs to the window: reload and it is back to on, `1 from 0`. It never reaches
your level, so `Ctrl-Z` cannot see it either.

### Play mode

Press **▶ Play** and the open level runs from the file, drawn by the game runtime
having read it itself — not by the editor. Press **■ Stop** and you are back
exactly where you were: same level, same selection, same camera.

- A change made a moment before you press Play is in what runs; there is no save
  button and you do not need one.
- **Play is greyed while you are still holding something.** A level runs from the
  file, so it cannot start halfway through a move — the button stays out for the
  whole of a drag, a `G` grab or an `R` turn, including the parts where your hand
  is not moving, and says so if you hover it. Put the entity down, or press `Esc`,
  and it comes straight back.
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

**The keyboard belongs to the game while it runs.** Any key you press reaches
the game's own code, which decides what — if anything — it means; in the tower
defense, the spacebar calls the next wave, and in the platformer holding an
arrow walks the ninja and holding Shift sprints. Held keys count as held for as
long as you hold them, and the arrow keys and spacebar will not scroll the page
while a level runs. Typing in a panel's text field is still typing, and
pressing Stop gives the keyboard back to the editor. An exported folder hears
the same keys the same way.

**The game can steer the view while it runs.** A game's own code may ask the
camera to look somewhere — the platformer's camera chases the ninja across the
level — and the view follows at whatever zoom you were using, never past the
edges of the level. While the game is steering, your own camera keys are
suspended with the rest of the editing gestures; **Stop puts the view back
exactly where you were editing**. A game that never asks (the tower defense)
plays under your frozen camera exactly as before. An exported folder follows
the same asks at its own fitted zoom.

**Clicks on the picture belong to the game too.** While a level runs, a click
on the viewport is handed to the game's code at the spot in the level you
clicked — in the tower defense, clicking a buildable pad buys a tower there.
The editing gestures are off during play, so there is nothing for a click to
collide with; Stop gives the mouse back to the editor. An exported folder
hears the same clicks the same way.

**The game can travel while it runs.** A game's own code may ask for another
level — in the tower defense, clicking a banner on the level-select scene opens
that level, and clicking the trophy afterwards comes back. The viewport follows
the game wherever it goes; the level you were *editing* stays open underneath,
untouched, and **Stop always returns you to it**. The bar under the picture
names whichever level the game is in right now. The started-where-the-file-says
check only speaks for the level you pressed Play on — a level the game
travelled to was never on your screen to compare against.

**The game can remember between runs.** A game may keep a few small facts —
which levels have been beaten, in the tower defense — and they survive Stop,
closing the editor, and reopening it. They live in your browser, not in any
file of the project: nothing in the project folder changes, exporting the game
does not carry your progress with it, and clearing the browser's site data for
the editor's address forgets everything.

**There is still no collision.** It arrives when a game needs it, exactly as the
keyboard, the pointer and the sounds did.

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
level actually reaches — that level, **every level the game can travel to from
it**, every prefab those place from, every picture any of them can come to draw
(a projectile's art included), and the import settings beside each texture. Your
levels and art are in there as the same files they are in your project, at the
same paths, so you can open the folder and read it. A level that a door names
but that does not exist refuses the export by name, before anything is written.

**It runs the same way Play does.** The folder is not a picture of your level: it
opens the file, draws it and then starts the same clock the editor's Play button
starts, from the same files, through the same code. Anything with a spin turns
there too.

It deliberately leaves out everything the starting level does not reach: your
`assets/source` originals, the audio no level names, the levels nothing can get
to. The command prints what it left out, by folder, so it is never a silent
decision.

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
whole grab, and so is deleting six entities at once. A grab you called off with
`Esc` is no press at all: it leaves the history exactly as it was, so the next
`Ctrl-Z` reverses whatever came before it. `Ctrl-Y` or `Ctrl-Shift-Z` redoes.

Three things Ctrl-Z deliberately does not cover: panning or zooming (a look, not
a change), **what is selected** (also a look — it reverses the last thing you
changed, never the last thing you clicked on), and anything that makes, moves or
removes a file. It reverses changes
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

- **Play with anything but keys and a click.** A running level hears the
  keyboard, and it hears the left mouse button at the spot in the level it landed
  — and that is the whole of it. Where the pointer is when no button is down, a
  drag, the right button, the middle button and a gamepad all reach nothing. On a
  touchscreen a tap arrives as a click and nothing else is built for a finger.
- **Pause or step a running level.** **Play** and **Stop** are the two buttons
  there are. A level cannot be held still for a moment and looked at, or walked
  forward a step at a time, so anything that happens too fast to see has to be
  slowed down by the game's own code.
- **Look at or forget what a game remembers.** The few facts a game keeps between
  runs live in your browser, and nothing in the editor lists them, changes them or
  clears them. Starting again from nothing means clearing the browser's site data
  for the editor's address, which forgets every project's memory at once rather
  than the one you are working on.
- **Write or edit code from inside the editor.** Your game's systems are files in
  `src/`, edited in a text editor. The editor compiles them and re-reads them when
  you press Play; it does not show them to you or let you change them.
- **See a system's data in the Inspector.** A component the engine does not know —
  the sample's `patrol`, or the level a door opens — is named there but cannot be
  edited. Setting one up means typing it into the level file, or a tool built for
  it later. **This is how a door is authored**, so joining two levels together is
  a job for the game's code and the file rather than for a panel.
- **Collision, gravity or physics.** Two sprites in the same place are two
  sprites in the same place.
- **Choose or preview a sound effect.** A level's *music* is a file you pick in
  the Inspector; an effect is notes the game's own code describes, so there is
  nothing to pick and no way to hear one without pressing Play. Clicking an audio
  file in the Assets panel still does not play it.
- **Choose which levels go in an export.** There is one starting level, and the
  export takes it together with every level the game can reach from it through a
  door. A level nothing reaches is left out, and there is no list to tick it back
  onto — the way to include one is to make the game able to get there.
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
- **Duplicate or reorder several at once.** Moving, turning and deleting all
  work on the whole selection now; Duplicate, the `↑` `↓` arrows and `F` still act
  on the last one you clicked. There is also no editing six positions in one
  field — the Inspector describes one entity at a time.
- **Select several files in the Assets panel.** The plural is only about entities,
  in the Outliner and in the picture. A file is still selected one at a time.
- **Shift-click a range in the Outliner.** Shift adds the one row you clicked, not
  every row between it and the last one — because Shift has to mean the same thing
  in the picture, where there is no order to take a range along.
- **Drag a box around several entities in the picture.** Selecting several means
  clicking them one at a time with Shift held.
- **Handles you can drag in the viewport** — corner boxes for size, a ring for
  angle. Position, angle and size can all be changed in the picture, but only
  with `G`, `R` and `S`; there is nothing on screen to grab hold of, and there is
  no way to scale one entity about a corner rather than about its middle.
- **A grid or rulers you can see.** The snap is a switch and two numbers in the bar and
  nothing is drawn for it, so a board lines up without ever showing you the
  lines it lined up to.
- **Two levels open at once.**
- **Saved panel layouts.** Drag the panels wherever you like; the arrangement
  resets when the page reloads. Which of the three Assets views you chose, the
  folder you were in, the way back and forward, and where you put the split all
  reset with it.
- **Pictures of your assets on the tiles.** The icon view draws a folder or a
  blank page, never a thumbnail of the art itself.
- **Sort, search or filter the icon view.** Folders first and then files,
  alphabetically, the same order the tree uses, and everything in the folder is
  shown.
- **Drag a file from one folder into another.** Files drag *into the level*, not
  into other folders; moving one is still the name field and the folder chooser
  in its right-click menu.
- **Reveal a file in Explorer, or open it in another application.** The
  right-click menu on a file renames, moves, deletes and makes a new file beside
  it, and that is all it offers.
- **Drag a file into the Outliner, or onto an entity to give it that texture.**
  The level's picture is the only place a *file* drop means anything — the only
  thing that drops into the Outliner is its own rows, to reorder them.
- **Back and forward *buttons*, or a bigger and smaller icon size.** The mouse's
  side buttons go back and forward, the trail above the tiles is the other way
  back up, and the tiles are one size. With a mouse that has no side buttons, the
  trail is the whole story — there is nothing on screen that goes forward.

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
