# Keeping designs in git

A `.rcam` file is plain, pretty-printed JSON, so git can store and diff it
without help. Merging is the part that needs help, and this is how to set it up.

## Why the default merge is not enough

Git merges by line. A design is not lines — it is a set of objects that happen
to be written down in an order.

Two people each adding a shape both append to the end of the `entities` array,
so both write to the same lines, and git conflicts **every time**, on edits that
have nothing to do with each other. Measured on a real design before the merge
driver existed:

| what the two branches did | plain `git merge` |
| --- | --- |
| each added a different entity | **conflict** |
| each edited a different entity | clean |
| each edited a different field of one entity | clean |
| each edited 40-circle patterns at adjacent indices | clean |

The conflicts are the wrong ones, and the clean merges are luck: nothing
guarantees that two hunks of coordinates git spliced together describe a shape
either person drew.

## Installing the merge driver

rcam ships a three-way merge that works on objects instead of lines. It
needs [Node](https://nodejs.org) and nothing else — download one file, then run
three commands in the repository holding your designs:

```sh
curl -O https://rcamhub.com/rcam-merge.mjs

git config merge.rcam.name "rcam .rcam merge"
git config merge.rcam.driver "node /full/path/to/rcam-merge.mjs %O %A %B"
echo "*.rcam merge=rcam" >> .gitattributes
```

Use an absolute path: git runs the driver from the top of the repository, not
from wherever you were standing.

Commit the `.gitattributes` file — it travels with the repository, so everyone
who clones it gets the same behaviour once they have run the two `git config`
lines. (Git deliberately does not let a repository configure a driver command
for you: that would be arbitrary code execution on clone.)

With it installed, all four rows above merge cleanly and correctly.

### The fuller version

If you have this repository checked out, `rcam merge` does the same merge
and then runs the whole `validate` pass on the result — dangling references,
whether the constraint system still solves, whether the toolpaths still cut
anything:

```sh
git config merge.rcam.driver "npx tsx /path/to/rcam/cli/rcam.ts merge %O %A %B"
```

The standalone file deliberately leaves those out. They need the document model,
the solver, the CAM stack and the bundled font outlines, and without the fonts a
design dimensioned to the width of a word measures a *different* width — the
checks would report confidently wrong numbers, which is worse than not running
them. Run `rcam validate` on the result when you want them.

## What still conflicts, and why that is right

The driver disagrees only when the two sides actually set the **same field** to
**different values**:

- both moved the same corner of the same rectangle
- one deleted a shape the other edited (kept, not dropped — deleting it again is
  one click, redrawing it is not)
- both minted the same id for different objects, which should be impossible now
  that ids carry a timestamp and a random suffix

It also reports a shape that has fallen out of the job. Lists like a toolpath's
geometry, a block's members and a pattern's instances are merged whole, so when
both sides change one, yours wins and theirs' additions come loose — while the
shapes themselves, having unique ids, are kept. The list conflict alone would say
only "entityIds changed on both sides", and the expensive half is the rest:

- a shape the other branch added to a toolpath is still **drawn but no longer
  cut**, which is the quiet half of a wrong part;
- a shape added to a rigid block comes loose and stops moving with it;
- two people regenerating one pattern keep **both** sets of instances, leaving
  the losing set as loose copies sitting exactly where the pattern is.

Deliberately ungrouping something is not reported — coming loose is what was
asked for.

On a conflict the driver still writes a **complete, loadable design**, keeping
your side wherever the two disagreed, and exits non-zero so git marks the file
unmerged. Open it, fix the handful of places it names, and commit. There are no
conflict markers in the file, because a `.rcam` full of `<<<<<<<` would not
parse and could not be opened at all.

Each conflict names the shape, so you can find it on the canvas; both values,
so you can choose between them; and the exact address, so you can search the
file for it.

```
  ✗ Circle "mounting hole" ⌀10.00 mm at (120.0, 60.0) mm
      changed on both sides, differently — kept ours
      yours 5.00 mm  ·  theirs 6.00 mm
      entities[ent-b2].radius
  ✗ Toolpath "Outline"
      changed on both sides, differently — kept ours
      yours 6  ·  theirs 9
      operations[op-1].depth
  ✗ Stock thickness
      changed on both sides, differently — kept ours
      yours 18.00 mm  ·  theirs 25.00 mm
      stockThickness
```

Resolving a conflict means choosing between two values, so both are shown — the
one that was kept and the one that was discarded. Without the second you would
have to dig the other side's file out of git to see what you were deciding
against.

Sizes and positions are printed in the design's own display unit, and a shape
you have named is called by that name. The values shown for the shape itself
are the ones in the merged file — your side — so the description matches what
you see when you open it.

A number that is not a length prints as stored, with no unit: a toolpath depth
of `6` is millimetres, but feeds, powers and angles live on the same objects,
and a bare number cannot mislabel itself.

## Two things a merge cannot decide

Structure and meaning are different questions, so the driver runs the same check
as `rcam validate` on the result and reports what it finds:

- **A reference to something the other side deleted.** You dimension a circle;
  a colleague deletes it. Neither edit touches the other's object, so there is
  nothing for the merge to disagree about — and the result names an entity that
  is gone.
- **Two variables with the same name.** Expressions reference a variable *by
  name*, so unique ids do not help: both variables are kept, the merge is clean,
  and every formula using that name is now ambiguous. Rename one.

## Seeing what changed, on the canvas

A `git diff` of a `.rcam` is honest and nearly unreadable: it tells you `p1.x`
went from `145` to `137` and leaves you to picture which wall moved. **File ▸
Compare With…** answers the same question by drawing it. Pick a second `.rcam`
and both versions appear on one canvas:

| | |
|---|---|
| **green** | in the open design only — added |
| **red**, solid | in the other file only — removed |
| **amber** | in both, different — changed |
| **red**, dashed | where a changed shape used to be |
| **grey** | the same in both |

The strip across the top counts each kind, hides any of them, and leaves with
**Exit Compare**. Comparing never writes to either file — and you can keep
working with it on screen: fix something you spot and the comparison follows
the edit, rather than quietly describing a design you no longer have.

Beside the canvas is the list of changes, which is where the numbers are:

```
CHANGES  since bracket-rev-b
  ● Circle ⌀10.00 mm     moved 0.20 mm            ×40
  ● Circle ⌀10.00 mm     ⌀10.00 mm → ⌀14.00 mm
  ● Circle ⌀10.00 mm     added
  Not on the canvas
  ● Toolpath "Outline"   changed: depth
```

Pick a row and the view flies to that change and rings it; **◀ ▶** in the strip
walk the changes in turn. Identical changes collapse into one row with a count —
forty rows saying the same sentence are no more readable than the forty amber
circles they were meant to explain. Changes with nothing to draw are listed
under their own heading and are not clickable, because there is nowhere to go.

Three things it does that a text diff cannot:

- **It marks what you would not see.** A hole moved 0.2 mm is about a pixel and
  a half with the whole design on screen, so the before and after outlines land
  on the same pixels. Those changes get a scalloped cloud, drawn at a fixed size
  on screen rather than in millimetres. Zoom in and the clouds go away as the
  geometry becomes legible on its own. When most of the design qualifies at once
  — a whole array nudged — no clouds are drawn: there is nothing to point at when
  everything moved, and the count and the change list say so instead. The
  change you have stepped onto is always ringed, however big it is.
- **It is not fooled by re-identification.** Regenerating a pattern gives every
  copy a new id, which a comparison by id alone reports as forty deletions and
  forty additions of an array nobody touched. Shapes that are identical and in
  the same place are matched up whatever they are called.
- **It ignores the solver settling.** Anything under 1e-4 mm is not a change.
  Editing one shape re-solves the sketch and moves untouched geometry by around
  1e-8 mm; reporting that would make the view cry wolf on its first honest use.

Toolpaths, tools, stock and machine settings are compared as well. They have no
shape to colour, so the strip reports them as a count of changes outside the
drawing rather than leaving them silent.

## Working with designs in a repository

- **Save before you commit.** Opening a design and saving it produces the same
  bytes as long as nothing changed, so a diff shows only what you actually
  edited. Text designs are the exception — the first save embeds the font.
- **`rcam validate <file>` in a pre-commit hook** catches a design whose
  stored geometry no longer satisfies its own dimensions, which is a change you
  will otherwise notice as the drawing jumping when someone opens it.
- **Review the diff, not the file.** Coordinates are stored to full precision;
  a change of a few microns is the solver settling, not someone moving a wall.
  **File ▸ Compare With…** applies that judgement for you, and draws the rest.
