# `app`

Milestone 5 — the product logic behind the shell. Everything here is framework-free `.ts` so it
can be unit-tested under the existing node-environment Vitest setup; the React components in
[`src/components`](../../components/README.md) are thin renderers over it.

| Module | What it owns |
| --- | --- |
| `onboarding.ts` | The onboarding state machine, PIN/mnemonic validation copy, the recovery kit step |
| `unlock.ts` | The unlock screen's sentences: attempts left, a forgotten browser, offline, rate limited |
| `second-factor.ts` | Paranoid mode's copy, and when to suggest waiting after refused account PINs |
| `devices.ts` | The devices screen's rows and copy |
| `sign-out.ts` | Lock and *Remove this browser* |
| `transfers.ts` | Uploads in flight, including a queue paused by `429` |
| `vault.ts` | The vault index view model, received-ciphertext integrity check, and the local secret name/value format |
| `passwords.ts` | The credential payload format (`site`, `username`, `password`, optional `note`), the row builder sorted by site then username, and the host-only site label |
| `notes.ts` | The notes file-grid view model — title, thumbnail, selection, character budget and autosave state |
| `folders.ts` | The folder copy and view models: the tab strip (`buildFolderTabs`, `itemsInTab`, tab naming and deleting) and the documents/drive tree (folder naming, what a delete takes, why a move was refused) |
| `icon-size.ts` | The four-step size scale shared by all three grids, the columns each draws, and the remembered choice per screen |
| `modal.ts` | A modal's keyboard contract, backdrop dismissal and scroll-lock counting |
| `shell.ts` | `accountInitial`, the sidebar avatar's letter |
| `username.ts` | The rename screen's validation and the copy that has to be on it |
| `private-text.ts` | The attributes that stop the browser shipping typed text to a spelling, grammar or translation service |
| `clipboard.ts` | Copying a secret, and clearing it off the clipboard afterwards |
| `secret-field.ts` | Masking a secret or a PIN while it is typed, without turning it into a password field |

## Plaintext the browser would otherwise send away

The app's own code never sends plaintext anywhere, and no dependency makes a request of its own
(checked 2026-09-13, source and built bundle). **The browser does**, through features that run on
any editable text unless the page opts out:

| Feature | Where the text goes | What stops it |
| --- | --- | --- |
| Chrome *Enhanced spell check* | Google | `spellcheck="false"` |
| Edge *Microsoft Editor* | Microsoft | `spellcheck="false"` |
| Grammarly and similar extensions | The extension's vendor | `data-gramm`, `data-gramm_editor`, `data-enable-grammarly` |
| Page translation | Google | `translate="no"` on `<html>` and `<meta name="google" content="notranslate">` |
| Mobile autocorrect and capitalisation | The keyboard's learning model | `autocorrect="off"`, `autocapitalize="off"` |

`PRIVATE_TEXT_PROPS` is the React spelling of that set and `PRIVATE_TEXT_ATTRIBUTES` the DOM one,
derived from it so the two cannot drift — TipTap's `editorProps.attributes` takes raw attribute
names. `Field` and `TextArea` apply the props **by default**, before the caller's own, so every
field built from them is covered and a field that genuinely wants spellcheck has to say so. A raw
`<input>`, `<textarea>` or `contentEditable` must spread them itself: the note surface, the
document body, the document title and the link address all do.

Spellcheck is off on the note and document editors, where users would normally expect it. That is
the trade: the only spellcheck a page can keep while turning off the remote one is the browser's
basic local dictionary, and a page cannot choose which one the user has enabled.

**The tab title is not an input and leaks the same way.** It lands in browser history, which Chrome
and Edge sync to their clouds, so `/docs/[id]` keeps the layout's fixed title rather than the
document's name.

## Copying a secret clears the clipboard

The clipboard is not local to the device: Windows Cloud Clipboard, Apple's Universal Clipboard and
every clipboard manager copy it elsewhere. `createSensitiveClipboard` writes the value, then writes
an empty string after `CLIPBOARD_CLEAR_AFTER_MS` (30 s). `CopyButton` uses one instance for the
whole tab and says so in its confirmation label.

- **A page may only write the clipboard while it has focus.** A tab in the background at the
  deadline cannot clear it, so the clear waits for the next `focus` event and runs then.
- **The page cannot read the clipboard without a permission prompt**, so it cannot check the value
  is still its own. Clearing may therefore wipe something the user copied elsewhere in the last
  30 seconds. That is accepted: leaving a secret on a synced clipboard is the worse failure.
- **A second copy restarts the window** and cancels any clear still waiting for focus, so an older
  deadline never empties the newer value.
