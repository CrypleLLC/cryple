# `components/tiles`

The parts every file grid shares — Notes, Documents and the Drive. Import from `@/components/tiles`.

| File | What it is | Used by |
| --- | --- | --- |
| `TileCheckbox.tsx` | The selection checkbox in a tile's corner, invisible until hover or selection mode | `PageTile`, the drive tile |
| `TileAction.tsx` | The small square control in a tile's corner — share, download, rename, delete, dismiss | `PageTile`, the drive tile, folder tiles |
| `ListingRow.tsx` | `Listing`, the list layout's header and rows, and `ListingRow`, one folder or file in it ([Grid or list](#grid-or-list)) | The drive, Documents, folder rows |
| `useMarqueeSelection.tsx` | Selecting with the mouse: a box dragged over empty space, and Ctrl/⌘-click ([below](#selecting-with-the-mouse)) | The drive, Documents |
| `PageTile.tsx` | A page miniature: paper frame, content or an unreadable glyph, bottom fade, title, and an optional caption | Notes, Documents |

`TileCheckbox` takes its position as a class (`left-3 top-3` on a page, `left-1 top-1` on a drive
icon) because the drive's smallest tile is 96px and has no room for the page inset.

`TileAction` has three hover tones: `brand` for an action, `danger` for a delete, `neutral` for
dismissing something that is already over. Its `title` defaults to its label, so every corner control
has a tooltip; pass `title` when the tooltip has more to say than the label, as the drive's resume and
discard controls do.

`PageTile` owns the frame and the title, and the screen passes the page's contents as children:
the note's first lines, or the document's title over its body. **Anything that differs between a
note and a document stays in the screen**; anything that is the same shape moves here, so the two
grids cannot drift apart.

**The caption is optional.** Notes passes the date under the title; Documents passes none, because a
grid of files and folders shows icons and names only, and gives the edit date or the reason a page
could not be read as `hint`, the tooltip.

**`pageWidth` switches the tile to the drive's shape.** Without it the page fills the column and the
title sits left-aligned under it, as on Notes. With it — Documents passes the drive's glyph size —
the page is exactly that wide, centred, with the name centred under it over up to two lines, the
tile highlights on hover, and the corner controls sit in the tile's corners, exactly like a drive
file beside a drive folder.

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

## Grid or list

The drive and documents each draw their folder in one of two layouts, chosen with `LayoutToggle`
next to the size control. **The grid is the default and is unchanged**; the list is the same
contents as a table with details. The choice is remembered per screen
(`readItemLayout`/`writeItemLayout` in [`lib/app/icon-size`](../../lib/app/README.md#remembered-per-screen-not-once)),
and the size control is hidden while the list is shown, because there is nothing for it to size.

`Listing` draws the header and holds the rows; `ListingRow` is one row. The columns:

| Column | Drive file | Document | Folder |
| --- | --- | --- | --- |
| Name | the thumbnail or type icon, then the name | a blue document icon, then the title | the folder glyph, then the name |
| Type | `fileTypeLabel` — *Spreadsheet · XLSX* | *Document* | *Folder* |
| Size | the file's true size | the size of the document's encoded content | — |
| Modified | `listingDateLabel(updated_at)` | the same | the same |
| Status | `fileStatusShortLabel`, or the upload's progress | *Saved*, or *Could not be decrypted* | — |

- **Folders come first, then files, each newest created first** (`newestCreatedFirst`). An upload
  still in flight has no creation time yet, and sorts above everything, where it was just dropped.
- **The narrow columns go in a fixed order.** Status goes first, then Modified; Name, Type and
  Size always stay. The breakpoints are **container queries** (`@container` on `Listing`,
  `@lg` for Modified, `@2xl` for Status), not viewport ones, because the width that matters is the
  content area's: the side panel and the sidebar take room from it at any window size.
- **The status column is short, and the full sentence is the row's tooltip.** The drive's
  durability sentences (*"Saved. A second copy is made within a minute."*) do not fit a column, so
  `fileStatusShortLabel` names the same states in two words, and the pending one is tested never to
  say *two* or *provider*, the same rule the long one keeps.
- **Everything the grid does, the list does.** A row opens, downloads or toggles selection exactly as
  its tile does; its checkbox sits in the left gutter, its corner controls at the right end on
  hover; rows drag onto folders and path segments, and folder rows are drop targets. The drive's
  controls are one component, `DriveFileActions`, drawn by both the tile and the row, so the two
  layouts cannot offer different actions.

## Selecting with the mouse

The drive and Documents select the way a desktop file manager does, on top of the checkbox and the
*Select* button:

- **Drag a box over empty space** and every file or document it touches is selected, live, as it
  grows. The box is drawn in the brand colour over the page and follows the pointer; the selection is
  replaced by what it touches, or **added to with Ctrl, ⌘ or Shift** held when the drag began.
  Selecting anything turns selection mode on, so the toolbar's readout, *Move to…* and *Delete*
  appear exactly as if the checkboxes had been ticked.
- **A click on empty space leaves selection mode**, exactly as *Cancel* does: nothing selected, the
  checkboxes hidden again, the toolbar back to *Select*, and a delete confirmation that was showing
  withdrawn (`onExit`). A drag of less than four pixels is a click (`MARQUEE_THRESHOLD_PIXELS`), so
  a slightly shaky click does not become a one-pixel box. A click with Ctrl, ⌘ or Shift held does
  not exit, since those mean *add to what is selected*.
- **Ctrl/⌘-click toggles one item** without opening it, and without entering the item: the handler
  runs in the capture phase and stops the click before the tile's own `onClick`.
- **Dragging a selected item drags the whole selection** onto a folder, a path segment or a tab, as
  it already did; `startItemDrag` now shows a badge — *3 files*, *5 documents* — as the drag image
  when more than one thing is moving, because the default image was the one tile under the pointer
  and said nothing about the other two.

How it decides, in [`lib/app/marquee.ts`](../../lib/app/README.md) (tested): the box is the
rectangle between the press and the pointer whichever way it was drawn (`boxBetween`), an item is
hit when its rectangle overlaps the box at all (`boxesTouch`, an edge shared is not a touch), and
`marqueeSelection` replaces or unions.

How it finds the items: a selectable tile or row carries **`data-select-id`** — `PageTile` and
`ListingRow` take it as `selectId`, the drive's tile sets it itself — and the hook measures those
elements inside the container on each move. **Folders do not carry it**, because a folder is not
selectable in these grids; an upload in progress or a placeholder does not either, because it cannot
be acted on.

**The box only starts on background.** A press on a tile, a row, any button, link, form field,
checkbox or draggable element is left alone: pressing a tile has to stay a native drag, and a box
starting there would fight it. It is mouse-only — on touch the same gesture scrolls the page, and a
long press there is the checkbox's job. While a box is being drawn, text selection is turned off on
the page and turned back on at the end.
