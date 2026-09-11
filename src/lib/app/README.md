# `app`

Milestone 5 — the product logic behind the shell. Everything here is framework-free `.ts` so it
can be unit-tested under the existing node-environment Vitest setup; the React components in
[`src/components`](../../components/README.md) are thin renderers over it.

| Module | What it owns |
| --- | --- |
| `onboarding.ts` | The onboarding state machine, PIN/mnemonic validation copy, backup verification |
| `boot.ts` | Sign-in when the mode is not known yet, and account enrolment |
| `mode-hint.ts` | The locally remembered Standard/Paranoid hint |
| `vault.ts` | The vault index view model, received-ciphertext integrity check, and the local secret name/value format |
| `notes.ts` | The notes file-grid view model — title, thumbnail, selection, character budget and autosave state |
| `icon-size.ts` | The four-step size scale shared by all three grids, the columns each draws, and the remembered choice per screen |
| `modal.ts` | A modal's keyboard contract, backdrop dismissal and scroll-lock counting |
| `shell.ts` | `accountInitial`, the sidebar avatar's letter |
| `username.ts` | The rename screen's validation and the copy that has to be on it |

## Onboarding

The flow is a reducer, not scattered `useState` — every guard that matters is testable without
rendering. Two branches, chosen by a tab rather than by two buttons:

```
origin ─┬─ Sign up → backup → verify ─┐
        └─ Sign in ─────────────────→ ┴→ pin → enrolling → done
```

The sign-in tab takes the phrase **on the tab itself**, so `origin` and `import` are one screen: a
tab that offers only a Continue button is a step that asks nothing.

### Every account has a PIN

`mode` and `pin` used to be two steps, and Standard skipped the second one entirely. That left a
Standard account with **no local vault**, so the phrase had to be retyped on every reload and after
every idle timeout, and Lock could not be offered at all — there was nothing to lock back to.

Now the PIN is always set and the two steps are one. The checkbox on it decides one thing only:
whether that same PIN is **also** the server's second factor.

| | Standard | Paranoid |
| --- | --- | --- |
| Encrypts the local phrase | yes | yes |
| Locks the app | yes | yes |
| Required to sign in | no | yes |

This restores `auth/two-factor-PIN.md` § Local Seed Encryption, which specifies the local seed
vault for **both** modes; the client had deliberately diverged from it, and that divergence is what
produced the retype-your-phrase behaviour.

**Deriving the token is not sending it.** `session.unlock(pin)` always derives a
`Server_Auth_Token`, in both modes — it is only *sent* when the account is Paranoid, which
`signInWithModeDetection` decides from `has_password`. A Standard account holding a derived token it
never transmits is correct rather than a leak waiting to happen.

## Signing in without knowing the mode

Sending the `password` on a Standard account fails exactly as hard as omitting it on a Paranoid
one, and both return the same anti-enumeration `404`. Since the mode lives in `has_password` on
`GET /users/me`, which needs a token, there is a bootstrap problem on a fresh unlock.

`signInWithModeDetection` resolves it: try the locally hinted mode, and on an `AuthRejectedError`
try the other. **Each attempt builds its own `{challenge, timestamp, signature}`** — the challenge
is consumed before the signature is checked, so the second attempt cannot reuse the first's.
A test asserts the two challenges differ.

Two things it deliberately does **not** do:

- It does not treat the hint as the answer. After a successful sign-in it reads `has_password`
  from `/users/me` and reports that — the hint is only an ordering optimisation, and
  `writeModeHint` corrects it from the authoritative value.
- It does not swallow real failures. Only `AuthRejectedError` triggers the fallback; a `500` or a
  transport error propagates, so an outage is never mis-rendered as "wrong mode". A test pins this.

The hint in `localStorage` is not a secret and not a credential — it is one of `standard` /
`paranoid`, and an unrecognised value reads as absent.

## Turning on the second factor

