# `succession`

Milestone 4 — Tasks 21, 22 and 23. Naming heirs, wrapping item keys to them, and the
guardian-cast release vote.

Every route here is **owner-scoped except the vote**, which is guardian-scoped. **None of them
serves an heir**, and that is by design before a release: an heir is named unilaterally, holds
nothing, and has no invite, acceptance, decline or inbox to build. After a release the heir claim
path is real but unbuilt and its paths are unsettled. Do not add heir-facing screens.

| Function | Endpoint | Notes |
| --- | --- | --- |
| `registerBeneficiary` | `POST /succession/beneficiaries` 🔒 | `beneficiary-register`, upsert |
| `listBeneficiaries` | `GET /succession/beneficiaries` 🔒 | paginated; the only place `share_count` / `keys_rotated` are real |
| `deleteBeneficiary` | `DELETE /succession/beneficiaries/{id}` 🔒 | `beneficiary-delete`, cascades every share |
| `assignShare` / `assignSecretById` | `POST /succession/shares` 🔒 | `share-assign`, upsert |
| `listShares` | `GET /succession/beneficiaries/{id}/shares` 🔒 | paginated |
| `deleteShare` | `DELETE /succession/shares/{id}` 🔒 | `share-delete` |
| `castReleaseVote` | `POST /succession/votes` 🔒 | guardian-scoped, `succession-release-vote` |
| `getReleaseStatus` | `GET /succession/status` 🔒 | owner's own switch |
| `listReleaseVotes` / `verifyReport` | `GET /succession/votes` 🔒 | paginated over a **nested** array |

## Beneficiaries

**The key snapshots are deliberately omitted from the request.** `public_key_x25519_snapshot` and
`public_key_mlkem_snapshot` are optional, and the server stores the heir's *currently enrolled*
keys regardless of what is sent — so sending them adds a mismatch rejection path and buys nothing.
`registerBeneficiary` sends `beneficiary_username`, `encrypted_label` and the four signature
fields, and nothing else. A test pins the exact body key set.

`encrypted_label` is **opaque to this module**: it is passed through, validated only as non-empty.
Seal it at the call site with `sealText` from [`@/lib/sealed`](../sealed/README.md) under the
owner's vault key. That key is Decision A's `Cryple-Key-v1|vault-kek`, which has not landed in the
backend spec yet — the same gap that blocks the DEK seam below. Until it does, the caller supplies
whatever opaque string it can produce; this module does not choose a construction.

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

## Inheritance shares — half built, one seam blocked

The wrap is `usage = succession-dek`, sender = the owner's `user_address`, recipient = the heir's,
recipient keys = the beneficiary's stored `public_key_*_snapshot`. Tests round-trip a real
`pqxdhWrap` → `pqxdhUnwrap` and confirm the blob does **not** open under a substituted recipient
address or a substituted usage label.

**What is blocked is the step before it.** `wrapItemKeyForHeir` must first recover the item's DEK
via `unwrapDek`, and the owner-side vault KEK is the one unresolved spec gap
([AGENTS.md § Resolved questions](../../../AGENTS.md)). With the default seam that call rejects
with `KekNotSpecifiedError`, so **assignment throws before it reaches the network** — a test
asserts zero fetches. Pass a `dek` wrapper on the context and the whole path works; that is what
the seam was for, and no call site changes when Decision A lands.

**Task 22 is therefore complete except for its dependency on Task 12/13.** Everything downstream
of the unwrap — the PQXDH wrap, the signature, the body, the upsert semantics — is built and
tested against a stand-in wrapper.

`share-assign` signs `beneficiary_id` then `item_id`, **in that order**; a test confirms the
signature does not verify with the two swapped. `item_type` is `secret` and nothing else today.
Re-assigning the same `(beneficiary, item)` pair is an upsert — `created` is `false` on the `200`.

### Deleting an item shrinks someone's inheritance

Both secret-delete routes also delete every wrapped key assigned to that item, in the same
transaction, and the response does not report how many went with it. `findItemAssignments` answers
"who inherits this item" from the per-beneficiary share lists so the UI can warn first. Treat any
cached `share_count` as stale after a delete and re-read the beneficiary list.

## Release votes

### The cycle comes from the guardianship row, never from `/succession/status`

`GET /succession/status` is **owner-scoped** — it reports *your* switch, not the switches you
guard. Its `release_cycle` is the wrong number for a guardian to sign, and binding the wrong cycle
is refused with `401`.

`castReleaseVote` reads `owner_user_address` and `owner_release_cycle` from
`GET /recovery/guardianships` immediately before signing, on every call. A test asserts
`/succession/status` is never fetched on the vote path.

> `tasks.md` Task 23 says to fetch the cycle from `GET /succession/status`. That line is stale:
> [front-end-endpoints.md](../../../front-end-endpoints.md) states the opposite explicitly under
> `POST /succession/votes` and again under `GET /succession/status`, and the guide wins on wire
> behaviour. The implementation follows the endpoint doc.

Both values are **absent, not empty**, on `pending_invite` rows. `toVotableOwner` refuses a
non-active row, a missing address and a missing cycle separately rather than defaulting a cycle —
guessing `1` would produce a signature that is rejected for reasons the user cannot see.

The vote demands the **guardian's own** second factor. `release_cycle` is signed as a colon-joined
string via the shared payload builder; a cycle-*n* signature does not verify as cycle *n+1*, which
a test pins.

### Auditing the count

`GET /succession/votes` paginates over the **nested** `data.votes` array while `data` itself stays
an object, so `collectPages` does not fit — `listReleaseVotes` runs its own cursor loop, keeps the
last envelope's `action` / `owner_user_address` / `release_cycle`, and concatenates the pages.

`verifyReleaseVotes` / `verifyReport` rebuild
`challenge : timestamp : "succession-release-vote" : owner_user_address : release_cycle` **from the
labelled fields** and verify against each `guardian_public_key`. The response deliberately hands
over no ready-made payload string: verifying against the server's own account of what was signed
proves nothing. Each entry's own `release_cycle` is used, so a vote relabelled into the current
cycle fails. Verification never throws — a malformed signature or key yields `valid: false`.

## What this module does not do

- **No heir screens**, per the boundary above.
- **No UI for `released` or `cancelled`.** `getReleaseStatus` types only `monitoring` and
  `counting_down`; nothing in this API writes the others, and `released_at` is never set.
- **`last_check_in` is not a live "last seen".** Until the chain indexer ships it is the row
  creation time, and the thresholds are database defaults. Do not render it as a heartbeat.
- **No check-in or switch configuration.** `inactivity_threshold_days` and the quorum are
  **on-chain owner actions**; this endpoint is a read-only mirror.
- `trigger_started_at` is typed `string | undefined` and tested with `in` — never `| null`.
