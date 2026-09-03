# `succession`

Milestone 4 — Tasks 21 and 22. Naming heirs, wrapping item keys to them, and reading the chain's
view of the owner's switch.

Every route here is **owner-scoped**. **None of them serves an heir**, and that is by design before a release: an heir is named unilaterally, holds
nothing, and has no invite, acceptance, decline or inbox to build. After a release the heir claim
path is real but unbuilt and its paths are unsettled. Do not add heir-facing screens.

| Function | Endpoint | Notes |
| --- | --- | --- |
| `registerBeneficiary` | `POST /succession/beneficiaries` 🔒 | `beneficiary-register`, upsert |
| `listBeneficiaries` | `GET /succession/beneficiaries` 🔒 | paginated; the only place `share_count` / `keys_rotated` are real |
| `deleteBeneficiary` | `DELETE /succession/beneficiaries/{id}` 🔒 | `beneficiary-delete`, cascades every share |
| `assignShare` / `assignSecretById` | `POST /succession/shares` 🔒 | `share-assign`, upsert; any of the three item types |
| `listShares` | `GET /succession/beneficiaries/{id}/shares` 🔒 | paginated |
| `deleteShare` | `DELETE /succession/shares/{id}` 🔒 | `share-delete` |
| `getReleaseStatus` | `GET /succession/status` 🔒 | the chain's view of the owner's own switch |

## Beneficiaries

**The key snapshots are deliberately omitted from the request.** `public_key_x25519_snapshot` and
`public_key_mlkem_snapshot` are optional, and the server stores the heir's *currently enrolled*
keys regardless of what is sent — so sending them adds a mismatch rejection path and buys nothing.
`registerBeneficiary` sends `beneficiary_username`, `encrypted_label` and the four signature
fields, and nothing else. A test pins the exact body key set.