- **The recovery phrase has no copy button.** The kit step shows it and downloads the PDF; the
  phrase is the whole account, and the one place it should not pass through is a clipboard.

## A secret is masked while it is typed

The vault's *Value* field hides what is typed by default: the value is not readable over a shoulder,
in a screen share or in a recording. A show/hide button next to it reveals the value, and the field
hides again after each secret is added.

**It is not `type="password"`, on purpose.** A password input is what makes the browser offer to
save the value in its password manager — Google Password Manager, iCloud Keychain, Firefox's — and
those sync to their vendors' clouds. Saving a vault secret there moves it out of Cryple's
encryption and into someone else's, which is the class of leak this client exists to avoid.

`secretInputAttributes(masked, cssMasking)` decides the attributes:

| State | Input | Why |
| --- | --- | --- |
| masked, CSS masking available | `type="text"` + `-webkit-text-security: disc` | Drawn as dots, and a text field to every password-saving heuristic |
| masked, CSS masking unavailable | `type="password"` | The only way left to mask. Only browsers older than Firefox 114 land here |
| revealed | `type="text"` | |

- **Every state carries** `autocomplete="off"` and the ignore attributes 1Password (`data-1p-ignore`),
  LastPass (`data-lpignore`), Bitwarden (`data-bwignore`) and Dashlane-style detectors
  (`data-form-type="other"`) honour. Browsers' own managers ignore `autocomplete="off"` on password
  inputs, which is why the text input matters more than any attribute.
- **Browser support** for `-webkit-text-security` (MDN browser-compat-data, checked 2026-09-13):
  Chrome and Chrome Android from the start, Edge 79, Safari 3, Safari iOS 1, and **Firefox and
  Firefox Android 114**. It is non-standard but not deprecated.
- **`supportsTextSecurity` asks `CSS.supports('-webkit-text-security', 'disc')`** once per field, and
  anything that throws or has no `CSS` object counts as unsupported — so the fallback masks rather
  than shows.
- **The masking class is a Tailwind arbitrary property**, `[-webkit-text-security:disc]`, because
  React's `CSSProperties` has no key for the vendor property.
- **Masking hides the characters and nothing else.** The value can still be selected and copied out
  of the field by whoever is typing it, and the list's own *Show values* toggle is separate.

## A PIN is not a password the browser may keep

`pinInputAttributes(length, cssMasking)` is the section above applied to every PIN entry — sign-up,
enrolment, unlock, enabling and rotating the account PIN — plus `inputMode="numeric"` and
`maxLength`. The component is `PinField`; **a PIN must never be typed into a plain `Field` with
`type="password"`**.

The reason is sharper here than it is for a vault value. A `type="password"` input is what makes
Chrome offer *Save password?*, and `autocomplete="off"` does not stop it — browsers' own managers
ignore that attribute on password inputs, which is exactly why the masked **text** input is the
mechanism and the attributes are only the belt. What a saved PIN costs:

- **It leaves Cryple.** The device PIN is the second thing standing between a stolen browser
  profile and the keyrings. Saved, it syncs to a vendor cloud and the seal is only as good as that
  account.
- **An autofilled wrong PIN is spent silently.** The device registration allows
  `OPRF_DEVICE_MAX_ATTEMPTS` evaluations and is then deleted, so a manager filling a stale value on
  each visit can walk an account off its own browser, and the fix is to type the recovery phrase.

## Onboarding

The flow is a reducer, not scattered `useState` — every guard that matters is testable without
rendering. Two branches, chosen by a tab rather than by two buttons:

```
origin ─┬─ Sign up ─┐
        └─ Sign in ─┴→ pin → enrolling ─┬─ Sign up → recovery-kit → done
                                        └─ Sign in ─────────────────→ done
```

The sign-in tab takes the phrase **on the tab itself**, so `origin` and `import` are one screen: a
tab that offers only a Continue button is a step that asks nothing.

### The mode is chosen before the PIN, not after

