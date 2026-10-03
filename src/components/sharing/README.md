# `components/sharing`

Invitations and fingerprints, nicknames, sending, and what arrived, with *Copy to my own account*.
Everything they decide is in [`lib/sharing`](../../lib/sharing/README.md).

| File | Role |
| --- | --- |
| `SharingScreen.tsx` | The Settings **Sharing** tab — invite, review, connect, disconnect, each connection checked against its pin |
| `ConnectionInvitation.tsx` | One invitation under review: the two fingerprints to compare, accept and decline |
| `ShareItemDialog.tsx` | Sending one item to a connection, from the item's own share control, optionally into one of that friendship's folders |
| `SharedScreen.tsx` | The **Shared** sidebar section: one folder per friendship, and inside each what went both ways, in the folders both people made |
| `useSharedFolderTree.ts` | One friendship's folder manifest as the `FolderTreeState` the folder components draw |

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

**Sending can file it.** Once a connection is chosen, `ShareItemDialog` offers that friendship's
folders under *Put it in*; the share is created and then placed in the folder, so it arrives
already organised on both sides. A device without `sharing` sees no folders to choose.

**`ShareItemDialog` does not check up front, and does not need to.** The refusal lives inside
`shareItem` and `shareItemById`, so no caller can skip it; the dialog only turns a
`ConnectionNotTrustedError` into `sendRefusal`'s sentence. `ConnectionInvitation` uses the same
check and disables *Accept* while it shows an alarm, so a changed fingerprint can never be accepted
into a new pin. See `lib/sharing/README.md` § Checking a connection against its pin.

### One folder per friendship

[Task 133](../../../../tasks.md#task-133) D10. The Shared screen opens on **one folder per accepted
connection**, named after the other person's current username — each side sees the other's name.
A pending invitation has none. Opening one shows that friendship's space:

- **Both directions, together.** What they sent you and what you sent them are in the same place,
  because it is the same relationship. A tile you sent says *Sent by you*, and its card offers
  _Download_ but not _Copy to my own account_ — it is already yours.
- **Either of you organises it.** *New folder* in the path bar, up to 8 levels below the
  friendship; rename in the folder's details panel; drag a tile onto a folder or a path segment, or
  use *Move to…* in its card. Neither side owns a folder: the other person can file into it,
  rename it or delete it, and sees what you filed where.
- **Deleting a folder here removes the grouping only** (D8). The confirmation says so, and what was
  in it falls to the top of the friendship, still shared. A limited device may do it, because it
  destroys nothing — unlike a folder delete in the Drive or Documents.
- **The path starts at *Shared*.** `FolderPath` takes `ancestors`, so the friendship is the root of
  its own tree and *Shared* above it goes back to the list of friendships.
- **A device without the `sharing` scope** cannot open the folders (D9): it shows the friendship
  folders, and inside each everything that was shared with it, flat, with a line saying why.
- **A manifest that fails validation** is reported in place of the folders, with *Reset the
  folders*, which empties them for both people and unshares nothing. Everything is listed at the
  top until then.

`useSharedFolderTree` adapts [`lib/sharing/folders.ts`](../../lib/sharing/README.md#the-folders-of-a-friendship--foldersts)
to the `FolderTreeState` the Drive's components take, with `deletes: 'grouping'`, so the path bar,
folder tiles, details panel and *Move to…* are the Drive's own and behave the same.

### A received image or video opens in the viewer

A shared file whose type the browser can show opens in the
[media viewer](../modal/README.md#the-media-viewer) as well as selecting it, so its card, with *Copy
to my account*, is there when the viewer closes. The viewer walks every received image and video.
It needs the file's type, so `describeReceived` now returns `mime` beside `kind` from the manifest it
already opens. Its download is the card's *Download*.

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