`encrypted_label` is **opaque to this module**: it is passed through, validated only as non-empty.
Decision A landed the owner's vault KEK (`Cryple-Key-v1|vault-kek`, see [`lib/keys`](../keys/README.md)
and [`lib/secrets`](../secrets/README.md)), but the ratified sealed-blob table covers only
`secrets.wrapped_dek`, `secrets.ciphertext` and `recovery_vaults.encrypted_seed` —
**`encrypted_label` was not in it**, and reusing the vault KEK anyway would have been exactly the
uncoordinated construction `storage-plan.md` §3.1.1 forbids. It got its own leaf instead —
`Cryple-Key-v1|heir-label`, `crypto/ECDSA.md` § Step 6, sealed through the same envelope
([`lib/app` § The heir label](../app/README.md#the-heir-label)). The sealed-blob table now lists
four fields, not three.

`dropped_shares` is **absent when zero**, which today means always: enrolment keys are immutable,
so a re-registration can never supersede the stored snapshot. `registerBeneficiary` still
normalizes it to `droppedShares: 0` so no caller branches on `undefined`, but do not build a flow
that depends on ever receiving it.

`share_count` on the register response is **always `0` and means "not computed"**, not "no shares".
Read the real tally from `listBeneficiaries`. `created` distinguishes the `201` insert from the
`200` upsert.

### `keys_rotated: true` means the heir deleted their account

There is no key-rotation endpoint, so the "snapshot no longer matches" half of this flag cannot
fire. The one way it appears is a closed heir account: the row survives with its link severed and
`username` / `user_uuid` come back as **empty strings**.

The remedy is the opposite of re-registration — re-registering needs a username that no longer
resolves, so it answers `400`, and every assignment against the row stays blocked. Deleting the
beneficiary is the only way to clear it. `isAccountClosed`, `closedAccountBeneficiaries` and
`CLOSED_ACCOUNT_REMEDY` exist so the UI renders "this heir closed their account — remove them and
choose another"; `assertAssignable` throws `BeneficiaryAccountClosedError` before any wrap is
attempted. **Never render a re-wrap prompt.**

### The heir's `user_address` is caller-supplied, and checked

PQXDH `info` for `succession-dek` binds both parties' 64-hex `user_address` values, but **no
succession endpoint returns the heir's address** — the rows carry `user_uuid` and `username` only,
and `GET /users/lookup` resolves address → username, never the reverse.

This is the same shape as the guardian side: the owner already holds the address, because looking
it up is how they learned the username to register in the first place. `toRecipient(beneficiary,
userAddress)` therefore takes it as a parameter. Prefer **`resolveRecipient`**, which calls
`lookupUsername` and refuses with `BeneficiaryAddressMismatchError` unless the address resolves to
that beneficiary's username — wrapping under a wrong address produces a blob the heir can never
open, and nothing server-side would catch it.

## Inheritance shares

The wrap is `usage = succession-dek`, sender = the owner's `user_address`, recipient = the heir's,
recipient keys = the beneficiary's stored `public_key_*_snapshot`. Tests round-trip a real
`pqxdhWrap` → `pqxdhUnwrap` and confirm the blob does **not** open under a substituted recipient
address or a substituted usage label.

`wrapItemKeyForHeir` first recovers the item's DEK via `unwrapDek`, which — with no `dek` override
on the context — resolves to `vaultKekDekWrapper(context.session.vaultKek)`
([`lib/secrets`](../secrets/README.md)). This used to be the one unresolved spec gap; Decision A
closed it, so the full owner-unwrap → PQXDH-rewrap path now runs against the real vault KEK by
default. The `dek` override on `SuccessionContext` still exists as a test seam, not a production
requirement.

`share-assign` signs `beneficiary_id` then `item_id`, **in that order**; a test confirms the
signature does not verify with the two swapped. Re-assigning the same `(beneficiary, item)` pair is
an upsert — `created` is `false` on the `200`.

### All three item types, one path

An heir can be left a **secret, a note or a document**. `assignShare` takes an `InheritableItem`
(`{ type, id, wrappedDek }`) rather than a record from any one domain, because the three are
identical where it matters: each carries a `wrapped_dek` sealed under the same vault KEK, so
unwrap → PQXDH-rewrap → `POST /succession/shares` is one function with `item_type` as data.
`inheritableSecret` / `inheritableNote` / `inheritableDocument` build one from each record; the
caller supplies the record it already holds.

`ITEM_TYPES` is sorted `document, note, secret` — the order
[`lib/vaultmerkle`](../vaultmerkle/README.md) sorts leaves in, so the two lists read as the one set
they are. `assertItemType` rejects anything else **before the request is built**, mirroring the
server's `unsupported item_type`; a test asserts nothing reaches the network.

**A document's DEK seals its snapshot *and* every delta**, so this one wrapped key is the whole
assignment however long the log grows — nothing extra is stored per delta. What that does *not*
cover is verification: the anchored Merkle leaf commits to the snapshot alone, so an heir receives
the deltas past `snapshot_seq` unproven. That is the heir client's problem to render honestly, and
it is documented on the API side under `/succession/inheritances/…`
([front-end-endpoints.md](../../../front-end-endpoints.md)).

**One id space, three tables.** The server's uniqueness constraint is
`(beneficiary_id, item_id)` with no `item_type` in it, so one heir cannot hold two items that share
an id even when they are a note and a secret. Ids are random UUIDs, so this is theoretical — but it
is why `findItemAssignments` matches on `item_id` alone and is still correct.

### Deleting an item shrinks someone's inheritance

Both secret-delete routes also delete every wrapped key assigned to that item, in the same
transaction, and the response does not report how many went with it. `findItemAssignments` answers
"who inherits this item" from the per-beneficiary share lists so the UI can warn first. Treat any
cached `share_count` as stale after a delete and re-read the beneficiary list.

## Release status

`getReleaseStatus` returns `{ chain }` and nothing else. There is no off-chain status, vote tally
or countdown beside it, so nothing this module reads can disagree with the chain about whether a
vault has been released.

**Guardians used to vote here and no longer do.** `castReleaseVote`, `listReleaseVotes`,
`verifyReport` and the `succession-release-vote` action were removed on 2026-09-03 by
[Task 91](../../../../api-general/.docs/tasks/tasks.md#task-91): the vote could only start its
countdown once the chain already agreed the owner had gone silent, at which point `trigger()` is
permissionless and the keeper sends it unprompted. It advanced no timeline and gated no heir.
Guardians are a recovery role — see [`recovery`](../recovery/README.md).

`buildReleaseView` in [`app`](../app/README.md) derives its headline from `chain.status` alone,
which is the only place a release state exists.

## What this module does not do

- **No heir screens**, per the boundary above.
- **No off-chain release state at all.** The API used to serve a `status` beside `chain` that
  could only ever read `monitoring` or `counting_down`, so a released vault rendered as monitoring.
  The field is gone; `ChainStatus` is the only status type this module exports.
- **`chain.status` carries one value the contract does not define: `unknown`.** It means the API
  could not read its chain mirror — an infrastructure fault, not a fact about the switch. It is
  surfaced as `ReleaseView.chainUnavailable` so a screen can say "retry" rather than "not set up".
  Never treat it as permission for anything.
- **Everything inside `chain` is unix seconds; everything outside it is RFC 3339.** `chain` values
  are block timestamps the API copies rather than reformats. `buildReleaseView` converts them in
  one place, `fromUnixSeconds`, so no caller picks the wrong parser.
- **`chain.last_check_in` is optional.** It appears once the smart account has been configured
  on-chain, and is absent before that. It is a real heartbeat now, not a row-creation date, but an
  absent one must not render as a date.
- **No check-in or switch configuration.** `inactivity_threshold_days` and the quorum are
  **on-chain owner actions**; this endpoint is a read-only mirror.
- `trigger_started_at` is typed `string | undefined` and tested with `in` — never `| null`.
