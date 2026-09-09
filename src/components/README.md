# `components`

Milestone 5 — Tasks 24 and 25. The React surface. Every decision that can be tested without a DOM
lives in [`src/lib/app`](../lib/app/README.md); these files render it and nothing more, because
the repo's Vitest setup is node-environment and matches `src/**/*.test.ts` only.

| File | Role |
| --- | --- |
| `CrypleProvider.tsx` | Session custody, phase machine, error translation, cross-tab handoff |
| `AppProviders.tsx` | Mounts `CrypleProvider` in the root layout so every route shares one session |
| `SessionGate.tsx` | The loading / onboarding / locked / ready switch, wrapped around each route |
| `Onboarding.tsx` | Task 24 — phrase, PIN, mode, enrolment |
| `Unlock.tsx` | PIN unlock and the 3-attempt device wipe |
| `AppShell.tsx` | Task 25 — the sidebar shell and navigation registry |
| `VaultScreen.tsx` | Vault index, add/delete secrets (Task 34) |
| `VaultReveal.tsx` | The vault's global show/hide-values state and its top-bar button |
| `NotesScreen.tsx` | The notes file grid, selection and batch delete |
| `NoteEditor.tsx` | One note open — autosave, delete, WYSIWYG formatting |
| `NoteEditorToolbar.tsx` | The editor's formatting controls |
| `note-surface.ts` | DOM ↔ note document, for the `contentEditable` surface |
| `DocumentsScreen.tsx` | The documents grid of page miniatures — opens each document in its own tab |
| `documents/DocumentWorkspace.tsx` | The `/docs/[id]` page: title, toolbar, A4 sheet, counts, save status |
| `documents/DocumentToolbar.tsx` | The TipTap formatting toolbar |
| `documents/DocumentOutline.tsx` | The heading navigation panel beside the sheet |
| `documents/pageBreak.ts` | The `pageBreak` node — the one page decision that is content |
| `documents/pagination.ts` | Measures the sheet and decorates where each page starts |
| `documents/useOutline.ts` | Debounced heading reads off the editor, and `goToHeading` |
| `documents/useDocumentSync.ts` | Binds `DocumentSync` to a component's lifetime |
| `documents/extensions.ts` | The TipTap extension set, bound to the document's `Y.Doc` |
| `ui.tsx` | Card / Button / IconButton / Field / TextArea / Select / Badge / Notice / Empty / Modal primitives |
| `icons.tsx` | The stroke-icon set shared by navigation and primitives |
| `StagingBanner.tsx` | The walking red warning banner, dev-only — see [`app`](../app/README.md#the-staging-banner) |

## Layout and design system

The shell is a Drive-style dashboard: a fixed left sidebar with the logo, the navigation and the
account summary, a sticky top bar carrying the current section's title and the session-exit
buttons, and a full-width content column. Below the `md` breakpoint the sidebar folds into a
sticky top header with a horizontally scrolling nav row.

Navigation is one registry, `NAV_ITEMS` in `AppShell.tsx`. Each entry is
`{ id, label, description, icon, screen, actions? }`; adding a section means adding one entry and
its screen component — the sidebar, the mobile nav and the top-bar heading all render from the
same array. Notes was added exactly that way, as one entry; Guardians was **removed** exactly that
way on 2026-09-04, by deleting one. `actions` is the optional slot for a component rendered in the
top bar beside Lock / Log out, for controls that belong to the whole screen rather than to one
panel; the Vault's global reveal toggle is the first of them. State shared between such a control
and its screen lives in a provider wrapping the shell, as `VaultReveal.tsx` does, since the header
sits outside the screen's tree.

### The token layer

Every colour, type step and shadow is a Tailwind v4 `@theme` token in
[`globals.css`](../app/globals.css). Components name tokens (`bg-surface`, `text-ink-muted`,
`border-line`, `shadow-card`) and never raw palette values, so a palette change is one file.

The palette is the Cryple design system as `cryple.io` uses it, with the three adjustments that
system itself flags for text-dense surfaces:

- **Brand indigo `#6366f1` is not a text colour on light grounds** (4.47:1). `brand-500` is for
  fills, the logo and the active nav icon; `brand-600` `#4f46e5` carries filled buttons and
  `brand-700` `#4338ca` carries links and labels.
- **Status colours are the accessible pairs, not the decorative ones**: `success` `#047857`,
  `warning` `#b45309`, `danger` `#b91c1c`, each with its `-bg` and `-line` companion.
- **Grey is a four-step ink ramp**, `ink` `#1f2937` → `ink-soft` → `ink-muted` → `ink-faint`.
  `ink-faint` `#9ca3af` is 2.5:1 on white and is decoration only — never body copy.

Shape follows the same system: `rounded-lg` (8px) for buttons and controls, `rounded-2xl` (16px)
for cards, panels and modals, `rounded-full` for badges. Depth is three shadows — `shadow-card`
at rest, `shadow-raised` for a lifted control, `shadow-lift` for a hover lift or a modal.

Type is Inter with JetBrains Mono for data, both from `next/font`, exposed as `font-sans` /
`font-mono`. The scale is named rather than numeric: `text-caption` (11px, uppercase, tracked —
badges and metadata), `text-compact` (13px — the workhorse for body copy, table cells and button
labels), `text-title` (15px/600 — card headings), `text-headline` (18px/600), `text-headline-lg`
(22px/600 — the top-bar section title), `text-display` (28px/700).

**The action gradient (`#6366f1` → `#8b5cf6`, the `.brand-gradient` class) is rationed to one
element per screen** — the notes FAB, the New-document button, the account avatar. That is the
design system's own rule: gradients work on a hero, and fight the content when they spread across
a dense UI. Everything else is a flat token.

### Panels

Content sits in white `rounded-2xl` panels with a 1px `line` border and `shadow-card`, on the
`ground` `#f9fafb` page. `Card` takes a `flush` prop for table and list content, which then runs
edge-to-edge inside the panel (rows carry their own horizontal padding), and an `actions` slot for
controls that belong to the panel's header. Panels that do not need the full width sit inside a
`PanelGrid` — a two-column grid from `md` up, a single stacked column on mobile. Grid items
stretch, so neighbours in the same row share a height and their borders line up regardless of how
much content each holds. Wide tables stay outside a grid.

An empty screen is still a panel: `Empty` renders an icon chip and one sentence, and its callers
wrap it in a `<Card flush>` so it lands on a surface rather than floating on the page ground. The
two editors do the same — the note surface and the `/docs/[id]` page are sheets, toolbar and
character count included, not bare text on the background.

Every interactive primitive carries a `focus-visible` brand ring.

### One light theme, on purpose

There are no `dark:` variants and no `prefers-color-scheme` block; `:root` sets
`color-scheme: light`. The Cryple design system defines a light palette only, and inventing a dark
one here is exactly the drift it was written down to stop. Because components name tokens rather
than colours, adding dark mode later means redefining the token block under a media query — not
touching a component.

## The modal primitive

`Modal` in `ui.tsx` is the one dialog. Before it, the only "are you sure" surface was an inline
`Notice` — which `DocumentsScreen` still uses for its delete confirmation, and which does not
scale to a scrollable checkbox list of the whole vault.

It is a three-part flex column at `max-h-[85vh]`: **header and footer are `shrink-0`, only the
body scrolls.** A footer that scrolls away takes the Save button with it, which on a long list is
the same as not having one.

**Everything decidable without a DOM lives in [`lib/app/modal.ts`](../lib/app/README.md#a-modal-minus-the-dom)**
— the Escape/Tab decision table, backdrop dismissal, and reference-counted scroll locking — so
those rules have tests, and what is left here is wiring: query the tabbables, read
`document.activeElement`, call `focus()`, set `body.style.overflow`. Same split as
`note-surface.ts` and `lib/note-format`.

The two pieces that can only live here:

- **Focus restore captures the trigger on mount**, before focus moves into the dialog, and returns
  it on unmount. Reading it later would restore focus to the dialog's own close button.
- **Opening focuses the first tabbable, or the dialog itself when it has none** (`tabIndex={-1}`
  exists for that case alone), so the next Tab starts inside and a screen reader announces the
  dialog rather than whatever was behind it.

Verified in a browser rather than asserted, since none of it is reachable from the node-environment
test suite: `aria-modal` and `aria-labelledby` resolving to the title, focus entering on open, the
body locking, Tab walking the controls and wrapping at the end, Tab from outside being pulled back
in, Escape closing, focus returning to the trigger, and the lock releasing. The one path not
exercised is a mouse drag from inside the dialog to outside it.

## Session custody

`CrypleProvider` owns the one `SessionKeystore` and the one `TokenStore` for the app. Its phase is
`loading → onboarding | locked → ready`, decided by whether a local seed vault exists.

**Unlock once, sign from memory.** The 600k-iteration PIN stretch is paid at unlock; the derived
signing key and `Server_Auth_Token` stay in the keystore for the session. Nothing prompts for the
PIN per action.

The provider subscribes to `session.onLock()`, so the keystore's own idle timeout drives the UI
back to `locked` rather than the two drifting apart.

`reportError` is the single funnel for failures: it renders `userMessageFor(error)` — copy built
client-side from the `code`, since the API sends no message — and drops the token on
`401 UNAUTHORIZED`, which is the only 401 meaning "sign in again". `401 INVALID_CREDENTIALS`
renders as one generic message, because a bad signature and a wrong PIN are indistinguishable by
design.

**Logout is deleting our own copy of the token.** There is no revocation endpoint, no session
list, and no "sign out all devices" — none of that is rendered anywhere.

## Onboarding

`enrol` writes the local seed vault **after** `POST /sign-up` succeeds, so a rejected enrolment
does not leave a vault for an account that was never created. On any failure the keystore is
locked, zeroing what was derived.

The mode step states the one-way door before either button. There is no "disable PIN" control and
there never will be.

## Product boundaries this shell respects

Taken from [AGENTS.md § Product boundaries](../../AGENTS.md); each of these is an absence, so it is
recorded here rather than being visible in the code:

- **No session list or "sign out all devices".**

## Nothing here is blocked any more

Two screens used to surface an unresolved backend spec gap rather than hide or fake it, and both
are now closed:

- **Vault items** (`KekNotSpecifiedError`) — Decision A landed 2026-08-08, wired in 2026-08-10.

**Both were built as though they already worked**, against the real calls rather than as disabled
placeholders, so in each case the seam ceasing to throw was the entire change — no UI edit. That
is the pattern to repeat the next time a spec gap blocks a screen: build the screen, throw in the
seam, and let the fix be one file.

## Why the vault list downloads every payload

**Names are ciphertext.** A secret's plaintext is one `{name, value}` JSON blob, so the server
holds no name field to list — `GET /secrets?fields=meta` returns sizes and timestamps and
nothing a person can read. Showing names in the index therefore means opening every item, and
the list loads through `listSecrets` — the single unpaginated `GET /secrets` the endpoint guide
calls "the heaviest response the API produces" — rather than the meta listing plus one
`GET /secrets/{id}` per row. One request beats N, and the values are then already in memory.

Hiding is consequently presentational only: the global toggle in the top bar flips a boolean,
never a fetch, so it is instant in both directions and costs nothing to use. Names stay visible
at all times; only values mask, and they mask to a fixed-width `MASKED_VALUE` so the rendering
does not leak the length. Copy stays available while values are hidden — the point of hiding is
shoulder-surfing, not withholding the value from its owner.

An item that will not decrypt is rendered as `UNREADABLE_SECRET_NAME` and keeps its row instead
of failing the whole list, since one blob written by another client must not blank the vault.
`buildVaultRows` in [`lib/app`](../lib/app/README.md) does that classification, so it is tested
without a DOM.

## Notes is the one populated screen with no panel

`NotesScreen` is a section like Vault or Documents — same `NAV_ITEMS` entry, same top bar — but
once it has files it deliberately **does not wrap them in `Card`**. The tiles render straight into
the content column with no panel border around them, because a panel exists to group controls, and
a file browser's content *is* the grouping. A border there would read as a second, redundant frame
around a grid that already has visible objects in it.

The empty state is the exception, and takes a `<Card flush>`: with no objects on the page there is
nothing for the eye to land on, so the message needs a surface of its own. Documents does the same.

The tiles themselves are not borderless. Each is a page-shaped thumbnail (`aspect-[3/4]`) with a
`shadow-card` and a hairline ring, carrying the note's real first ~420 characters at 9px under a
bottom fade, with the title and date beneath it as a filename. Hovering lifts the tile
(`-translate-y-0.5`, `shadow-lift`) and warms the ring to `brand-200`. That reads as a stack of
paper rather than as a list of rows — the ring belongs to the object, not to the section. A note
that will not decrypt shows the notes glyph instead of content, keeping its tile.

### Selecting files

The grid supports a multi-select for batch delete, entered either from the **Select** button in
the toolbar above the grid or by ticking a checkbox directly — the checkbox is invisible until
the tile is hovered, then persistent once selection mode is on, which is what keeps the default
view clean while still working on touch, where there is no hover.

While selecting, a **tile click toggles instead of opening**. That is the OS file-manager idiom,
and without it a batch of ten means ten precise hits on a 20px checkbox.

The checkbox is a **sibling** of the tile button, not a child: the tile is already a `<button>`,
and nesting one inside it is invalid HTML that browsers silently reflow. Positioning it against
the `<li>` (`group relative`) keeps both independently clickable and independently focusable. It
is a `role="checkbox"` button with `aria-checked` rather than a native input, so its appearance
comes from the same design tokens as everything else; the selected tile also takes a
`ring-2 ring-brand-500` in place of its hairline, so selection is legible without relying on the
20px control alone.

The toolbar is borderless like the rest of the section, and doubles as the count readout —
`12 notes` normally, `3 selected` while selecting, in an `aria-live` region. The new-note FAB
**hides during selection**, so the corner does not offer "create" and "delete" at once.

Deleting asks first, through the same confirmation `Notice` a single delete uses, and then
reports only if the server deleted fewer notes than asked —
[`batchDeleteSummary`](../lib/app/README.md#selecting-notes-for-a-batch-delete) returns nothing on
a clean run, because the notes are visibly gone. `DELETE /notes` takes the whole selection under
**one** signature, so a batch of twenty costs one signed action rather than twenty; the sorting
rule that signature depends on is in
[`lib/notes`](../lib/notes/README.md#deletenotes--one-signature-for-the-whole-selection).

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
further out again, in [`lib/note-format`](../lib/note-format/README.md), so the editor decides
*when* to apply a change and never *what* the change is.

### The editing surface

The writing surface is **WYSIWYG**: a `contentEditable` div with no border or ring of its own,
inside a white sheet that also holds the formatting toolbar above it and the character count
below. Bold text is bold, a title is a real heading, a checklist has real tick boxes. The user
never sees a `#` or a `**` — that spelling is only how the note serializes.

`note-surface.ts` is the DOM half, and it is deliberately the *only* untested file in the
feature: everything decidable without a DOM lives in
[`lib/note-format`](../lib/note-format/README.md), which is why that module has 30 tests and this
one has none (the repo's Vitest is node-environment by design). What is left here is three
functions — read the surface into blocks, find the block at the caret, find the blocks a
selection spans.

The surface holds **one `<div data-line="…">` per line**, styled entirely from that attribute by
CSS in [`globals.css`](../app/globals.css). Bullets and tick boxes are `::before`
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
header carries a status word (`noteSaveState` in [`lib/app`](../lib/app/README.md#the-save-gate))
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
   duplicate-note bug. `saveNote` in [`lib/notes`](../lib/notes/README.md#savenote--one-call-the-autosave-loop-can-fire-repeatedly)
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
[`lib/notes`](../lib/notes/README.md#the-dek-must-survive-the-edit)).

Delete is the only notes action needing the seed key, and it is **two-step**: the button reveals
a confirmation that says the deletion also removes the note from anyone set to inherit it,
because the server destroys those `inheritance_shares` rows in the same transaction and the
response does not report how many went with it. Vault's row Delete is one-step by comparison;
this one guards a longer piece of writing.

A note that will not decrypt opens read-only, with **saving disabled**, so a re-seal cannot
overwrite content this device could not read in the first place.

## Document and note tiles

Both grids render a **file**, not a card: a paper miniature of the content, then the title and a
date underneath, with a selection checkbox that appears on hover. `NoteFile` and `DocumentFile` are
deliberately the same shape, because the two screens sit next to each other in the same navigation
and a reader should not have to learn two layouts.

The document miniature differs from the note's in the three places where a document is not a note:

- **A4, not 3:4.** `aspect-[210/297]` is the real page ratio, and the padding is `12%` / `8.5%` —
  the 25.4mm margin expressed as a fraction of the page, so the miniature is a scale drawing of the
  sheet rather than a box with arbitrary inset.
- **The title is rendered inside the page** when there is one. A note has no title of its own — its
  first line is its title, so drawing it twice would be a lie about the content. A document's title
  lives in `meta.title`, separate from the body, so the miniature shows it exactly where the real
  first page does. `UNTITLED_DOCUMENT` is skipped, because a placeholder is not content.
- **A bigger text budget.** `DOCUMENT_THUMBNAIL_MAX_CHARACTERS` is 1200 against the note's 420: the
  page is taller, and long-form writing is the point, so a miniature that stops a third of the way
  down reads as an empty document rather than a full one. Overshooting is safe — the overflow is
  clipped and the bottom gradient covers the cut.

The date line keeps the documents' own `edited` label ("Edited 2 hours ago") rather than the note's
raw `toLocaleDateString`, since it already existed and says more.

## The document editor

The `/docs/[id]` surface is TipTap bound straight to the document's `Y.Doc`, so the editor holds no
content of its own: no `content` option, no `setContent`, no controlled value. Everything the
chrome displays — the outline, the word and page counts, which toolbar buttons are lit — is derived
from `editor.state.doc` on the fly, never written back. A stored attribute would be a sealed delta
appended on every device that opens the document, for a value the editor can recompute for free.
[`lib/documents`](../lib/documents/README.md) explains why that cost never goes away.

### `useEditorState` must not read the editor out of its own snapshot

This is the trap that made the toolbar render blank on load, and it will bite again.

`useEditor` **does not re-render on transactions** unless `shouldRerenderOnTransaction: true` is
passed, so `editor.isActive('bold')` read during render is frozen at whatever it was when the
component last rendered for some other reason. Reading it that way gives a toolbar that never
lights up and undo/redo buttons that never enable. `useEditorState` is the supported fix: it
subscribes to transactions and re-renders only when the selected value actually changes, which is
also what keeps typing from re-rendering the whole workspace.

Its selector receives `{ editor, transactionNumber }`, and **that `editor` is not reliable**.
`EditorStateManager` caches its snapshot at construction and only rebuilds it when
`transactionNumber` moves; the workspace sets `immediatelyRender: false`, so the cached editor is
`null`, and no transaction fires until the user types. A selector branching on that argument
therefore returns its editor-is-null result forever on an untouched document.

Read the editor from the component's own props instead and let the snapshot serve only as the
invalidation signal:

```ts
const state = useEditorState({
  editor,
  selector: () => (editor === null ? undefined : { bold: editor.isActive('bold') }),
});
```

A re-render replaces the selector closure, so the value is recomputed as soon as `editor` stops
being null; a transaction bumps `transactionNumber` and recomputes it again. Equality is
`deepEqual` by default, so returning a fresh object of flags each time is correct and cheap.

### The sheet

`.cryple-page-stack` in [`globals.css`](../app/globals.css) is A4 written in millimetres —
`--page-width: 210mm`, `--page-height: 297mm`, `--page-margin: 25.4mm` — because CSS defines
`1in = 96px = 25.4mm` exactly, so physical units are deterministic here and a pixel width is only a
paper size in disguise. The previous `max-w-[816px]` was US Letter. The margin collapses below `30rem` so the text column survives on a phone.

The document renders as **discrete sheets, not one continuous page**. That is two layers: an
`aria-hidden` absolute layer painting one `.cryple-sheet` per page, and the text flowing above it
in a single `.cryple-page` whose `min-height` is `--page-count` pages plus the gaps between them.
The text never moves between containers — splitting it into per-page containers is what would
force a document mutation — so the flow stays one uninterrupted ProseMirror document and only the
background knows about pages.

`.cryple-page` → `.cryple-page-body` → `.ProseMirror` is a three-link flex chain so the editable
element fills the sheet. Without it the lower two-thirds of the page belongs to the sheet rather
than to ProseMirror, and clicking there does nothing. With it, ProseMirror's own hit-testing places
the caret — do not add a click handler calling `focus('end')`, which puts the caret in the wrong
place whenever the user clicked beside a paragraph rather than below the last one.

The header is sticky and its height changes when the toolbar wraps, so a `ResizeObserver` writes
the measured height to `--doc-chrome-h` and headings carry a matching `scroll-margin-top`. That is
what keeps an outline click from landing its target underneath the chrome, and it is one
declaration rather than offset arithmetic at each call site.

Printing is the export path: `@media print` hides everything marked `cryple-no-print` (header,
toolbar, outline), drops the sheet's border, shadow and radius, and sets `@page { size: A4;
margin: 0 }` so the printed margins are the sheet's own padding — the same declaration as on
screen. Browser-added headers and footers are the user's print-dialog setting and cannot be
suppressed from CSS.

The page count in the header comes from the pagination plugin, so it is the real number of sheets
rather than a words-per-page guess that would disagree with what prints.

### Pagination

The plugin measures each top-level block, hands the heights to
[`paginate`](../lib/documents/pagination.ts), and turns the answer into `Decoration.node` entries
that insert a fixed-height spacer before the first block of each page — filling the rest of the
previous sheet and the gutter between sheets. **No document transaction is ever dispatched**; the only transaction
carries `setMeta` and no steps, so nothing reaches the CRDT. Read the reasoning in
[`lib/documents`](../lib/documents/README.md#pagination-is-measured-never-written) before changing
any of it.

Four details are load-bearing:

- **Widget decorations, not node decorations.** A node decoration is dropped the moment its node
  stops being exactly one node — pressing Enter inside the first block of a page splits it, the
  decoration disappears, and the page collapses upward so the text renders in the gutter between
  sheets. A widget is a single position, which maps through a split intact. It also keeps the
  measurement honest: block heights are read straight off the element, with no injected padding to
  subtract back out.
- **`.cryple-prose` spacing is `margin-top` only**, and `:first-child` gets none. Blocks with a
  `margin-bottom` would collapse against the next block's `margin-top` and the measured heights
  would no longer sum to the rendered flow. The first-child rule matters because `.ProseMirror` is
  a flex item and therefore a BFC root: the first block's margin does *not* escape it, so without
  the rule page one starts lower than every other page and the arithmetic drifts by that margin.
- **Measure in a microtask, never on a timer or `requestAnimationFrame`.** This is what decides
  whether the feature reads as *"the next line is on the next page"* or as *"the next line is in
  the gutter and something will move it shortly"*. Microtasks drain before the browser paints, so
  the corrected geometry is in place for the first frame that shows the edit and the intermediate
  state is never rendered. A timer defers past the paint — the text visibly lands in the gutter and
  jumps. rAF is worse still: it runs after layout, and it does not fire at all in a background tab,
  so a document opened in a tab that is not in front would never paginate until you looked at it.
  The layout reads force their own reflow, which is all the frame callback was ever wanted for.
- **The skip check compares block indices *and* the decorations' live anchor positions.** Skipping
  a rebuild is what keeps typing cheap, but it is only safe when the spacers already on screen are
  where this pass would have put them. Indices alone are not enough: a decoration is anchored to a
  document position, so after an edit that inserts or removes a block, "the break is at index 202"
  can be true of both the old and the new pagination while the spacer is anchored to what is now
  block 203. That renders as text spilling into the gutter and it never recovers, because every
  later pass agrees nothing changed. `sameAnchors` compares each live decoration's `from` against
  the position this pass computed for it, so the rebuild is skipped only when the spacers are
  genuinely already correct. See also
  [`samePagination`](../lib/documents/README.md#pagination-is-measured-never-written).

`MAX_PASSES` caps the settle loop so a pathological document cannot spin the microtask queue.

### Keeping it cheap on a long document

Measuring on every transaction is what buys the pre-paint correctness, so the measurement itself
has to be cheap. Three things make it so, and all three were found by profiling a 2 000-block,
116-page document rather than by guessing:

| | before | after |
| --- | --- | --- |
| Measurement pass | 70.7 ms | 0.9 ms |
| Whole keystroke | 44.3 ms | 21.7 ms |

- **Never call `view.nodeDOM` per block.** It resolves a position by walking siblings, so calling
  it once per top-level node is quadratic — 33.6 ms of the original 70.7 on its own. The elements
  are read from `view.dom.children` in one linear pass instead, skipping the spacer widgets and the
  gap cursor. `elementsByPosition` stays as a fallback for the case where that count disagrees with
  `doc.childCount`, which keeps correctness independent of assumptions about what ProseMirror
  renders.
- **Cache each block's measurement against its ProseMirror node.** Nodes are immutable and shared
  between states, so a node that is `===` the one measured last time cannot have changed height.
  A keystroke re-measures exactly the block it touched. The cache is a `WeakMap`, so it needs no
  eviction, and it is dropped whole when the editor's width changes or a web font finishes loading
  — the two things that change every height at once. Index 0 is never cached, because
  `:first-child` zeroes its margin and that would be wrong for the node anywhere else.
- **Do not dispatch when the pagination did not change.** Most keystrokes do not move a page break,
  and a dispatch is not free: it re-runs every `useEditorState` selector and re-renders the chrome.

The counts in the header are debounced for the same reason. `characterCount.words()` walks the
whole document — 9.3 ms on the 2 000-block document — and through `useEditorState` it ran on every
transaction, twice per keystroke once the pagination dispatch is counted. It is display-only, so it
now reads on a 400 ms trailing debounce like the outline does.

`paginate` uses a prefix-sum array so each page's extent is O(1) and the whole pass is O(n);
`pagination.test.ts` pins that with a 20 000-block case. It was never the bottleneck — 0.45 ms at
10 000 blocks even in the naive form — which is precisely why measuring first was worth it.

The residual page-to-sheet misalignment is bounded at ~1.5 px across 115 page breaks. Rounding the
spacer height is what makes it accumulate, because the sheets sit at exact multiples of the page
height while the spacers stack up rounding error; the height is therefore left fractional.

Print agrees with the screen **by construction** rather than by luck: the spacer is hidden and
`.cryple-page-gap + *` becomes `break-before: page`, so the browser breaks at exactly the blocks
the plugin chose. `@page { margin: 25.4mm }` with `.cryple-page` padding removed is what gives
pages two and onward their margins — box padding only applies at the start of the box, so the
sheet's own padding cannot serve a multi-page print.

`pageBreak` is an atom node of zero height: it marks the spot without consuming any of the page, so
the page simply ends where the user put it. It is the only pagination fact stored in the document,
and it is stored because it is the user's intent rather than a measurement. `Mod-Enter` inserts
one.

### The outline panel

`readOutline` walks only top-level blocks — returning `false` from the `descendants` callback stops
the descent — so a heading inside a table cell or a blockquote is not a section. Entries carry a
ProseMirror **position**, which is valid only for the state it was read from, so the outline is
re-read on every change rather than cached across transactions.

Nesting is a stack that pops while the top is at or below the incoming level, which handles a
document whose headings skip a level or never start at `h1`. Rows indent by **tree depth, not
heading level**, or a document written entirely in `h2` renders permanently indented.
`outlineTree` and `activeHeadingPos` are pure and live in
[`lib/documents/outline.ts`](../lib/documents/outline.ts) with tests; only the DOM scroll stays here.

The active row follows the **caret**, not the scroll position: the caret is what a writer tracks,
and it is already state. An `IntersectionObserver` would need tearing down and re-attaching on
every transaction, because ProseMirror replaces heading elements as the document changes.

The panel is `sticky` on the flex **item**, not on the `<nav>` inside it — a sticky element can
only travel within its parent's box, and with `items-start` that wrapper is only as tall as the
nav, so sticking the nav does nothing at all.

### Toolbar

Buttons reflect state (`aria-pressed`, `disabled` from `can()`), every command chains through
`.focus()`, and each control's `onMouseDown` is prevented so clicking it does not blur the editor.
The `Selection` extension is enabled for the same reason from the other side: the `<select>`s and
the link popover do take focus, and without it the user's selection visibly disappears while they
choose a font.

Link editing is an in-toolbar popover rather than `window.prompt`, which blocks the page, cannot be
styled, and had no way to edit an existing href. `extendMarkRange('link')` is what lets it work
from a bare caret inside a link. URL validation belongs to the Link extension's `isAllowedUri`
allowlist, not here.

The paragraph-style control calls `setHeading`, not `toggleHeading`: from a `<select>`, choosing
the level that is already active must be a no-op, and toggle turns it back into a paragraph while
the select still reads "Heading 2".

`FONT_FAMILIES` names `var(--font-sans)` and `var(--font-mono)` — the properties this app actually
defines in `globals.css`. They previously named `--font-geist-*`, which exist in the Next.js
starter template and not here, so two of the three font options silently did nothing. Any export
has to map these tokens to real family names explicitly.
