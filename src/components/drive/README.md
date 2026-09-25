# `components/drive`

| File | Role |
| --- | --- |
| `DriveScreen.tsx` | The drive: file grid, drag-and-drop upload, progress, download, selection and delete |

Its corner controls are [`TileAction`](../tiles/README.md) and [`TileCheckbox`](../tiles/README.md),
the folders are [`FolderBrowser`](../folders/README.md), and the size control is `SizeStepper` from
[`components/ui`](../ui/README.md#the-size-control).

## The drive screen

Everything decidable without a DOM is in [`lib/app/files.ts`](../../lib/app/README.md) with tests —
byte formatting, file kinds, the storage bar, and **every string that makes a durability claim**.
The component is wiring.

Three rules the copy has to keep, and each has a test asserting it rather than a reviewer
remembering it:

- **Never claim two providers.** Replication is asynchronous, so for up to a minute a file is real
  and exists in one place. `replicationLabel` says *"Saved. A second copy is made within a minute"*
  until `gcs_state` is `ok`, and the test asserts the pending string contains neither "two" nor
  "provider". A failed replica gets its own line rather than hiding behind the happy one.
- **A file opens the moment R2 has it.** `isOpenable` keys on `r2_state`, not on the replica —
  waiting for `gcs_state` would make the product feel a minute slower than it is for no gain.
- **Deleting does not free space immediately.** The row keeps its bytes until the reconciler removes
  both copies, so `fileDeleteConfirmation` and `storageFullMessage` both say when the space returns.
  A user who deletes a file and then hits the ceiling would otherwise think the product is broken.
- **The bar draws what R2 holds, never what has been reserved.** `GET /files/usage` answers with two
  sums: `stored_bytes` (`r2_state = 'ok'`) and `used_bytes`, which also counts the `pending` rows the
  ceiling is checked against. Filling the bar with the second would show space consumed by files
  that do not exist — an upload that died at its first part would look like a stored file. Showing
  only the first would be a different lie, because the account can be refused an upload while the
  bar shows room. So `storageBar` returns both: a solid fill for what is stored and a quieter
  segment for what is merely held, with `uploadingSummary` naming it. `nearlyFull` keys on
  `used_bytes`, because that is the number that will refuse the next upload.

Selecting files and deleting them together works exactly as it does in notes — the same checkbox,
the same toolbar readout, the same rule that a tile click toggles while selecting — and the shared
reasoning is under [Selecting files](../tiles/README.md#selecting-files) rather than repeated here. Two things are the
drive's own:

- **An unfinished upload is selectable even though it cannot be opened.** Its tile is disabled for
  download and stays live for selection, because a row that holds quota with nothing behind it is
  precisely the one a user needs to clear.
- **An unfinished upload can also be finished, usually in one click.** Its tile carries an upload
  glyph instead of the download one. Where the browser can hand out file handles the app kept one
  when the upload started, so the click resumes straight away; where it cannot — Firefox, Safari —
  the same click asks for the file back. The tile's tooltip says which of the two will happen, so
  the control is never a surprise. Picking or reopening the wrong file is refused by `lib/files`,
  not by the component, and the refusal lands in the transfer list like any other failed upload.
- **A transfer is reported on a tile and nowhere else.** A progress line runs along the bottom of
  the miniature and the status line under the name counts up in place of whatever it said before.
  There is no separate list above the grid — one upload was otherwise reported in two places, and
  the tile is the place the user is already looking.
- **An upload gets a tile before the server has a row.** `send` mints the id up front, so a
  placeholder tile is drawn from the `File` itself — name, size, kind — and the real row replaces it
  when the listing reloads. That is why a first upload animates the same way a resume does; before
  it, the very first upload of a file was the one case with nothing to watch.
- **The label matters most on a resume**, because the line it replaces reads *"This upload never
  finished, so the file is not in your vault"*. Leaving that in place while bytes are moving tells
  the user the opposite of what is happening.
- **A failure that stored nothing gives its reservation back on the spot.** `POST /files` reserves
  the declared size before any URL is signed, so an upload that dies at its first part would hold
  the whole file's worth of quota until a sweep ran a day later. `send` watches `doneBytes`: if no
  part was ever confirmed it abandons the row, and what stays on screen is a notice with nothing
  behind it. **A failure that did store parts keeps its row**, because those bytes are what makes
  resuming worth doing — the user decides, with Resume and Discard on the tile.
- **A failed transfer keeps its tile** — a red line where the progress was, the reason under the
  name over up to three lines, and a close control that is always visible rather than waiting for a
  hover. Dismissing forgets the notice; it does not touch the row on the server. A placeholder whose
  upload failed before any row existed (too large, over quota) disappears with it.
- **The trash control means two different things, and says so.** On a stored file it is the signed
  `file-delete` and the confirmation talks about permanence. On an unfinished upload it is the
  JWT-only abandon: nothing was stored, so there is nothing to warn about losing, and the
  confirmation says the space comes back at once instead. Same button, different sentence, because
  the two actions destroy different things.
- **A transferring or placeholder tile is inert**: not openable, not selectable, controls hidden.
  Every one of those actions would race the upload the tile is showing, and a placeholder has no
  row behind it to act on.
- **The transfers themselves do not live in this component.** `AppShell` renders only the active
  section, so opening Notes unmounts the drive and would take every in-flight upload's progress with
  it — the upload kept running, invisibly, and coming back showed a file that looked stalled. They
  live in [`lib/app/transfers`](../../lib/app/README.md#uploads-outlive-the-screen-that-started-them)
  and are read with `useSyncExternalStore`, so the screen is a view of them rather than their owner.
- **The summary line matters more here than in notes, and it is not an error.** The screen's one
  message slot carries a tone, because *"Deleted 2 of 3 — 1 file was already gone"* rendered in the
  danger colour reads as a failure and contradicts the copy's whole point. A shortfall is `info`; a
  thrown request is `danger`. `fileBatchDeleteSummary` stays silent on a clean run, since the tiles
  are visibly gone. The storage bar reloads with the grid, so the reclaimed space lands in the same
  paint.

**An image tile shows the image.** The preview is a thumbnail file of its own, fetched and decrypted
like any other download and held as an object URL in `lib/app/previews` so a return trip to the
drive does not fetch it again — and, since 2026-09-11, kept as sealed bytes in OPFS
([`lib/files/cache`](../../lib/files/README.md#the-cache-holds-ciphertext-and-that-is-the-whole-design))
so a *reload* does not fetch it either. It is drawn with a plain `<img>`, and `next/image` is disabled for
this file in the lint config rather than worked around: the optimiser fetches the source
server-side, and this source is a `blob:` of bytes that only exist decrypted in this tab. A file
with no preview — not an image, an undecodable type, a browser without `OffscreenCanvas`, a
thumbnail upload that failed — falls back to the type glyph, so nothing waits on a preview that is
never coming.

### The drive tile is an icon, not a page

Notes and documents are **pages**, so their tile is an A4 miniature of the page: the content is the
thumbnail. A drive holds a `.zip`, a `.docx`, a 4 GiB video — things with no page to draw — and
until 2026-09-11 they were drawn at that same A4 size anyway, five to a row, each one a huge sheet
of paper with a small glyph floating in the middle of it. A `.zip` is not a document, and sizing it
like one wastes most of the screen on empty paper.

So the drive alone uses the **desktop file-manager shape**: a square icon, the name centred under
it over up to two lines, one line of caption under that.

- **A file with a thumbnail shows it at its own aspect ratio.** The image is `object-contain` inside
  a square of the glyph size, so a portrait photo stays portrait and a landscape one stays
  landscape — the box is a ceiling on the longest edge, not a shape imposed on the picture.
  `object-cover` was the previous behaviour and it centre-cropped every photo to A4.
- **Everything else gets a type icon.** `FileTypeIcon` in [`icons.tsx`](../ui/icons.tsx) draws one sheet
  with a folded corner, a mark saying what kind of thing it is, and a coloured band carrying the
  extension — the shape a desktop uses, for the reason a desktop uses it: the extension is the
  fastest identifier a user has, and the colour is what makes a wall of them scannable. The kind
  comes from the MIME type via `fileKind`, which now separates the office families (`document`,
  `sheet`, `slides`) and `code` rather than dropping all of them into `other`, because those are
  exactly the files a drive is full of and an icon that cannot tell a `.docx` from a `.zip` is not
  doing its job. The band's label comes from the **name**, not the type — `fileExtension` is what a
  file manager shows, and it stays empty rather than guessing when the suffix is missing, long, or
  not plain alphanumeric.
- **A glyph the browser could not decrypt is the generic sheet** — grey band, no mark — which is
  precisely what an OS shows for a type it does not know. The caption already says the file is
  unreadable; the icon does not need to say it twice.
- **The icons on the miniature are the ones that had to shrink.** The checkbox and the hover actions
  moved to the tile's corners at `h-5 w-5`, because at the smallest step the whole tile is 96px and
  the old 24px controls at `inset-3` did not fit inside it.
- **Icons bottom-align within their box.** A landscape thumbnail is shorter than a portrait one, and
  aligning them on their tops would leave a ragged row of names.

### What moved off the miniature

The size used to be a pill floating over the bottom of the A4 sheet. At 48px it would cover the
thumbnail it sits on, so it moved to the caption line, and `fileCaption` decides what that line
says: the size, **unless the status still has a durability claim to make**. `REPLICATION_DONE` is
the one state with nothing left to say — the file is stored, twice, and a grid of forty tiles each
repeating *"Saved, with a second copy"* is noise. Every other state keeps the line: pending
replication, a failed replica, a file being repaired, an unfinished upload. The full status stays
in the tile's `title` in all cases, so nothing is lost, only unsaid. A test pins both halves.

**The bar is not part of this screen.** It lives in the sidebar's bottom corner, drawn by
`StorageMeter` from a shared `lib/app/usage` store: it is an account-level fact, not a drive-screen
fact, and a user who is about to upload something is often looking at another section. The drive
publishes each reading it takes; the meter fetches one itself if it mounts before the drive is ever
opened. The account chip moved the other way, from that corner to the top bar next to Lock and Log
out, where the rest of the identity chrome already is.

`FILES_ENABLE` is off by default, so `/files` answers `404` on a deployment without R2. That is not
an error worth showing a user: `ApiError.isDriveDisabled` turns it into "the drive is not switched
on for this deployment".
