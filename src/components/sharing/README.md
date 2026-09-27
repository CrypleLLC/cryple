# `components/sharing`

Invitations and fingerprints, nicknames, sending, and what arrived, with *Copy to my own account*.
Everything they decide is in [`lib/sharing`](../../lib/sharing/README.md).

| File | Role |
| --- | --- |
| `SharingScreen.tsx` | The Settings **Sharing** tab — invite, review, connect, disconnect, each connection checked against its pin |
| `ConnectionInvitation.tsx` | One invitation under review: the two fingerprints to compare, accept and decline |
| `ShareItemDialog.tsx` | Sending one item to a connection, from the item's own share control |
| `SharedScreen.tsx` | The **Shared** sidebar section: a tile grid of what other people sent |

## What arrived is a place you keep things

**But what arrived *is* a place you keep things, so it stayed in the sidebar.** `SharingScreen` in
Settings is only the relationships — invite, review, connect, disconnect. The items other people
sent you are the **Shared** tab, rendered as a tile grid like the drive, because that is what they
are to the person looking at them.

**It stacks in one column rather than a `PanelGrid`:** invite form, then anything waiting for you,
then the connections list. Side by side, the invite form and the list read as two equal choices
when they are really a sequence — you invite someone, they appear in the list. The single column
also gives the fingerprint comparison in `ConnectionInvitation` the full width it deserves, instead
of squeezing two 24-character codes and their accept/decline buttons into half a modal.

**Every connection in the list is checked against its pin on every load**, not only while an
invitation is under review. `SharingScreen` runs `verifyConnection` on each accepted connection and
each invitation this account sent, through `Promise.allSettled` so one failed lookup cannot hide
another row's alarm. A row that fails shows the reason under it, and a changed key or account also
gets a *Do not send* badge. A lookup that fails outright shows nothing on the row; a send still
fails, because it runs the check again.

**`ShareItemDialog` does not check up front, and does not need to.** The refusal lives inside
`shareItem` and `shareItemById`, so no caller can skip it; the dialog only turns a
`ConnectionNotTrustedError` into `sendRefusal`'s sentence. `ConnectionInvitation` uses the same
check and disables *Accept* while it shows an alarm, so a changed fingerprint can never be accepted
into a new pin. See `lib/sharing/README.md` § Checking a connection against its pin.

### Shared reads every tile before it can draw one

A shared tile shows a real name — a filename, a note title, a secret's name — and none of those
reach the server in clear. `describeReceived` derives the connection key, unwraps the item's DEK and
opens the payload for **each** arrival, which is why the screen has a loading state where the other
grids do not. A share whose connection is gone, or whose payload will not open, renders as
*Unreadable* and is not clickable rather than disappearing.

**A tile carries a name and a body, and they are not the same string.** `describeReceived` takes a
view function per text type rather than reading the payload itself, because what a payload *is* is
app knowledge, not sharing knowledge: `sharedSecretView` in `lib/app/sharing.ts` names the tile
after the secret's `name` and shows only its `value`, while `sharedNoteView` titles the tile from
the first line and shows the whole note. Returning the raw plaintext for both is the bug this split
fixes — a secret's plaintext is a JSON envelope, and the reader was shown
`{"name":…,"value":…}` where the value belonged.

### Sharing is a per-item control, not a selection-mode one

Every item that can be sent carries its own share affordance: a `SharingIcon` button on each drive,
note and document tile, and an icon-and-label button on each vault row. All four open the same
`ShareItemDialog`.

**It used to live in the selection toolbar, disabled unless exactly one item was selected**, which
put a single-item action behind a multi-select gesture and hid it from anyone who never pressed
*Select*. Selection mode still exists for deleting in bulk; sharing is not a bulk action and no
longer pretends to be. A tile whose payload did not decrypt cannot be shared — its DEK is what would
travel, and sending one that does not open just reproduces the failure on the far side.

**`ShareItemDialog` is a `Modal`, not a card on the screen behind it.** It used to render inline,
which pushed the grid or table down the moment you pressed share and left you reading a form in the
middle of a list. It is a focused, one-item task with an obvious end, which is exactly what the
modal primitive is for — it traps focus, closes on Escape or backdrop, and restores focus to the
share button you came from. It carries no explicit *Close* button because the modal header has one.

**The dialog states no rules.** One sentence covers sharing's consequences — *anything you send can
be copied by the person you send it to* — and it is read once on the invitation card in the Sharing
settings tab, where you decide to trust someone, not reprinted on every send where it becomes
furniture nobody reads. The two further rules that once appeared here (deleting your original breaks
their copy; removing a share cannot un-read it) were cut on 2026-09-12 for the same reason; see
`lib/sharing/README.md` § What the UI must never claim for what still holds regardless.
