# `components/notes`

| File | Role |
| --- | --- |
| `NotesScreen.tsx` | The notes grid, selection and batch delete |
| `NoteEditor.tsx` | One note open — autosave, delete, WYSIWYG formatting |
| `NoteEditorToolbar.tsx` | The editor's formatting controls |
| `note-surface.ts` | DOM ↔ note document, for the `contentEditable` surface |

A note's tile is a [`PageTile`](../tiles/README.md), and the tab strip above the grid is
[`FolderTabs`](../folders/README.md).

## Notes is the one populated screen with no panel

`NotesScreen` is a section like Vault or Documents — same `NAV_ITEMS` entry, same top bar — but
once it has files it deliberately **does not wrap them in `Card`**. The tiles render straight into
the content column with no panel border around them, because a panel exists to group controls, and
a file browser's content *is* the grouping. A border there would read as a second, redundant frame
around a grid that already has visible objects in it.

The empty state is the exception, and is wrapped in a `<Card>`: with no objects on the page there is
nothing for the eye to land on, so the message needs a surface of its own. Documents does the same.

The tiles themselves are not borderless. Each is a page-shaped thumbnail (`aspect-[3/4]`) with a
`shadow-card` and a hairline ring, carrying the note's real first ~420 characters at 9px under a
bottom fade, with the title and date beneath it as a filename. Hovering lifts the tile
(`-translate-y-0.5`, `shadow-lift`) and warms the ring to `brand-200`. That reads as a stack of
paper rather than as a list of rows — the ring belongs to the object, not to the section. A note
that will not decrypt shows the notes glyph instead of content, keeping its tile.

## Selecting notes