`sessionExits` can only offer a PIN-locked session to an account that has a PIN, so the Security
screen is where a Standard account gets one — `POST /users/second-factor`, the API's one supported
mode transition ([`lib/users`](../users/README.md)).

`checkUpgrade` validates the **phrase before the PIN**: a wrong phrase makes the PIN useless, and
failing on the cheap half first is the better message. The copy reuses `MODE_COPY.oneWayDoor`
verbatim rather than paraphrasing it — the one-way-door warning must read identically wherever it
appears, and a test pins that.

Why the screen asks for the recovery phrase at all: a Standard account keeps nothing on the device,
so the upgrade has to create the local vault, and that needs the phrase. The keystore does not
retain it ([`lib/session` § Never](../session/README.md)), so it is asked for. It is checked
against the signed-in `user_address` **before** anything is sent — wrapping the wrong seed under
the right PIN would produce a vault that unlocks into a different account.

## Leaving a session

There is no revocation endpoint, so ending a session is purely local
([`lib/auth` § Sign-out](../auth/README.md)). The only real choice is **what the device keeps**,
and `sessionExits(deviceRemembersPhrase)` is that choice as data:

| | Keeps the local vault | Coming back needs |
| --- | --- | --- |
| **Lock** | yes | the PIN |
| **Log out** | no — the vault is wiped | the recovery phrase |

- **Lock is offered only when there is something to lock.** A Standard account stores nothing on
  the device, so locking and logging out would be the same action under two names; that mode gets
  one button. `hasSeedVault()` is the test, not `paranoid` — they agree today, but the vault is the
  thing actually being kept.
- **Only the erasing log-out confirms.** Wiping the device copy is worth a second look; ending a
  session that stored nothing is not, and a confirmation there would train the reflex that makes
  the real one useless.
- The confirmation says the vault itself is **untouched**, because "log out and
  erase this device" reads like account deletion and is not. Losing the local copy costs one
  re-entry of the phrase.
- Both exits run through the provider's `lock` / `logOut`; `logOut` is also what the `Unlock`
  screen's "Log out of this device" and post-wipe "Start over" buttons call — one concept, three
  entry points, no second implementation.

## The vault index

`buildVaultIndex` renders the unpaginated `GET /secrets?fields=meta` listing, newest first.

`checkIntegrity` **hashes the ciphertext you actually received** and compares it to
`ciphertext_sha256` rather than trusting the reported digest — a server-reported hash of
server-held bytes proves nothing.

`buildVaultRows` is what the list screen renders. It takes full `SecretRecord`s each paired with
its decrypted plaintext — the name is inside the payload, so a list showing names has to open
every item — and returns rows sorted newest first. A missing or unparseable plaintext becomes a
row named `UNREADABLE_SECRET_NAME` with `readable: false` rather than an exception, so one blob
written by another client cannot blank the whole vault; the caller decides what such a row may
do (this UI offers Delete but not Copy). Row size is measured from the ciphertext **received**,
matching `checkIntegrity`'s stance rather than trusting `ciphertext_bytes`.

Item bodies used to be unopenable — `unwrapDek` rejected with `KekNotSpecifiedError` until
Decision A landed — and `VAULT_SEALED_NOTICE` / `isVaultSealed` existed so the UI said so rather
than showing a crash. Both were removed once the seam stopped throwing; see
[`lib/secrets`](../secrets/README.md) for the vault KEK that replaced the stub.

### The secret name/value format

The wire contract has no `name` field on a secret — only opaque `ciphertext`. `SecretPayload`
(`{ name, value }`) is a **client-local convention** encoded as JSON before the plaintext ever
reaches `createSecret`: it never
reaches the server and no other party parses it.

`decodeSecretPayload` rejects anything that isn't `{ name: string, value: string }` with
`MalformedSecretPayloadError` rather than rendering a garbled value — an item this vault UI
didn't write (or a future format change) fails loudly instead of showing the wrong field as a
name or a value. Both directions round-trip losslessly by construction; there is no normalisation
to lose.

