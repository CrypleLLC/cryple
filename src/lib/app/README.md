# `app`

Milestone 5 — the product logic behind the shell. Everything here is framework-free `.ts` so it
can be unit-tested under the existing node-environment Vitest setup; the React components in
[`src/components`](../../components/README.md) are thin renderers over it.

| Module | What it owns |
| --- | --- |
| `onboarding.ts` | The onboarding state machine, PIN/mnemonic validation copy, backup verification |
| `boot.ts` | Sign-in when the mode is not known yet, and account enrolment |
| `mode-hint.ts` | The locally remembered Standard/Paranoid hint |
| `inbox.ts` | Merging the two guardian queues into one list |
| `vault.ts` | The vault index view model, received-ciphertext integrity check, and the local secret name/value format |
| `notes.ts` | The notes file-grid view model — title, thumbnail, selection, character budget and autosave state |
| `succession-view.ts` | Release status, vote audit and heir view models |
| `recovery-kit.ts` | The printable share-0 Recovery Kit |
| `label.ts` | The heir-label sealing seam (blocked, see below) |

## Onboarding

The flow is a reducer, not scattered `useState` — every guard that matters is testable without
rendering. Order:

```
origin → (backup → verify | import) → mode ─┬─ Standard ──────────→ enrolling → done
                                            └─ Paranoid → PIN ────→ enrolling → done
```

**The mode is chosen first, and only Paranoid reaches the PIN step.** Asking for a PIN before the
user knows what a PIN is *for* is the wrong order; and a Standard account has no PIN at all, so
asking for one is asking for something that is then thrown away.

`mode-chosen` therefore also clears any `pin` already entered — a user who picks Paranoid, types a
PIN, goes `back` and picks Standard must not enrol carrying it. `isReadyToEnroll` requires a PIN
only when `paranoid` is true, and a failed enrolment returns to whichever step the user last acted
on — `pin` for Paranoid, `mode` for Standard.

### Going back

`previousStep` is the reverse of the diagram above, and `back` walks it **one step at a time** —
it is not a reset. Reaching `origin` by pressing Back repeatedly is the only way to start over, and
that is the one transition that discards the phrase and the branch, because both are chosen there.

What each step back forgets is what that step chooses, and nothing more:

| Back onto | Forgets |
| --- | --- |
| `origin` | the phrase and the generate/import branch — the word count survives |
| `backup` / `verify` / `import` | nothing; the phrase is still needed to show or edit |
| `mode` | the mode **and** the PIN, since the PIN only exists because Paranoid was chosen |

`back` also clears `error`, so a rejection never follows the user onto a screen it did not come
from. `origin`, `enrolling` and `done` have no previous step: the first has nothing behind it, and
the other two are past the point of no return — `previousStep` returns `undefined` and `back` is a
no-op rather than a half-cancelled enrolment. The Back control renders once, below the step card,
driven by `canGoBack`; steps do not each carry their own.

`ImportStep` seeds its textarea from `state.mnemonic`, so stepping back onto it offers the phrase
for correction rather than an empty box.

**The consequence for Standard, which the copy states rather than hides:** the PIN is what
encrypts the local seed vault ([`pin`](../pin/README.md)), so with no PIN there is no vault and
nothing about the account is kept on the device. A Standard user re-enters the recovery phrase
whenever the session ends — every reload, and after the 15-minute idle lock. That is what
"your recovery phrase alone" costs, and `MODE_COPY.standard.tradeoff` says so on the choice screen
next to the Standard button, not afterwards.

This is a deliberate divergence from `auth/two-factor-PIN.md` § Local Seed Encryption (Both
Modes), which assumes a PIN exists in both modes. The alternative reading — keep a PIN in Standard
purely for storage — was built first and rejected as a product decision: a "Standard" mode that
still demands a PIN is not a second mode. Nothing on the wire changes either way; the spec section
describes a client-local convenience, and no server behaviour depends on it.

The generated phrase is rendered as **one sentence, not a numbered list** — that is how a phrase is
written down and how every other wallet renders it, and a numbered grid invites transcription into
a numbered list where a single misplaced word survives unnoticed. `mnemonicSentence` produces the
one string that is both shown and copied by the clipboard button, so the two can never diverge.

The reducer refuses to advance on a failed checksum or a rejected PIN, so a bad value cannot
reach a derivation. `MODE_COPY.oneWayDoor` states that Paranoid → Standard does not exist; a test
asserts the copy never contains the words "disable" or "remove the PIN", because
[no such affordance may ever exist](../../../AGENTS.md).