How the checkbox and the click behave is the same on every grid, and is in
[`components/tiles`](../tiles/README.md#selecting-files). What is the notes grid's own:

The toolbar is borderless like the rest of the section, and doubles as the count readout —
`12 notes` normally, `3 selected` while selecting, in an `aria-live` region. The new-note FAB
**hides during selection**, so the corner does not offer "create" and "delete" at once.

Deleting asks first, through the same confirmation `Notice` a single delete uses, and then
reports only if the server deleted fewer notes than asked —
[`batchDeleteSummary`](../../lib/app/README.md#selecting-notes-for-a-batch-delete) returns nothing on
a clean run, because the notes are visibly gone. `DELETE /notes` takes the whole selection under
**one** signature, so a batch of twenty costs one signed action rather than twenty; the sorting
rule that signature depends on is in
[`lib/notes`](../../lib/notes/README.md#deletenotes--one-signature-for-the-whole-selection).

The selection is pruned against the reloaded list on every load, so a note deleted elsewhere
cannot stay checked in a grid that no longer draws it.

**One screen, two views, no route.** `NotesScreen` holds a `view` union
(`{mode:'list'} | {mode:'note', id?}`) and swaps what the section body renders; there is no
router involved, matching the rest of the shell. Opening a tile replaces the grid with the
editor, whose own header carries the back arrow, the live title (the first line of the draft)
and the actions. Going back reloads the list.

The **new-note button is `fixed bottom-6 right-6`**, not a header action, and it renders only in
list view. It opens a blank editor immediately rather than prompting for a name — the first line
becomes the name, so there is nothing to ask.

Editing lives in **`NoteEditor.tsx`**, its own component rather than a helper inside the grid
screen, with `NoteEditorToolbar.tsx` beside it. The two screens share nothing but props: the grid
knows how to list and select, the editor knows how to open one note. Every formatting rule sits
further out again, in [`lib/note-format`](../../lib/note-format/README.md), so the editor decides
*when* to apply a change and never *what* the change is.

### The editing surface

The writing surface is **WYSIWYG**: a `contentEditable` div with no border or ring of its own,
inside a white sheet that also holds the formatting toolbar above it and the character count
below. Bold text is bold, a title is a real heading, a checklist has real tick boxes. The user
never sees a `#` or a `**` — that spelling is only how the note serializes.

`note-surface.ts` is the DOM half, and it is deliberately the *only* untested file in the
feature: everything decidable without a DOM lives in
[`lib/note-format`](../../lib/note-format/README.md), which is why that module has 30 tests and this
one has none (the repo's Vitest is node-environment by design). What is left here is three
functions — read the surface into blocks, find the block at the caret, find the blocks a
selection spans.

The surface holds **one `<div data-line="…">` per line**, styled entirely from that attribute by
CSS in [`globals.css`](../../app/globals.css). Bullets and tick boxes are `::before`
pseudo-elements rather than nodes, so the caret cannot land inside one and serialization never
has to skip one. Ticking a box is a single `data-checked` flip — the text and the caret do not
move.

**But a direct child of the surface is not always one of those divs.** `contentEditable` leaves
the first thing typed into an empty surface as a bare text node, with no wrapper, until the
browser has a reason to make one. `readSurface` already expects this and folds such loose text
into an implicit `text` block. `surfaceBlockAt` therefore **returns `undefined` rather than that
text node** — its contract is "the line *element* at the caret", and a caller that gets a text
node back reads `.dataset.line` off `undefined` and throws on every keystroke. That was a real
bug, fixed 2026-09-09; the `nodeType === Node.ELEMENT_NODE` check on its last line is the whole
fix and is not redundant.

Every caller already handles `undefined` by doing nothing, which is the right answer for a line
that has no element to carry `data-line`: the toolbar reports it as `text` (which is what
`readSurface` calls it too), and Enter, the tick-box click and the line-type buttons pass. **The
one visible consequence is that the line-type buttons do nothing on the very first line of a
brand-new note**, until an Enter or a paste gives that line a wrapper. Closing that means
promoting loose text into a real block on `sync`, which is an editing change rather than a fix,
so it has not been done.

Five things this depends on, each of which breaks the editor if it is wrong:

1. **React must never own the surface's children.** The initial HTML is assigned imperatively in
   a mount effect; the JSX has no children and no `dangerouslySetInnerHTML`. This is not
   defensive style — with `dangerouslySetInnerHTML` React 19 re-applies the HTML on *every*
   render, and since every keystroke calls `setDraft`, the document snapped back to its opening
   content on each key. It was found by driving the real thing in a browser, not by any test.
2. **`onMouseDown` is prevented on every tool button.** Otherwise mousedown moves focus out of
   the surface and collapses the selection *before* the click handler runs, so Bold would style
   nothing.
3. **Bold and italic go through `document.execCommand`.** It is deprecated and has no
   replacement; the alternative is hand-rolled range splitting across partially-selected nodes.
   Browsers disagree on what it emits, so `note-surface` reads `b`/`strong`/`font-weight` and
   `i`/`em`/`font-style` alike when serializing.
4. **Enter is mostly left to the browser.** Chrome clones the current block, so a list continues
   as a list — which is what you want. The handler only corrects two cases: a fresh task line is
   forced to unticked, and pressing Enter on an *empty* topic or task line exits the list instead
   of extending it.
5. **Paste is forced to plain text.** Without it, pasted HTML would inject arbitrary elements and
   styles into a document whose serializer expects a flat block list.

### The toolbar

Three groups: line types (Title / Topic / Checklist), inline styles (Bold / Italic), and font size
(A− / A+ with the current size between them). No font picker and no size field — the scale steps
from 12 to 24, and the buttons disable at each end rather than appearing to do nothing.

Title and Topic show as pressed via `aria-pressed`, tracked from the block under the caret.
Checklist is a cycle (open → done → off), so it is not a binary state and its tooltip says so.

**A− / A+ size the selection, or the current line when nothing is selected** — size is inline
formatting stored in the note, exactly like bold, not a setting for the whole document. The number
between the buttons is the size *at the caret*, refreshed by the same `sync` that tracks the line
type, so stepping twice actually walks 14 → 16 → 18.

Applying it leans on the browser's own range splitting, because a selection can start and end
mid-node: `execCommand('fontSize', …, '7')` with `styleWithCSS` produces a sentinel
`font-size: xxx-large` wrapper, which `applyFontSize` then rewrites to the real px value. The
selection is restored **inside** the new spans (`setStart(span, 0)`), not around them — anchoring
outside leaves the caret in the parent, where the size lookup finds nothing, and the toolbar reads
the default forever while every press recomputes from 14. That was a real bug, caught by driving
the browser.

### Autosave, and the four things that keep it honest

**There is no Save button.** Writing happens two seconds after the user stops typing, and the
header carries a status word (`noteSaveState` in [`lib/app`](../../lib/app/README.md#the-save-gate))
where the button used to be, in an `aria-live="polite"` region so the change is announced rather
than only seen. Below `sm` the status moves next to the character counter, which is the only
place there is room for it.

The debounce is one effect, not a stored timer:

```tsx
useEffect(() => {
  if (unreadable || !isNoteSavable(draft, saved)) return;
  const timer = setTimeout(() => void save(draft), NOTE_AUTOSAVE_DELAY_MS);
  return () => clearTimeout(timer);
}, [draft, saved, unreadable, save]);
```

Every keystroke changes `draft`, so React's cleanup cancels the previous timer — that *is* the
debounce. It also gives the trailing edge for free: when a save finishes, `saved` changes, the
effect re-runs, and if the user typed during the write the guard is true again and a fresh timer
starts. A failed save leaves all three dependencies untouched, so it does **not** reschedule
itself; the error notice stands and the next keystroke retries. That is deliberate — the API
guide is explicit that auth fails closed and must not be hammered.

Four things this depends on, none of them optional:

1. **The note's UUID is generated once**, when the blank editor mounts, and passed to every save.
   Autosave turns "`POST /notes` without an `id` is not idempotent" from a footnote into a live
   duplicate-note bug. `saveNote` in [`lib/notes`](../../lib/notes/README.md#savenote--one-call-the-autosave-loop-can-fire-repeatedly)
   also answers a `200` create-or-return with a `PUT`, because create-or-return would otherwise
   silently discard everything typed after a timed-out first save.
2. **`inFlight` is a ref, not state**, so the check and the set happen in the same tick. Two
   overlapping writes to a not-yet-created note would both `POST`.
3. **`onClose` and `onSaved` are `useCallback`-stable** in the parent. Inline arrows would give
   the effect a new `save` identity on every parent render, resetting the countdown — an
   autosave that never fires while the user is still typing is the failure mode, and it is
   invisible in testing.
4. **Back is disabled while a write is in flight**, and otherwise flushes: `close()` awaits a
   final `save` before calling `onClose`. Between the two, no keystroke can be dropped by
   leaving the screen mid-debounce.

The screen holds the returned `NoteRecord`, so every save after the first is a `PUT` that reuses
that record's DEK — the component never constructs a `wrapped_dek` itself, which is what keeps the
note openable across edits (see
[`lib/notes`](../../lib/notes/README.md#the-dek-must-survive-the-edit)).

Delete is the only notes action needing the seed key, and it is **two-step**: the button reveals
a confirmation that says the deletion also removes the note from anyone set to inherit it,
because the server destroys those `inheritance_shares` rows in the same transaction and the
response does not report how many went with it. Vault's row Delete is one-step by comparison;
this one guards a longer piece of writing.

A note that will not decrypt opens read-only, with **saving disabled**, so a re-seal cannot
overwrite content this device could not read in the first place.
