# `components/folders`

[Task 133](../../../../tasks.md#task-133). Two components, because the two shapes of folder behave
differently: a tab is flat and holds everything of one kind, a folder nests like an operating
system's.

### Tabs — Vault and Notes (`FolderTabs.tsx`)

**The strip sits directly under the header, flush with it and with the sidebar**, like a browser's
bookmarks bar, and filters what the screen below it lists. It is rendered through
[`ScreenStrip`](../shell/README.md#the-screen-strip) into the shell's sticky top bar, so it spans the
whole content column and stays in view while the list scrolls; the notices it raises stay in the
screen. `useFolderTabs(scope, itemIds)` owns the sealed manifest
([`lib/folders`](../../lib/folders/README.md)); `buildFolderTabs` and `itemsInTab` in
[`lib/app/folders.ts`](../../lib/app/README.md) decide what each tab shows.

- **`home` is always first** and holds everything not filed elsewhere. It can be renamed, never
  deleted.
- **Tabs are flat, square segments** separated by a rule, the first touching the sidebar. The open
  one takes the page's background and a brand line on top, so it reads as joined to the list under
  it; the others sit on the bar. Each carries its count.
- **New tab** is the folder-plus button at the end of the strip; typing happens in place, in a
  tab-shaped field. **Rename** is a double click or the pencil; **delete** is the trash, confirmed in a
  modal that says the items go with the tab. A non-empty tab can only be deleted from a full device,
  because its items' delete is signed like any other.
- **Filing:** drag a secret row or a note onto a tab, or use *Move to…* — a row control in the Vault,
  the selection toolbar in Notes. Dragging a selected note carries the whole selection.
- **Something created while a tab is open is filed in it.**
- **A manifest that fails validation is reported, not rendered**: the strip is replaced by the
  explanation and a *Reset the tabs* button, and everything is listed in one place until the user
  chooses.

### Folders — Documents and the Drive (`FolderBrowser.tsx`)

`FolderTile` draws a folder in the grid and `FolderRow` in the [list](../tiles/README.md#grid-or-list). Both use the
same drop target and the same delete confirmation (`DeleteFolderModal`), so a folder behaves the
same in either layout.

**The path bar sits at the top of the screen, under the header**: the scope's name, then one segment
per folder down to the open one, and *New folder* on the right. `useFolderTree(scope, onItemsChanged)`
holds the tree and the open folder; the screen lists only the open folder's items
(`?folder=<id>|root`), so a folder of thousands draws its first page without decrypting the rest.

- **Folders look like an operating system's**: `FolderGlyph` in `icons.tsx` is a two-tone folder in
  the brand indigo (`folder-back`, `folder-front`, `folder-shine` tokens in `globals.css`) whose front
  flap opens while something is dragged over it. Folders come first in the grid, in the same cells as
  the items, and **at the same scale as the items beside them**. On the Drive a file is a glyph of
  `iconScale(size).glyphPixels`, so the folder gets `glyphPixels` too. Documents is laid out like the
  Drive, with pages as wide as the drive's glyphs, so its folders take the same `glyphPixels` and a
  folder is the same size on both screens at every step. Without `glyphPixels` a folder fills its
  cell's width as a square.
- **A click opens a folder**; the path bar goes back up. The tile's hover controls are *Details*
  (when the screen passes `onDetails`; the Drive and Documents both do) and delete, which is
  full-device only and whose confirmation says the subfolders and items go with it.
- **The open folder's details are one tap away on any screen size.** A tile's *Details* control
  only appears on hover, which a phone does not have, so `FolderPath` takes `onDetails` too and,
  inside a folder, ends the path with an ⓘ button that opens the panel on the folder being shown.
  It is a side-panel trigger like the tile's, so pressing it again closes the panel.
- **Rename lives in the details panel, not on the tile.** `FolderDetailsPanel.tsx` is the
  [side panel](../shell/README.md#the-side-panel) for one folder: its name with a *Rename* button
  that turns it into a field in place — Enter or *Save* renames, Escape or *Cancel* goes back, the
  same `folderNameProblem` rule as creating one — and below that whatever the screen passes as
  children. The Drive adds the item count and total size; Documents adds the item count, read from
  one unfiltered metadata listing, so nothing is decrypted. The field is in the panel rather than in
  a modal because a press outside the panel closes it, and a modal is outside it.
- **Everything is a drop target**: a folder tile and every path segment accept dragged items and
  dragged folders. A folder is never offered a move into itself or past 8 levels (`canMoveFolder`);
  the server refuses both anyway and the screen says why.
- **Drive specifics.** A dragged or moved file takes its thumbnail with it (`withTheirThumbnails`).
  An upload started inside a folder is filed there when it completes. The page-wide *drop files to
  upload* zone reacts only to files from the operating system, never to an internal drag.
- **Housekeeping still sees everything.** Forgetting remembered upload sources and pruning the
  object cache need the whole drive, so they read one unfiltered listing when the screen mounts,
  rather than being fooled by whichever folder is open.
- **A tree the server returns broken is reported, not rendered**: no folder tiles, and everything is
  listed flat.
