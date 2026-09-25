# `components/tiles`

The parts every file grid shares — Notes, Documents and the Drive. Import from `@/components/tiles`.

| File | What it is | Used by |
| --- | --- | --- |
| `TileCheckbox.tsx` | The selection checkbox in a tile's corner, invisible until hover or selection mode | `PageTile`, the drive tile |
| `TileAction.tsx` | The small square control in a tile's corner — share, download, rename, delete, dismiss | `PageTile`, the drive tile, folder tiles |
| `PageTile.tsx` | A page miniature: paper frame, content or an unreadable glyph, bottom fade, title and caption | Notes, Documents |

`TileCheckbox` takes its position as a class (`left-3 top-3` on a page, `left-1 top-1` on a drive
icon) because the drive's smallest tile is 96px and has no room for the page inset.

`TileAction` has three hover tones: `brand` for an action, `danger` for a delete, `neutral` for
dismissing something that is already over. Its `title` defaults to its label, so every corner control
has a tooltip; pass `title` when the tooltip has more to say than the label, as the drive's resume and
discard controls do.

`PageTile` owns the frame and the caption, and the screen passes the page's contents as children:
the note's first lines, or the document's title over its body. **Anything that differs between a
note and a document stays in the screen**; anything that is the same shape moves here, so the two
grids cannot drift apart.

## Selecting files

Each grid supports a multi-select for batch delete, entered either from the **Select** button in
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

## Document and note tiles

Both grids render a **file**, not a card: a paper miniature of the content, then the title and a
date underneath, with a selection checkbox that appears on hover. `NoteFile` and `DocumentFile` are
deliberately the same shape, because the two screens sit next to each other in the same navigation
and a reader should not have to learn two layouts.

**Both grids resize**, with the same `SizeStepper` the drive uses and the reasoning in
[`lib/app/icon-size`](../../lib/app/README.md#how-large-the-three-grids-draw-themselves). The step sets
the column width, which for a page grid *is* the page width — the miniature is `w-full` inside it
and its aspect ratio does the rest. Everything inside the page is expressed as a share of the page,
so scaling one scales all of it: the margins already were (`12%` / `8.5%`), and the body text, the
inner title, the bottom fade and the undecryptable-page glyph now are too. A miniature that kept
9px text on a 264px page would stop being a scale drawing and start being a box with small writing
in it.

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