`buildVerificationChallenge` picks distinct word positions and takes an injectable `pick` so the
test is deterministic. `verifyBackup` is tolerant of case and whitespace — a user copying from
paper should not fail on capitalisation — but rejects a short answer list rather than passing on a
prefix match.

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
- The confirmation says the vault, guardians and heirs are **untouched**, because "log out and
  erase this device" reads like account deletion and is not. Losing the local copy costs one
  re-entry of the phrase.
- Both exits run through the provider's `lock` / `logOut`; `logOut` is also what the `Unlock`
  screen's "Log out of this device" and post-wipe "Start over" buttons call — one concept, three
  entry points, no second implementation.

## The guardian inbox

All three guardian queues — **pending guardianship invitations**, pending recovery sessions and
pending PIN resets — are one list, because to a guardian they are one job: somebody is asking for
something. `buildInbox` sorts **actionable first, then newest**, so the thing needing a response is
never below a completed one, and `INBOX_ACTION_LABELS` keeps the three verbs (`Accept`, `Approve`,
`Send my share`) distinct so a row's button says what it does.

- **Invitations come from `GET /recovery/guardianships`, not from a queue endpoint** — there is no
  `…/pending` route for them. Only `pending_invite` rows become items; `active` and `revoked` rows
  are not requests and are filtered out by the recovery domain's `pendingInvitations`.
- The item's `id` is the **invitation id**, which is what `guardian-accept` signs and what the
  `PATCH /recovery/guardians/{id}/accept` path takes — not the owner's id or username.
- **Accepting is a signed action, not a formality** — the JWT alone is not enough
  (`front-end-endpoints.md` § PATCH …/accept, changed 2026-07-29). It reveals the owner's
  `user_address` to the guardian and raises the owner's effective quorum, so a bearer token must
  not be able to forge the second leg of the handshake. The second factor demanded is the
  **guardian's own**, which `context.paranoid` already supplies.
- **There is no decline endpoint.** A guardian accepts or leaves it; only the owner can revoke.
  `GUARDIAN_INVITE_DETAIL` says so on the row rather than offering a button that cannot exist.
- A `contest_period` PIN reset is **informational, never a vote prompt**. Only `pending_quorum`
  rows accept a vote; the API answers `409` otherwise. `canVoteOn` from the recovery domain is the
  single source of that rule.
- An already-submitted recovery share stays visible, marked done, rather than vanishing. An
  accepted invitation does **not** — it stops being a request, so the row goes and a success notice
  takes its place.
- Recovery sessions carry a 30-minute `expires_at` and `hasExpired` gates the action. PIN resets
  and invitations have no expiry here — a reset's clock is the 48h contest period, and an
  invitation does not lapse.
- The poll interval is the recovery domain's `GUARDIAN_INBOX_POLL_INTERVAL_MS` (60s), not a new
  constant. There are no webhooks; polling faster buys nothing.

Not built: a standing "accounts you guard for" list. `GET /recovery/guardianships` carries the
`active` rows to render it, but it is a reference view rather than an inbox, and the inbox is what
Task 30 was about.

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
reaches `createSecret`, the same discipline as the Recovery Kit's `CRK1-` encoding: it never
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

## The Recovery Kit

Share 0 — the user's own copy of the Shamir share — needs a durable, retypeable form.
`encodeRecoveryKitShare` produces `CRK1-` followed by grouped uppercase hex with a 2-byte SHA-256
checksum; `decodeRecoveryKitShare` is tolerant of case, spaces and dashes and **rejects a
mistyped character instead of returning a wrong share**. A silently wrong share fails at
reconstruction, months later, which is exactly the failure mode the checksum removes.

> This encoding is a **local presentation format, not a protocol constant.** It never reaches the
> server, no other party parses it, and the share bytes inside it are the SSS library's own format
> (which *is* durable). The `CRK1` prefix is there so a future change is detectable rather than
> silently misparsed — the same discipline as the versioned blob layouts, applied to paper.

`renderRecoveryKit` states the k-of-n scheme, the guardians it was split among, and that Cryple
cannot reissue it.

**Sequencing note:** share 0 only exists once recovery setup runs, and setup needs guardians, so
the kit is surfaced from the Guardians screen rather than during first-run onboarding. Onboarding
covers phrase, PIN and mode; there is nothing to put in a kit before a guardian exists.

## The succession dashboard reads two statuses, not one

`GET /succession/status` answers with two different facts and `buildReleaseView`
keeps them apart. `status` is the **off-chain guardian countdown** and only ever
reads `monitoring` or `counting_down`. `chain.status` is the **contract's own
state**, and it is the only one that can say `released` — anything gating "can
this inheritance be opened" reads that one.

