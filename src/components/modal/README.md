# `components/modal`

The one dialog, and the shapes every dialog in the app takes. Import from `@/components/modal`.

| File | What it is | Used by |
| --- | --- | --- |
| `Modal.tsx` | The base dialog: title, subtitle, close button, scrolling body, fixed footer, focus trap, scroll lock | `SettingsModal`, `ShareItemDialog`, and the three below |
| `ModalActions.tsx` | The footer row: a secondary *Cancel* on the right, followed by whatever confirms | `FormModal`, `ConfirmDeleteModal` |
| `FormModal.tsx` | A form in a dialog: *Cancel* and one submit button, disabled while `busy` or while `canSubmit` is false | Adding a secret, adding or editing a password, naming a folder |
| `ConfirmDeleteModal.tsx` | *Are you sure?* before a destructive action: one sentence, *Keep it*, and a danger button with the trash glyph | Deleting a password, a tab, a folder |
| `MediaViewer.tsx` | The image viewer and video player, over the whole dashboard ([below](#the-media-viewer)) | The drive, Shared |

**A new dialog starts from one of the variants, not from `Modal`.** Each variant exists because the
same footer had been written out by hand in several screens, each a little different — a Cancel
that was not disabled while a write ran, a confirm button without the trash glyph. Drop to `Modal`
only for a dialog that is neither a form nor a confirmation, like the Settings tabs or the share
picker.

`ConfirmDeleteModal` hides its confirm button when `onConfirm` is absent. That is how the tab strip
shows a refusal — *this tab cannot be deleted from this device* — in the same dialog, with nothing
to press but *Keep it*.

`FormModal` does not wrap its children in a `<form>`. A screen that wants Enter to submit adds its own
form inside, as the folder-name dialog does; making it the default would turn every `Button` in the
body without an explicit `type` into a submit button.

## The modal primitive

`Modal` is the one dialog. Before it, the only "are you sure" surface was an inline
`Notice` — which `DocumentsScreen` still uses for its delete confirmation, and which does not
scale to a scrollable checkbox list of the whole vault.

It is a three-part flex column at `max-h-[85vh]`: **header and footer are `shrink-0`, only the
body scrolls.** A footer that scrolls away takes the Save button with it, which on a long list is
the same as not having one.

**Everything decidable without a DOM lives in [`lib/app/modal.ts`](../../lib/app/README.md#a-modal-minus-the-dom)**
— the Escape/Tab decision table, backdrop dismissal, and reference-counted scroll locking — so
those rules have tests, and what is left here is wiring: query the tabbables, read
`document.activeElement`, call `focus()`, set `body.style.overflow`. Same split as
[`note-surface.ts`](../notes/README.md#the-editing-surface) and `lib/note-format`.

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

## The media viewer

`MediaViewer` opens an image or plays a video **over the whole dashboard**, on a dark translucent
backdrop (`bg-ink/90` with a blur), rather than in a card: a photo wants the screen. It is a dialog
like the others — `role="dialog"`, `aria-modal`, focus moved in and restored on close, the page
behind locked from scrolling — and it gets that from the same two pieces `Modal` uses,
`useDialogLifecycle` and `trapDialogKeys`, exported from `Modal.tsx` so the open-dialog count behind
the scroll lock stays one number. A viewer opened over a modal, or a modal over the viewer, cannot
unlock the page early.

What it shows is decided by [`lib/app/viewer.ts`](../../lib/app/README.md), with tests:

- **Only what the browser can draw.** An image opens when its type is in `VIEWABLE_IMAGE_TYPES`
  (JPEG, PNG, GIF, WebP, AVIF, BMP, SVG, ICO); HEIC and TIFF are left to a download, because an
  `<img>` that cannot decode them shows a broken picture. A video opens when **this** browser's
  `canPlayType` says it can — a `.mkv` plays in some and not others. Anything else keeps the
  screen's old click, which downloads.
- **The bytes are decrypted in this tab and shown from a `blob:` URL**, the only source the
  [Content Security Policy](../../lib/security-headers/README.md) allows for `img-src` and
  `media-src` besides the app itself. The decrypted array is zeroed once the `Blob` holds its copy,
  and the URL is revoked when the viewer moves on or closes. Nothing is written to disk.
- **Loading shows the percentage decrypted**, from `downloadFile`'s `onProgress`, and moving to
  another item aborts the one still loading (`signal`), so flicking through a folder does not queue
  every file behind the one on screen.
- **A file over the in-memory limit** (`DEFAULT_DOWNLOAD_BUFFER_BYTES`, 128 MiB) says so and offers
  the download, rather than trying: the whole file has to be in memory to play from a `blob:`. A
  file the browser then fails to decode says *this browser cannot show this file*, with the same
  button. Streaming a large video through a Service Worker is the way past this, and not built.
- **Moving between items**: the arrows at the sides, ← and → on the keyboard, and a swipe on touch.
  It stops at the ends instead of wrapping, and says *3 of 12*. While the video has focus the arrow
  keys are the player's, for seeking.
- **Closing**: the ×, Escape, or a click on the backdrop around the picture.
- **Download** is in the header, and it is the screen's own download, so a drive file downloads
  exactly as its tile's Download does.

The `<img>` is exempt from `@next/next/no-img-element` in the lint config, for the reason the drive's
thumbnail is: `next/image` fetches its source on the server, and this source exists only decrypted
in this tab.