On the sign-up PIN step the Standard/Paranoid fieldset renders **above** the two PIN fields, and
`MODE_COPY.oneWayDoor` appears the moment Paranoid is selected. The order is the point
([Task 105](../../../../tasks-closed.md#task-105)): a PIN typed before reading what it commits you to was
not a choice. Paranoid has no way back and no reset, so the sentence that says a forgotten account
PIN ends the account for ever has to be on screen before the field is filled, not under it.

Both modes carry a `summary` and a `tradeoff`, because a choice presented with only the safe option
explained is not one either. `MODE_COPY` is asserted never to contain the words *disable*, *remove
the PIN* or *turn off* — the mode change is one-way and the copy must never imply otherwise.

### The recovery kit comes after enrolment

Sign-up generates the phrase and goes straight to the PIN. The phrase is first shown on the
`recovery-kit` step, next to the button that downloads the PDF built by
[`lib/recovery-kit`](../recovery-kit/README.md). The step comes **after** `POST /sign-up` because
the kit prints the username, and the server picks that name during sign-up.

- `enrolled` carries the username the server assigned. It also clears `pin` from the state: the
  keystore and the local vault already have what they need, and the kit step must never have a PIN
  in reach.
- `canEnterVault` is true only on the kit step after `recovery-kit-saved`, so the vault stays shut
  until the kit has been downloaded at least once. Downloading again is always allowed.
- There is no way back from the kit step: the account already exists, and going back to the PIN
  would enrol it a second time.
- Signing in with an existing phrase skips the step — the user already holds the phrase.
- The phrase can be revealed but not copied — see
  [Copying a secret clears the clipboard](#copying-a-secret-clears-the-clipboard).

`createAccount` does not move the app to `ready`. It returns the username, and `enterVault`
opens the vault from the kit step's Continue. Adding a browser with an existing phrase goes
straight in. If the 15-minute idle lock fires while the kit step is open, the session
locks as it would anywhere else, and the kit can no longer be offered.

### Every browser has a PIN, and the mode is a separate choice

The PIN step always sets **this browser's PIN**: it unlocks the device record
([`lib/device`](../device/README.md)) through the server's OPRF, which rations every guess. The
same step presents **Standard and Paranoid as a real choice**. Paranoid turns the same six digits
into the **account PIN** too, which the phrase then needs for every root action. The one-way,
no-reset warning (`MODE_COPY.oneWayDoor`) is shown **before** the account is created, and
Standard is described as a deliberate choice, not a lesser one.

Signing in on a new browser is adding it with the phrase (`ENROL_STEP_COPY`): the copy says the
browser does not keep the phrase (`PHRASE_NOT_KEPT`), that the phrase is in the page's memory
while typed, and offers *I lost my other devices* with what it does and does not do.

## Unlocking — `unlock.ts`

| Outcome | Sentence |
| --- | --- |
| Wrong PIN | `wrongPinMessage(attemptsRemaining)`: the attempts left, and that at zero the browser forgets the account and the phrase is needed |
| Registration gone (`404`) | `UNLOCK_COPY.forgotten`: too many wrong PINs, or removed from another device. The PIN is never asked for again |
| Server unreachable | `UNLOCK_COPY.offline`: not a PIN error, and no attempt was used |
| `429` | `rateLimitMessage`: when to try again, and that it is not about the account |

## Paranoid — `second-factor.ts`

A throttled account PIN gives no error: the evaluation still answers, the proof is simply wrong
and the action is refused. `accountPinRefusal(n)` suggests waiting a few minutes after two
refusals for a PIN the user is sure of, and nothing ever auto-retries: every evaluation is an
attempt. `checkUpgrade` validates the phrase before the PIN, because a wrong phrase makes the
PIN useless.

## Leaving a session

| | What happens | Coming back needs |
| --- | --- | --- |
| **Lock** | The keystore forgets its keys; the device stays | the PIN |
| **Remove this browser** | A self `device-remove`: the server stops accepting this device at once, and the record is deleted | the recovery phrase |

Only removal confirms, and the confirmation says the vault is **untouched**, because "remove this
browser" reads like account deletion and is not.

## Uploads paused by the creation budget

`POST /files` is limited per account. A `429` there **pauses** the upload
(`creationPauseSeconds`, `pauseTransfer`) for `Retry-After` seconds and then carries on, with a
tile that says nothing failed. It is never marked failed, and nothing is abandoned, because
nothing was created.

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

**"No other party parses it" includes the recipient of a share, which is why it is decoded there
too.** A secret sent to another account arrives as that same JSON envelope, and `lib/sharing` is
deliberately ignorant of its shape. `sharedSecretView` in `sharing.ts` is the adapter: it decodes
the envelope into the `{ name, body }` pair the Shared grid draws, so the tile is named after the
secret and the reader is shown its **value** rather than the envelope around it. `sharedNoteView`
is the same seam for a note, where the plaintext *is* the body and the title comes from
`noteTitle`. A malformed envelope falls back to `UNREADABLE_SECRET_NAME` and the raw text — all
there is to show — rather than throwing, because `describeReceived` must never throw.

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
survives a reload is [the drive's encrypted cache](../files/README.md#the-cache-holds-ciphertext-and-that-is-the-whole-design), and it belongs on disk, encrypted.

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