## The notes file grid

`buildNoteTiles` is the notes counterpart of `buildVaultRows`: full `NoteRecord`s paired with
their decrypted plaintext, sorted newest first, and a note that would not decrypt becomes a tile
titled `UNREADABLE_NOTE_TITLE` with `readable: false` instead of an exception. Size is measured
from the ciphertext **received**, for the same reason `buildVaultRows` does it.

### A note has no title field, and does not need one

Unlike a secret, a note is stored as **plain text with no JSON wrapper** — since the editor gained
formatting it is a small markdown subset defined in
[`lib/note-format`](../note-format/README.md), but still one plain string, and a note containing no
formatting is byte-for-byte what the user typed. There is no
`{ name, value }` convention here and there should not be one:

- `noteTitle` names the file after its **first non-empty line**, the way Apple Notes and most
  OS note apps do. Nothing to parse means nothing to reject, so a note written by any other
  client still opens and still gets a sensible name.
- Since the editor became WYSIWYG, everything here reads the note through
  [`lib/note-format`](../note-format/README.md) rather than the raw string: the name is the first
  line's **plain text** (`# Letter to Ana` → `Letter to Ana`), and a line whose only content was a
  marker is skipped rather than becoming a blank name. The format's shape did not change — a note
  with no formatting still reads exactly as before.
- `isNoteEmpty` likewise asks whether the note *looks* empty, not whether the string is. A
  document of nothing but empty list lines is visibly blank, and treating it as content would
  spend a `PUT` every two seconds on a note with nothing in it.
- Both keep the 5000-character limit honest — it counts what the user can see, never the markers.
  A JSON envelope would have spent part of that visible budget on punctuation and escaping,
  worst on exactly the notes closest to the limit.
- `noteThumbnail` returns the content itself, line breaks preserved, collapsing runs of three or
  more blank lines so a miniature is not mostly whitespace, and truncating at
  `NOTE_THUMBNAIL_MAX_CHARACTERS`. The tile renders real text rather than a generic file icon.
  Structure survives as glyphs (`•`, `☐`, `☑`) rather than as raw markup — a miniature showing
  `- [x] flights` would be advertising syntax instead of content.

Both truncate on **code points**, not UTF-16 units, so an emoji cannot be cut in half.

### Selecting notes for a batch delete

`toggleNoteSelection` is an ordinary immutable toggle. `retainSelectable(selected, present)` is
the one worth explaining: it intersects the selection with the ids still in the list, and the
list screen runs it on **every reload**.

Without it, an id can outlive the note it points at — deleted in another tab, or left over from
a failed batch — and stay checked in a UI that no longer draws it. The next "Delete (3)" would
then be signed over an id the user cannot see. `note-delete` binds the id it signs, so this is
not a security hole; it is a correctness and honesty one, and pruning on reload is cheaper than
reasoning about when it matters.

`batchDeleteSummary` returns `string | undefined` — **`undefined` when `deleted === requested`**.
Silence is the right report for a delete that worked: the notes are visibly gone.

It speaks only to a shortfall, and it calls that shortfall **"already gone", never "try again"**.
`DELETE /notes` scopes its `WHERE` to the owner in SQL, so an id that does not match is an id
that is no longer there — deleted from another device, most likely. Telling the user to retry
would be telling them to redo something that cannot succeed and does not need to.
`batchDeleteConfirmation` carries the consequence the server performs but never reports: that
deleting a note also removes it from anyone set to inherit it.

## Uploads outlive the screen that started them

`transfers.ts` is a tiny subscribable store: the drive's in-flight uploads, keyed by their file id,
read through `useSyncExternalStore`.

**It is not there for tidiness.** `AppShell` renders only the active section, so opening Notes
unmounts the drive. When this state lived in the component, the upload carried on — the promise does
not care that its caller is gone — but its progress died with the component, and returning to the
drive showed a file with no sign that anything was happening. The bug that made this necessary was
reported that way exactly: *"I go to notes and go back to drive, the animation doesn't show up
anymore."*

