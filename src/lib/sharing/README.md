# `lib/sharing`

The client half of safe sharing. The protocol is [Task 102](../../../../tasks-closed.md#task-102) D1–D10,
adapted to devices in [device-keys.md § Sharing under scopes](../../../../api-general/docs/crypto/device-keys.md#sharing-under-scopes).
The wire contract is [front-end-endpoints.md § 18](../../../front-end-endpoints.md#18-sharing-endpoints).

## One connection per pair, both ways

A connection joins two accounts **whoever invited**: the server refuses a second one between the
same pair in either direction, and `inviteByUsername` refuses it locally first
(`AlreadyConnectedError`, rendered as `inviteExists`). **Once accepted, it carries shares both
ways**: the invitee opens the connection key from `pqxdh_blob`, the inviter from its own sealed
copy, and both store their own sub-keys, so either wraps a DEK the other opens. The inbox lists
what the other side shared.

## One exchange per relationship, one sub-key per scope

- **The connection key** is 32 random bytes, PQXDH-wrapped (usage `item-share`) to the
  recipient's **current sharing keys**, a generation of their `sharing` keyring. That is
  `pqxdh_blob`, stored with `recipient_key_generation`.
- **The sender keeps it** as `sender_wrapped_key`, sealed under the sender's current `sharing`
  KEK, stored with `sender_key_generation`. Each side receives only the blob it can open.
- **A share never uses the connection key directly.** Each side derives one sub-key per item
  scope, `HKDF-SHA256(connection_key, "Cryple-Share-v1|<scope>")`, seals it under that scope's
  current KEK and stores it with `PUT /connections/{id}/keys` (`storeSubkeys`). A share's DEK is
  wrapped under the sub-key of the item's scope: one AES-256-GCM wrap with a fresh random IV,
  60 bytes.
- **Opening a share needs only the scope's sub-key**, read from the connection row's `keys`. A
  device holding `notes` but not `sharing` can read notes shared with its account and nothing
  else. When a side has no sub-key for a scope yet, a device holding `sharing` derives it and
  stores it.

**The connection key is never persisted.** It is re-opened in memory when needed and zeroed
after. **Never a counter IV**: one sub-key protects many wraps, so `wrapUnderConnection` draws
its own IV and takes none.

## Re-establishing after a rotation — `reestablishConnection`

A connection key was established to the counterparty's `sharing` keys of one generation. Removing a
device rotates every keyring it held, so after a rotation that connection key is still one the
removed device could derive. `reestablishConnection` mints a new one
([Task 131](../../../../tasks-closed.md#task-131)).

`SharingScreen` calls it for every connection each time the screen loads, and a failure on one is
skipped rather than surfaced — it is a catch-up, not something the user asked for. It is a no-op
unless all of these hold:

- the connection is **outbound** (only the sender can re-establish — PQXDH encapsulation needs the
  recipient's public keys and nothing of the recipient's that a rotation invalidates);
- it is **accepted**;
- the counterparty resolves to the same `user_address` it did before;
- `connectionIsStale` — their published `sharing` generation is **newer** than
  `recipient_key_generation`. It never re-establishes backwards, whatever the server reports;
- the counterparty is still **trusted** against the pinned root key. `mayPin` is false here: a
  catch-up in the background must never quietly pin a key nobody compared.

It then re-wraps **every** share on the connection, in both directions. `listConnectionShares`
gives the set; each share's DEK is opened under the old sub-key and sealed under the new one. The
scope a share was sent under is not recorded on the row, so each is tried scope by scope until one
opens — that is what makes a share's scope still decide which sub-key applies. All of it goes in
one request, because the server applies it in one transaction: sub-keys without share wraps would
leave nothing on the connection openable.

**What it buys, and what it does not.** A removed device that knew the old sharing keys cannot
derive the new connection key, so it cannot read anything shared from now on. It could already read
what was shared before, and re-wrapping does not take that back — the same prospective limit
[revocation](#sharing-is-a-reference-and-revocation-is-prospective) has.

## Trust: the root key, pinned, and the proof path

The fingerprint two people compare out of band is the **fingerprint of the root public key**
(`rootFingerprint`, SHA-256 of the SPKI, six groups of four). A root key never changes.

`verifyConnection` resolves the counterparty's current username, reads
`GET /users/{uuid}/public-keys`, and returns one of:

| Status            | Means                                                               | UI                                          |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `trusted`         | Same account, the proof path verifies, the root key matches the pin | Nothing                                     |
| `unpinned`        | An invitation still awaiting this account, not compared yet         | The acceptance screen shows the fingerprint |
| `root-changed`    | The root key differs from the pin                                   | **Danger**, _Do not send_, new invitation   |
| `proof-invalid`   | The sharing keys do not trace back to the root                      | **Danger**, _Do not send_                   |
| `account-changed` | The username now leads to another account                           | **Danger**, new invitation                  |
| `unresolvable`    | The username leads nowhere, or the lookup failed                    | Warning, new invitation                     |

- **A sharing-key rotation is not an alarm.** New sharing keys are announced in the account's
  chain, and the proof path (`lib/chain` → `verifyProofPath`) ties them to the pinned root.
- **Pinning** happens on first sight of an accepted connection on either side, and when an
  invitation is sent. A pin already standing is never replaced.
- **Every send checks first.** `shareItem` and `shareItemById` call `assertConnectionTrusted`
  and refuse before any key is unwrapped.
- **Published keys are cached for the session**, per connection, and forgotten at lock. A lookup
  that fails is never cached.

**What this does not catch:** the server withholding an event from the proof path. The owner's
own devices see the full chain; a contact sees a path. A transparency log is the known answer,
and it is out of scope.

## The address book — `address-book.ts`

One sealed blob per account on the server (`GET`/`PUT /sharing/address-book`) holds the **root
pins** (by `user_address`), **connection nicknames** (by connection id) and **device names** (by
device id).

- A fresh DEK seals the JSON on every write, wrapped under the current `sharing` KEK.
- `PUT` is optimistic on `expected_revision` and signed by the device (`address-book-update`).
  **On `409` the book is re-read and the edit re-applied to what is stored**, so two devices'
  concurrent edits merge by id. `STALE_KEY_GENERATION` refreshes the keyrings and retries.
- A nickname never leaves the device in the clear. The server addresses accounts by username
  and never learns what the owner calls them (D8).
- Every device of the account reads the same pins, so a new device compares against what was
  checked before rather than pinning whatever it is shown.

## Never re-resolve a username to repair a connection

A nickname can outlive the connection it pointed at, and a deleted account's usernames are
released ([Task 118](../../../../tasks-closed.md#task-118)). Re-resolving a stored username to heal a
broken connection would silently attach to whoever holds that name now. **A lost connection is a
new invitation and a fresh fingerprint comparison, never a repair.** The alarms for
`account-changed` and `unresolvable` say so.

## Copying a shared item — `copySharedItem`

_Copy to my own account_ re-encrypts what the recipient can read under a **fresh DEK of their
own**, wrapped under their own scope KEK at the current generation. Re-wrapping the shared DEK
would leave the original owner holding a key that opens the copy for ever. A file is downloaded,
decrypted, re-encrypted and uploaded again, and counts against the recipient's quota. A document
copies its last saved snapshot, and refuses (`NothingToCopyError`) when there is none. The copy
survives the original being deleted or unshared.

## What the UI must never claim

- **Re-sharing cannot be prevented.** Anything readable can be copied, which is why copying is a
  button. The invitation card says so (`reshareWarning`).
- **Revocation is prospective**, and deleting the original breaks the recipient's share. No copy
  may imply a share can be un-read.

## Reading what arrived — `received.ts`

`describeReceived` unwraps each arrival far enough to name it: a file's name from its sealed
manifest, a secret's and a note's through the `SharedTextView` functions `lib/app` passes in.
**It never throws.** Every failure comes back as an _Unreadable_ item naming the step that
failed, so one bad share can never hide the others.

## Inputs to a KDF context are checked at the boundary

`sealConnectionKey` and `openConnectionKey` refuse a party address that is not 64 lowercase hex
characters, and say which side is wrong. An `info` string built from `undefined` produces a key
nobody can reproduce, and the damage would only show on the far side, later.

## Where it lives in the UI

Inviting, reviewing a fingerprint, nicknames and disconnecting are in the **Sharing** settings
tab. What arrived is the **Shared** tab, a tile grid with _Download_ and _Copy to my own account_.
Only item types the device holds are offered.
