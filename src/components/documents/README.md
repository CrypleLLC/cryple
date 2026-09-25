# `components/documents`

| File | Role |
| --- | --- |
| `DocumentsScreen.tsx` | The documents grid of page miniatures — opens each document in its own tab |
| `DocumentWorkspace.tsx` | The `/docs/[id]` page: title, toolbar, A4 sheet, counts, save status |
| `DocumentToolbar.tsx` | The TipTap formatting toolbar |
| `DocumentOutline.tsx` | The heading navigation panel beside the sheet |
| `pageBreak.ts` | The `pageBreak` node — the one page decision that is content |
| `pagination.ts` | Measures the sheet and decorates where each page starts |
| `useOutline.ts` | Debounced heading reads off the editor, and `goToHeading` |
| `useDocumentSync.ts` | Binds `DocumentSync` to a component's lifetime |
| `extensions.ts` | The TipTap extension set, bound to the document's `Y.Doc` |

A document's tile is a [`PageTile`](../tiles/README.md); why it looks the way it does is under
[Document and note tiles](../tiles/README.md#document-and-note-tiles).

## The document editor

The `/docs/[id]` surface is TipTap bound straight to the document's `Y.Doc`, so the editor holds no
content of its own: no `content` option, no `setContent`, no controlled value. Everything the
chrome displays — the outline, the word and page counts, which toolbar buttons are lit — is derived
from `editor.state.doc` on the fly, never written back. A stored attribute would be a sealed delta
appended on every device that opens the document, for a value the editor can recompute for free.
[`lib/documents`](../../lib/documents/README.md) explains why that cost never goes away.

The editable body and the title field carry `PRIVATE_TEXT_ATTRIBUTES` / `PRIVATE_TEXT_PROPS`, so no
spelling, grammar or translation service sees the text, and **the tab title is never the document's
name** — it would land in synced browser history. Why, and what it costs, is in
[`lib/app`](../../lib/app/README.md#plaintext-the-browser-would-otherwise-send-away).

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

`.cryple-page-stack` in [`globals.css`](../../app/globals.css) is A4 written in millimetres —
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
[`paginate`](../../lib/documents/pagination.ts), and turns the answer into `Decoration.node` entries
that insert a fixed-height spacer before the first block of each page — filling the rest of the
previous sheet and the gutter between sheets. **No document transaction is ever dispatched**; the only transaction
carries `setMeta` and no steps, so nothing reaches the CRDT. Read the reasoning in
[`lib/documents`](../../lib/documents/README.md#pagination-is-measured-never-written) before changing
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
  [`samePagination`](../../lib/documents/README.md#pagination-is-measured-never-written).

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
[`lib/documents/outline.ts`](../../lib/documents/outline.ts) with tests; only the DOM scroll stays here.

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

**The toolbar's values live in [`lib/document-styles`](../../lib/document-styles/README.md)**, not here,
because they double as the allowlist. `extensions.ts` swaps TipTap's `Color`, `FontFamily`,
`FontSize`, `LineHeight` and `Highlight` attribute definitions for guarded ones built from the same
lists, so a pasted `style` or `data-color` can store only a value the toolbar could have set — or,
for colours, a plain colour. That module explains the injection it closes.

`FONT_FAMILIES` names `var(--font-sans)` and `var(--font-mono)` — the properties this app actually
defines in `globals.css`. They previously named `--font-geist-*`, which exist in the Next.js
starter template and not here, so two of the three font options silently did nothing. Any export
has to map these tokens to real family names explicitly.