Three things it has to get right, and each has a test:

- **The snapshot is a stable reference** until something actually changes. `useSyncExternalStore`
  compares snapshots by identity and will loop forever on a getter that builds a fresh array.
- **A dropped transfer cannot be resurrected.** A late `advanceTransfer` or `failTransfer` for a key
  that is gone does nothing, so a progress callback that lands after a dismissal does not put the
  notice back on screen.
- **A failure stays in the list.** Only `dropTransfer` removes anything, and for a failure that is
  the user's dismissal — the one report nobody else will repeat.

Nothing here knows about React, and nothing about it is drive-specific except its use: it holds what
a screen must not own, which is any work that continues after the screen is gone.

## The storage reading, and why two numbers

`usage.ts` holds the account's last `GET /files/usage`, shared the same way transfers are: the
sidebar's meter and the drive both read it, and whoever fetches a reading publishes it. It skips the
notification when a reading says exactly what the last one did, so a poll that finds nothing new
does not repaint anything.

`storageBar` in `files.ts` turns it into what a bar draws, and the whole reason it is worth testing
is that **the endpoint returns two sums and only one of them belongs in the fill**:

- `stored_bytes` is `r2_state = 'ok'` — files that exist. This is `percent`, the solid part.
- `used_bytes` also counts `pending` rows, because that is what the quota is checked against before
  any upload URL is signed. The difference is `reservedPercent`, drawn behind the fill, and named by
  `uploadingSummary`.

Filling the bar with `used_bytes` would show space consumed by a file the user cannot open — an
upload that died at its first part looks identical to a stored one. Filling it with `stored_bytes`
and hiding the rest is the opposite failure: the account gets refused an upload while the bar shows
room. **`nearlyFull` keys on `used_bytes`**, because that is the number that will do the refusing.

## Previews outlive the grid that fetched them

`previews.ts` maps a thumbnail's file id to an object URL of its decrypted bytes. Each one costs a
`GET /files/{id}` plus an R2 fetch plus a decrypt, so the store exists to make that happen **once a
session** rather than once per visit to the drive — leaving and returning is a tab switch, and the
grid re-mounts every time.

