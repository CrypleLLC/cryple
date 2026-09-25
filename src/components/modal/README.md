# `components/modal`

The one dialog, and the shapes every dialog in the app takes. Import from `@/components/modal`.

| File | What it is | Used by |
| --- | --- | --- |
| `Modal.tsx` | The base dialog: title, subtitle, close button, scrolling body, fixed footer, focus trap, scroll lock | `SettingsModal`, `ShareItemDialog`, and the three below |
| `ModalActions.tsx` | The footer row: a secondary *Cancel* on the right, followed by whatever confirms | `FormModal`, `ConfirmDeleteModal` |
| `FormModal.tsx` | A form in a dialog: *Cancel* and one submit button, disabled while `busy` or while `canSubmit` is false | Adding a secret, adding or editing a password, naming a folder |
| `ConfirmDeleteModal.tsx` | *Are you sure?* before a destructive action: one sentence, *Keep it*, and a danger button with the trash glyph | Deleting a password, a tab, a folder |

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