**Every timestamp inside `chain` is unix seconds; everything outside it is
RFC 3339.** The `chain` values are block timestamps the API copies rather than
reformats, so feeding one to a date parser expecting ISO 8601 yields
`Invalid Date`. `fromUnixSeconds` is the single conversion point, so no caller
picks the wrong parser.

**`chain.status: 'unknown'` is not a contract state.** It means the API could
not read its chain mirror — an infrastructure fault, not a fact about the
switch. It surfaces as `ReleaseView.chainUnavailable` so a screen can say
"retry" instead of "not set up", and it must never be treated as permission for
anything. `indexed` is `false` for both `unknown` and `unconfigured`, so branch
on `chain.status` when the difference matters.

`lastCheckIn` is therefore optional and has three renderings: a date, "not
configured on-chain" when the smart account has never been configured, and
"unavailable" during an outage.

## Choosing what an heir inherits

`inheritance.ts` is the model behind the "Set inheritance" modal. It is pure apart from one
loader, so the rules below are unit-tested rather than only reachable through a component.

### The list has to decrypt, because no title is on the wire

A vault item's title is not a field. A secret's name lives inside the `SecretPayload` JSON
([§ The secret name/value format](#the-secret-namevalue-format)), a note's title is the first
non-empty line of its plaintext ([§ A note has no title field](#a-note-has-no-title-field-and-does-not-need-one)),
and a document's title lives inside the CRDT. So building this list opens every item, exactly as
the Vault, Notes and Documents screens already do — `loadInheritanceCandidates` composes their
loaders rather than adding a fourth fetch path.

**An item that fails to open is listed and not selectable.** It keeps its place with an
"Unreadable …" title rather than vanishing, because a silently shorter list is how an owner
believes they left an heir something they did not. Assigning it would be worse still: the wrapped
DEK would be re-wrapped without ever being verified as openable, producing a share no heir can
use. `assignable: false` is the same fact under both readings.

A candidate carries its `wrappedDek`, which the field list in the task did not ask for. The load
already had it in hand, so the alternative is a second fetch per item at save time — and carrying
it makes the save a local computation, so a partial failure in Task 38 is only ever a failed
request, never a failed re-read.

### Sorted by type, then title — the same order the tree uses

Type order is `document, note, secret`, taken from `lib/succession`'s `ITEM_TYPES`, which is
`lib/vaultmerkle`'s leaf order. The list a person reads and the leaves that get hashed are then
in the same sequence, which is one fewer thing to hold in your head when reading an anchor pass
beside a modal. Titles compare case-insensitively and ties break on id, so the order is stable
across reloads.

### Nothing here unassigns

`itemsToAssign(candidates, selected, current)` returns **only** the checked items the heir does
not already hold. Three exclusions, and each has a reason worth keeping:

- **already held** — the wire upserts on `(beneficiary_id, item_id)`, so re-assigning is harmless
  but burns a PQXDH encapsulation to rewrite a share that is already correct;
- **not assignable** — see above, even when its key is passed in;
- **not checked** — an unchecked box means "not chosen in this pass", **never "revoke"**.

That last one is the load-bearing rule. The modal opens with every box clear (Task 38), so if an
unchecked box meant removal, the first save would strip an heir of everything they had been left.
Removal is a deliberate single-item action in the heir's tab, and there is deliberately no
function here that produces one.

## The blocked heir label

`registerBeneficiary` needs a non-empty `encrypted_label` — the owner's private note about an
heir, which the zero-knowledge rule says must be sealed on this device.

**There is no key specified to seal it with.** `label.ts` therefore ships the same shape as the
DEK seam: an interface plus `unspecifiedLabelSealer`, which rejects with
`LabelKeyNotSpecifiedError`. Naming an heir is disabled in the UI with `LABEL_SEALED_NOTICE`;
listing and removing existing heirs work normally.

Substituting an existing key here — the X25519 private key, the identity key, the
`Server_Auth_Token` — would be the exact invention `storage-plan.md` §3.1.1 forbids, and worse,
reusing a credential or an asymmetric secret as a symmetric wrapping key.

**Decision A's `Cryple-Key-v1|vault-kek` landed 2026-08-08, but it is not this key.** Its
ratified text in `crypto/ECDSA.md` § Step 5 scopes it to wrapping *other keys* — specifically
the per-item DEK in [`lib/secrets`](../secrets/README.md) — and states it "never encrypts
application data directly." A label is application data, not a key, so reusing the vault KEK
here would repeat the exact mistake this section warns against, just with a real key instead of
a borrowed one. This stays a distinct open item until the backend spec names a construction for
`encrypted_label` specifically; when it does, implement `LabelSealer` and delete the notice — no
call site changes.