It refuses to replace a url it already holds, which is what keeps two racing fetches from leaking
one of them, and it is the reason `forgetPreviews` revokes every url it hands back. Nothing calls
that yet; the urls live for the session, bounded by the number of images in the drive. A cache that
survives a reload is [109.8](../../../tasks/tasks.md#task-109-8), and it belongs on disk, encrypted.

### The save gate

**There is no Save button.** The editor autosaves `NOTE_AUTOSAVE_DELAY_MS` (2s) after the user
stops typing, so the two functions below are what stand in for a button the user can no longer
press — one deciding whether a write happens at all, the other telling them what happened.

`isNoteSavable(draft, saved)` is the write predicate: non-empty after trimming, different from
what is stored, and within the limit. It matters more under autosave than it did under a button.
The "different from what is stored" clause is what keeps a `PUT` from firing every two seconds
while a note sits open and untouched, and every `PUT` re-seals the entire note, so a no-op save
is not free.

`noteSaveState({ draft, saved, saving })` is the indicator, and it reports six states rather than
a boolean because autosave has to *narrate itself* — with no button to press, "nothing is
happening" and "your work is safe" look identical unless the UI says which:

| State | Label | When |
| --- | --- | --- |
| `blank` | *(nothing)* | A new note nobody has typed in — say nothing rather than "Unsaved" |
| `editing` | Unsaved changes | The 2s timer is counting down |
| `saving` | Saving… | A write is in flight |
| `saved` | Saved | The draft matches what was persisted |
| `over-limit` | Too long to save | Past 5000 characters |
| `emptied` | Nothing to save — use Delete to remove this note | An existing note cleared to nothing |

Two of those exist only because autosave made them reachable. **`emptied`** is the one a Save
button hid: clearing a stored note's text leaves it permanently unsavable, and without a
dedicated state the UI would sit on "Unsaved changes" forever, waiting for a save that can never
come. **`over-limit` deliberately outranks `saving`** — an in-flight write is not the thing the
user has to act on.

A test pins `isNoteSavable(draft, saved) === (noteSaveState(...) === 'editing')`, which is the
invariant that keeps the indicator honest: the one state that says work is outstanding is
exactly the one autosave is allowed to write in.

`noteCharactersLeft` deliberately **goes negative rather than clamping**, so the editor can say
how far over the limit a paste landed instead of just refusing.

## How large the three grids draw themselves

`icon-size.ts` is the whole zoom control as data. One vocabulary of four steps — `small`, `medium`,
`large`, `huge` — serves the drive, notes and documents, because they are three views of the same
idea and a user who has learned the control on one should not meet a different one on the next.

The steps carry **two geometries**, because the screens are not drawing the same kind of thing:

| | Drive | Notes and documents |
| --- | --- | --- |
| What is drawn | a square icon, `glyphPixels` | a page miniature filling the column |
| What the step sets | `tilePixels`, the column the icon sits in | `pagePixels`, the column, which *is* the page width |
| Sizes | 48 / 64 / 96 / 128 glyphs | 136 / 160 / 200 / 264 columns |

**A drive file has no page to draw, and a note is nothing but one.** That is the whole reason for
the split. The drive's glyph sizes are the ones a desktop file manager uses, and for its reason:
they are the sizes an SVG of a sheet of paper stays legible at. A note's miniature is its *content*,
so shrinking it to 48px would be showing the user nothing at all — the page grid starts at 136px,
where a title is still readable and the body is at least a texture.

- **The drive tile is always wider than the glyph it holds.** The name wraps under the icon over up
  to two lines, so a tile sized to the glyph would break every filename after four characters. A
  test pins the inequality rather than the two numbers. A page grid needs no such gap: the miniature
  *is* the column.
- **Every grid is `auto-fill`, not a column count.** Choosing a size chooses how big a thing is, and
  the row fits however many of them fit — a fixed `grid-cols-5` would make the small step draw five
  enormous gaps instead of twenty small tiles, which is the opposite of what was asked for.
- **`labelsTheGlyph` is false only at `small`.** The drive's extension badge is drawn inside a
  48-unit viewBox, so at 48px it renders around 6px tall — present, unreadable, and noise. The
  coloured band it sits on stays: the colour is the type signal at that size, exactly as it is on a
  desktop.
- **Stepping holds at the ends rather than wrapping**, because a `+` that jumps from the largest
  back to the smallest is a control nobody can aim.

### A miniature is a scale drawing, so its text scales too

The document miniature already expressed its margins as percentages — `12%` / `8.5%` is the 25.4mm
margin as a fraction of the page — so that it is a scale drawing of a sheet rather than a box with
arbitrary inset. Sizing the page broke the half of that which was still in fixed pixels: a 9px body
is right on a 200px page and absurd on a 264px one.

`miniatureTextPixels(size, share)` closes it. The shares are constants beside it —
`NOTE_MINIATURE_TEXT_SHARE`, `DOCUMENT_MINIATURE_TEXT_SHARE`, `DOCUMENT_MINIATURE_TITLE_SHARE` —
chosen so the `large` step reproduces exactly what shipped before the control existed: 9px note
body, 8px document body, 10px document title. Everything else follows from the ratio.

`MINIATURE_TEXT_FLOOR_PIXELS` stops the small step rounding text away to nothing. A test pins that
the document title stays larger than its body at **every** step, including the one where the floor
bites — that is the assertion that caught the small page being 120px, where both landed on 6.

### Remembered per screen, not once

Each grid has its own key — `cryple_drive_icon_size`, `cryple_notes_icon_size`,
`cryple_documents_icon_size` — and its own default: the drive opens at `medium`, the two page grids
at `large`, which is the size they were fixed at before. They are separate because the shapes are:
wanting dense file icons says nothing about wanting unreadable note previews, and one shared value
would make each screen's control quietly reach into the other two.

That needs the third exemption to the `no-restricted-globals` ban
([`AGENTS.md` § Commands](../../../AGENTS.md)), and the reason is narrow: the stored value is one of
four literal words naming how large a grid draws itself, read back through a guard that treats
anything unrecognised as no preference at all, and an unreadable or absent value costs nothing. It
is not key material and it is not content. Holding it in memory instead was the alternative —
`AppShell` renders one section at a time, so a module-level store would survive a tab switch — but
not a reload, and a size that resets every visit is the kind of small wrongness a user meets every
single time.

Reading it during render would desynchronise the server-rendered HTML from the first client paint,
so each screen starts at `defaultIconSize(grid)` and reads the stored value in an effect.

## A modal, minus the DOM

`modal.ts` holds the three decisions a dialog has to get right, so they are unit-tested rather
than only reachable by rendering one. `Modal` in [`ui.tsx`](../../components/README.md) is the
shell that wires them to real elements.

**`trapAction` is the whole keyboard contract as a decision table.** Escape closes; Tab returns
`pass` in the middle of the dialog, so the browser keeps owning tab order and the trap does not
re-implement it; and the only intercepted cases are the ones where focus would leave — wrapping
at either end, and pulling it back when it is already outside. A dialog with nothing tabbable
still swallows Tab (`hold`), because letting it through walks focus into the page behind, which a
screen reader then reads as though the modal were not there.

**`isBackdropDismissal` takes the press and the release, not just the click.** Checking the
release alone is the usual shortcut and it has a visible bug: select text inside the dialog, drag
past its edge, let go, and the dialog closes mid-selection.

**`scrollLockTransition` is reference-counted**, so a nested dialog closing cannot hand the page
back its scrollbar while an outer one is still open.


## Renaming the account

`username.ts` is the Security screen's username panel minus the DOM. `checkUsername(input,
current)` normalises first — lowercase and trim — then applies `USERNAME_PATTERN` from
[`lib/users`](../users/README.md), then refuses a claim on the name already displayed. The order
matters: normalising after validating would reject `PedroSilva`, which is the same claim as
`pedrosilva` and cannot be used against it.

**Two sentences on that screen are not optional, and a test pins each.**

- **A rename adds a name, it does not remove one.** Every name the account has ever held stays
  owned by it for ever — the server keeps the set because it *is* the uniqueness constraint, and
  it cannot be moved into the client's encrypted space like every other label. A user who renames
  to distance themselves from a name has not erased it, and this is the one place the product can
  say so.
- **The old name stops working.** Only the current name resolves, so a reference somebody wrote
  down before the rename stops arriving. That is deliberate: it is what buys the unlinkability
  between an old name and the account that now uses a new one.

Switching back is claiming the name again — there is no reclaim affordance, because there is no
reclaim call.

**No copy here may speculate about who holds a name that was refused.** The server answers a
collision identically whether the string is another account's current name or one it reserved, and
narrating a difference would undo the uniformity that stops the claim route being a rename oracle.
A test greps the whole copy object for *another account*, *someone else* and *taken by*.

## The shell's account chrome

`shell.ts` holds `accountInitial`, the letter in the sidebar avatar. It falls back to `?` for an
absent or blank username so the circle is never empty.

It once also held `ENCRYPTION_SUMMARY` and `sessionFingerprint`, for a banner above every screen
that restated the encryption guarantee and showed a shortened `user_address`. **The banner was
removed on 2026-09-09 as noise** — it said the same thing on every screen, next to screens whose
own copy already says it. Both helpers went with it rather than being left as dead exports; the
fingerprint's one non-obvious rule, if anything ever needs it again, was that it is **not**
prefixed `0x` — Cryple derives no secp256k1 key and has no EOA.
