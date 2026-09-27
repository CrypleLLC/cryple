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

**The path bar sits at the top of the screen, under the header**: the scope's name, then one segment
per folder down to the open one, and *New folder* on the right. `useFolderTree(scope, onItemsChanged)`
holds the tree and the open folder; the screen lists only the open folder's items
(`?folder=<id>|root`), so a folder of thousands draws its first page without decrypting the rest.

- **Folders look like an operating system's**: `FolderGlyph` in `icons.tsx` is a two-tone folder in
  the brand indigo (`folder-back`, `folder-front`, `folder-shine` tokens in `globals.css`) whose front
  flap opens while something is dragged over it. Folders come first in the grid, in the same cells as
  the items — the icon size on the Drive, the page frame on Documents.
- **A click opens a folder**; the path bar goes back up. Rename and delete are on the tile's hover
  controls; delete is full-device only and its confirmation says the subfolders and items go with it.
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
