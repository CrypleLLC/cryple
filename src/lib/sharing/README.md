# `lib/sharing`

The client half of safe sharing: one PQXDH exchange per relationship, and every shared item's DEK
wrapped under the key that exchange established.

**The protocol was decided before this module existed** — [Task 102](../../../../tasks.md#task-102)
D1–D10. The wire contract is
[front-end-endpoints.md § 18](../../../front-end-endpoints.md#18-sharing-endpoints). Neither is
restated here.

## One exchange per relationship, not one per item

`sealConnectionKey` generates a fresh 32-byte **connection key** and PQXDH-wraps it to the
recipient's published keys under the `item-share` usage. Every share after that is
`wrapUnderConnection` — a plain AES-256-GCM wrap, 60 bytes for a 32-byte DEK instead of the
1181-byte PQXDH envelope. A thousand shared files cost 61 KB of wraps rather than 1.15 MB.

**Two rules make this safe, and neither is optional:**

- **The connection key is never persisted.** Store the blob; re-derive the key in memory each
  session. Written to disk it becomes an intermediate failure point whose blast radius is the whole
  relationship. Re-derived, the blast radius is the same as a per-item design, because compromising
  the seed opens everything either way.
- **A random 96-bit IV per wrap, never a counter.** One key now protects many messages, which is
  exactly where GCM IV discipline matters. `wrapUnderConnection` draws its own IV and there is no
  parameter to override it.

No forward secrecy is lost, because there was none: the recipient's keys are static and
seed-derived.

### Both sides need the key, and they open different blobs

The sender cannot open the blob they encapsulated to the recipient. So a connection carries **two**
ciphertexts and each side gets only the one it can open:

| Field | Who receives it | What opens it |
|---|---|---|
| `pqxdh_blob` | the recipient | their X25519 + ML-KEM secrets |
| `sender_wrapped_key` | the sender | their own vault KEK |

The server returns each field only to the party it belongs to. **This was missing from the original
design** and only surfaced when the client was written — D5 described establishing the key without
saying how the sender keeps it.

## The fingerprint, and what it is for

`keyFingerprint` is `SHA-256(x25519 ‖ mlkem)`, rendered as six uppercase groups of four
(`A1B2-C3D4-…`) so two people can read it to each other.

**This is the only part of safe sharing that cryptography does not hold up on its own.** A server
that hands the sender substituted keys and forwards the blob is caught automatically — the frozen
`info` binds both full `user_address` values and the recipient derives with their own, so acceptance
fails. What the fingerprint defends against is an **active** man-in-the-middle running two
connections and re-wrapping in flight, and it only works if a human actually compares it out of
band. Present it as a step, not a dismissible detail, and pin it: a fingerprint that changes later
is an alarm, not a refresh.

## Never re-resolve a username to repair a connection

A nickname stored in the vault can outlive the connection it pointed at — the counterparty deleted
their account, or removed the connection — and deleting an account **releases its usernames**
([Task 118](../../../../tasks.md#task-118)). Re-resolving a stored username to heal a broken
connection silently attaches to whoever holds that name now.

**A lost connection is a new invitation and a fresh fingerprint comparison. Never a repair.**

## What the UI must never claim

- **Re-sharing cannot be prevented.** Never claim it can. The honest answer is the explicit *Copy to
  my own account*, which re-encrypts under a **fresh** DEK — reusing the shared one would leave the
  original owner holding a key that opens the recipient's copy for ever. This is the one rule the UI
  states outright, as `reshareWarning` on the invitation card in the Sharing settings tab.

Two further facts hold and are **deliberately not surfaced** as of 2026-09-12, by the product
owner's decision after they were built and reviewed in the browser:

- **Deleting the original breaks the recipient.** That is the feature, not a bug.
- **Revocation is prospective.** Removing a share cuts off future reads through the API and nothing
  more; it cannot claw back a DEK the recipient's client already holds.

They were written as `deleteOriginalWarning` and `revokeWarning`, shown first inside the send
dialog and then moved to the invitation card; both strings and their copy tests are now deleted
rather than left unrendered, so nothing in the tree claims a disclosure the screen does not make.
**Not stating them is not licence to contradict them.** No copy anywhere may imply a share can be
un-read, or that a recipient keeps access after the original is deleted — the constraints are
[Task 102](../../../../tasks.md#task-102) D2 and D3 and they did not change. Re-adding the two
sentences is a one-line edit to `SHARING_COPY` plus a `<Notice>`; the reason they left is that a
warning reprinted at every step is one nobody reads.

## Reading what arrived

`openSharedFile` and `openSharedText` are the receiving half. Both need the **connection key**, and
re-deriving it needs the counterparty's full `user_address` — the frozen PQXDH `info` binds both
addresses and the recipient must rebuild the sender's side of it. `GET /connections` returns that
address on every row for exactly this reason; without it the recipient holds a wrapped DEK it
cannot open.

**A share is useless without its connection.** If the connection is gone — the counterparty deleted
their account, or either side disconnected — the item cannot be opened again, and the copy says so
and tells the reader to ask for a **new** invitation. Never silently re-resolve the username to
rebuild one.

## Both addresses are checked before the exchange, not after

`sealConnectionKey` and `openConnectionKey` refuse an address that is not 64 lowercase hex
characters, and say **which side** is wrong. This is not defensive padding — it closes a hole that
actually shipped.

`GET /users/{uuid}/public-keys` did not return `user_address` when the invitation flow was first
written, so `inviteByUsername` passed `undefined` into the `info` string and sealed under
`…|item-share|<sender>|undefined`. **Nothing failed at the time.** The invitation was created, the
recipient accepted, the share was sent — and the break only surfaced when the recipient tried to
derive, as a WebCrypto `OperationError` whose `message` is the empty string. A blank failure, one
step removed from its cause, on a blob that can never be opened again.

A connection sealed that way is **unrecoverable**: the key exchange cannot be reproduced, so nothing
sent through it can be read. The two sides have to disconnect and invite each other again. The UI
says exactly that rather than reporting a decryption error the user cannot act on.

**The general lesson: an `info` input that is silently `undefined` produces a key nobody can
reproduce, and the damage is only visible on the far side, later.** Validate every input to a KDF
context at the boundary where it enters.

## Where the two halves live in the UI

**The relationship and the arrivals are different things and sit in different places.** Inviting,
reviewing a fingerprint, connecting and disconnecting are account settings — they live in the
Settings modal. What people sent you is a **Shared** tab in the main sidebar, drawn as a tile grid
like the drive, because to the person looking at it that is what it is.

`describeReceived` is what makes that grid possible: for each arrival it derives the connection key,
unwraps the DEK and opens the payload far enough to get a name — a filename from the sealed
manifest, a note's title, a secret's name. Nothing about those names is on the server, so the screen
cannot list anything without decrypting everything first.

**It never reads a payload's shape itself.** A file's name comes from the sealed manifest, which
this module owns; a secret's and a note's come from a `SharedTextView` function the caller passes
in, returning both the `name` for the tile and the `body` to display. That seam exists because the
envelope a secret travels in is app knowledge — `lib/app/sharing.ts` holds `sharedSecretView` and
`sharedNoteView`, and this module stays ignorant of how either is encoded. Handing back the raw
plaintext for both was the shortcut that shipped, and it showed the reader a secret's whole JSON
envelope where the value belonged.

**It never throws, and that is load-bearing.** Every failure — a missing connection, a share with no
wrapped key, a blob that will not open — comes back as a `ReceivedItem` with a `problem` string,
rendered as an *Unreadable* tile that says why. The screen pairs that with `Promise.allSettled`.

The reason is a bug this once caused: the key derivation sat **outside** the try, so a single
unopenable share rejected the whole batch and the screen rendered *nothing has been shared with
you* — with a real file sitting in the inbox. **One arrival must never be able to hide the
others**, and a decryption failure the user cannot see is worse than one they can.

## Not built yet

`keys.ts` and `api.ts` are complete and tested, and so are the components the security rests on: the
invitation flow, the acceptance screen carrying the fingerprint comparison, the inbox, and the
share-from-item control — a `SharingIcon` on every drive, note and document tile and on every vault
row. **Still open**: *Copy to my own account* and the encrypted connection nicknames,
[Tasks 104.4–104.5](../../../tasks/tasks.md#task-104--safe-sharing-the-client-surface). A shared
**document** arrives fully decryptable and says so; it has no reader yet.
