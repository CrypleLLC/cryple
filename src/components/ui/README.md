# `components/ui`

The primitives every other folder builds on. Nothing here knows about a domain: no session, no API,
no item type. Import them from the barrel, `@/components/ui`; the icons are a separate import,
`@/components/ui/icons`, so a screen names exactly the glyphs it draws.

| File | What it holds |
| --- | --- |
| `Card.tsx` | `Card` — a heading, an optional subtitle, an `actions` slot and the content — and `PanelGrid` |
| `Button.tsx` | `Button` and its variants, `IconButton`, and `FloatingAddButton` ([Adding an item](#adding-an-item)) |
| `CopyButton.tsx` | The only way a secret reaches the clipboard: it clears the clipboard after 30 s ([`lib/app`](../../lib/app/README.md#plaintext-the-browser-would-otherwise-send-away)) |
| `fields.tsx` | `Field`, `PinField`, `TextArea`, `SecretField`, `Select` — they share one input and label style |
| `Badge.tsx`, `Notice.tsx`, `Empty.tsx`, `Spinner.tsx` | Status and empty-state surfaces |
| `SizeStepper.tsx` | The grids' icon-size control ([The size control](#the-size-control)) |
| `icons.tsx` | The stroke-icon set shared by navigation and primitives, plus `FileTypeIcon` and `FolderGlyph` |

**Text entry goes through these fields, never a bare `<input>`.** `Field` and `TextArea` turn
spellcheck, grammar extensions and translation off by default. **Every PIN entry is a `PinField`**,
never a `Field` with `type="password"`: it carries `pinInputAttributes` so the browser's password
manager neither saves nor autofills the PIN
([`lib/app`](../../lib/app/README.md#a-pin-is-not-a-password-the-browser-may-keep)). `SecretField`
masks what is typed without making it a password field
([`lib/app`](../../lib/app/README.md#a-secret-is-masked-while-it-is-typed)).

## A message in the vault can always be closed

`Notice` takes an optional `onDismiss`; given one, it draws an `×` on the right that calls it. **Every
message raised inside the authenticated area passes one** — an error from a request, a success, a
banner from the provider — and the callback clears the state that holds the message, so the next
message of the same kind shows again. A message the screen's own logic depends on, such as the
Devices tab's chain check that also decides whether *Remove* is offered, is hidden by a separate
`…Dismissed` flag rather than by clearing the fact.

A `Notice` without `onDismiss` is **part of the page, not a message**, and stays:

- **guidance that is the reason a form exists** — the permanence of a username, the one-way door
  before Paranoid, the account-deletion warning, the re-share warning;
- **a confirmation that carries its own buttons** — its *Keep* button is how it closes;
- **a description of what is on screen** — a note or a shared item that cannot be decrypted, a
  document that could not be opened, a folder tree or tab manifest that failed validation;
- **a connection's fingerprint alarm**, which must stay beside the connection it is about for as
  long as the key does not match its pin.

Onboarding and Unlock are outside the vault and do not follow the rule: each of their messages is
replaced by the next attempt.

The dialog is not here: it has behaviour of its own and variants built on it, so it is
[`components/modal`](../modal/README.md).

## Cards and grids

`Card` draws no panel — no border, no background, no shadow, no padding; why is under
[The token layer](../README.md#the-token-layer). It is a heading, an optional subtitle, an `actions`
slot for controls that belong to the heading, and the content. Tables run edge to edge inside it
because their rows carry their own horizontal padding.

Cards that do not need the full width sit inside a `PanelGrid` — a two-column grid from `md` up, a
single stacked column on mobile, `gap-8` because whitespace is what separates blocks. Wide tables
stay outside a grid.

An empty list renders `Empty`: an icon chip and one sentence.

Every interactive primitive carries a `focus-visible` brand ring.

## The size control

`SizeStepper` — a `−` and a `+` either side of the current step's
name — sits in the toolbar immediately before Select / Cancel / Delete and Upload, the same place a
file manager puts it and next to the other things a user does to a whole grid. **All three grids
use it**: the drive, notes and documents. Everything it decides is data in
[`lib/app/icon-size`](../../lib/app/README.md#how-large-the-three-grids-draw-themselves), including the
`grid-template-columns` the grid is given; the component only holds which step is current and writes
it back.

Its labels are props rather than fixed strings, because *"Smaller icons"* is wrong on a screen full
of note previews — notes say *"Smaller notes"*, documents *"Smaller documents"*. The four step names
underneath are shared, since they are the same four steps.

The control is hidden when the grid is empty — there is nothing to resize, and the empty state is
already carrying the instructions.

## Adding an item

**Every screen that creates something uses `FloatingAddButton`** — one round `+` in
the bottom-right corner, never a button in the toolbar. It comes in two placements:

- **default** — aligned to the right edge of the `max-w-6xl` content column (Vault, Passwords);
- **`spread`** — for the full-width (`miniatures`) screens, inset three times the old margin from
  the viewport edge (Notes, Documents, Drive).

Both read `contentMeasure`, `CONTENT_GUTTER` and `FLOATING_SPREAD_GUTTER` from
[`lib/app/shell.ts`](../../lib/app/README.md), which `AppShell` reads too — so the button cannot drift
away from the layout it is aligned to. The button hides itself while a screen is in selection mode.
