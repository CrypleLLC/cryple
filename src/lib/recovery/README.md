# `lib/recovery` — the REK and its Shamir shares

Generates the Recovery Encryption Key, seals the seed phrase under it, and splits the REK
k-of-n so guardians can help the owner back in.

Task 15 of [tasks.md](../../../tasks.md). Shaped by
[recovery-flow.md](../../../../api-general/.docs/recovery-flow.md).

## What is split, and what is not

**The seed phrase is never split.** Cryple generates a random REK, AES-256-GCM-encrypts the
seed phrase under it, and Shamir-splits **the REK**:

```
seed phrase ──AES-256-GCM(REK)──→ encrypted_seed   (stored server-side, opaque)
REK ──────────Shamir k-of-n─────→ shares            (share 0 = user, 1..n-1 = guardians)
```

The server holds `encrypted_seed` and the wrapped guardian shares, and can reconstruct
neither — it holds no guardian's private key.

The REK is **random, not derived from the seed** — unrelated to the vault KEK
([`lib/secrets`](../secrets/README.md)), which wraps item DEKs and nothing else.

## n = guardians + 1

**Share 0 is the user's own Recovery Kit copy and always counts as one share**, so a setup
with two guardians is `n = 3`. `shareCountForGuardians` encodes that; `USER_SHARE_INDEX` is
`0`.

Default and recommended: **2-of-3** — the user plus either of two guardians.

`shareIndex` is Cryple's ordinal (0…n-1), used by the `recovery-setup` digest, which sorts by
it. It is **not** the Shamir x-coordinate — that is a random non-zero byte living inside the
share blob. Do not conflate them.

### Quorum is `min(configured, active guardians)`

`effectiveQuorum` computes it. A forced or accidental extra guardian **raises the owner's bar
without adding a participant**, so surface the guardian count and the effective quorum
together.

## The threshold rule, and the k=1 warning

The API's only rule is `1 ≤ k ≤ n`; `validateSplitConfig` enforces exactly that and nothing
more. There is no tier or plan gating — the Free/Premium split in `recovery-flow.md` is
product-plan copy, not API behaviour.

**`requiresSoleGuardianWarning` flags `k = 1` with more than one share.** That configuration
means any single guardian can reconstruct the seed alone, and the setup UI must say so:

> *"This person can recover your vault on their own. Only choose someone you fully trust."*

That is a safety requirement, not a tier restriction.

Note that even colluding guardians cannot open a **Paranoid Mode** vault: they reconstruct the
seed but still need the PIN to obtain a JWT.

## The SSS library, and the k=1 wrapper

Pinned: **[`shamir-secret-sharing`](https://github.com/privy-io/shamir-secret-sharing)**
(Privy) — independently audited, zero dependencies, TypeScript-native, GF(256), Apache-2.0.

**The share format is a durable protocol constant.** Once shares are distributed to guardians,
changing it strands them. The format is Hashicorp Vault's:

```
share = secret_bytes ‖ x_coordinate(1 byte)      // 32-byte REK → 33-byte share
```

The x-coordinate is the **last** byte, a random non-zero value, distinct per share.

### Why there is a wrapper at all

The library rejects `threshold < 2` on **both** `split` and `combine`, but Cryple's API allows
`k = 1`. `splitSecret` therefore handles that one case directly.

This is not a divergent format. **Shamir at threshold 1 is a degree-0 polynomial**, so
`p(x) = secret` for every `x` — each share carries the secret verbatim with an x byte appended,
which is byte-for-byte what the library would emit if its assertion were removed. `combineSecret`
with a single share strips the x byte, which is the same degree-0 interpolation.

Everything at `k ≥ 2` goes straight to the library. The wrapper is ~15 lines and touches no
field arithmetic.

## Reconstructing below the threshold fails safely

Combining fewer shares than `k` returns a **wrong REK rather than an error** — that is Shamir
working as designed, not a bug. The failure surfaces one step later, when AES-GCM
authentication rejects `encrypted_seed`. A test pins this: a 2-of-3-share combine on a 3-of-3
split produces a REK that then fails to decrypt.

So the loud failure is at seed decryption, never a silently wrong seed phrase.

## `encrypted_seed` uses the shared sealed-blob envelope

```
encrypted_seed = base64( 0x01 ‖ iv(12) ‖ AES-256-GCM(rek, iv, utf8(mnemonic)) ‖ tag )
```

That envelope lives in [`lib/sealed`](../sealed/README.md) and is shared with the item
`ciphertext` and `wrapped_dek`. **Ratified 2026-08-06 as Decision B** —
[`crypto/ECDSA.md` § Sealed Blob Format](../../../../api-general/.docs/crypto/ECDSA.md#sealed-blob-format).
It was previously provisional; the shipped layout was the one adopted, so this code did not
change.

The layout matters beyond this module: the blob is written by one device and read by a
**different** one during recovery, and it is committed to the `recovery-setup` signature digest.

`encryptSeedPhrase` validates the mnemonic checksum before sealing, so a typo cannot be
committed to a recovery vault that then restores a wrong-but-valid account.

## API

```ts
const { encryptedSeed, shares } = await buildRecoveryVault(mnemonic, { shares: 3, threshold: 2 });
const phrase = await recoverSeedPhrase(encryptedSeed, [shares[0].bytes, shares[2].bytes]);
```

Lower level: `generateRek`, `encryptSeedPhrase` / `decryptSeedPhrase`, `splitSecret` /
`combineSecret`, `validateSplitConfig`, `requiresSoleGuardianWarning`, `effectiveQuorum`,
`shareCountForGuardians`.

The REK is zeroed in a `finally` on every path in both `buildRecoveryVault` and
`recoverSeedPhrase`.

## `PUT /recovery/setup` and its digest

`buildSetupPayload` does the whole client side: builds the vault, PQXDH-wraps every share with
`usage=recovery-share`, and returns the payload plus the **raw share 0** for the Recovery Kit.
`submitRecoverySetup` validates, digests, signs and sends it.

Share 0 is wrapped **to the owner's own keys** (sender and recipient both the owner), per
[`recovery-flow.md:126`](../../../../api-general/.docs/recovery-flow.md) — *"encrypted with
User's own public key → Recovery Kit (PDF / offline)"*. The stored copy lets an owner who still
has their seed re-download their kit; it is useless during an actual recovery, because
unwrapping it needs the very seed that was lost. **That is why `recoveryKitShare` is returned
raw** — the offline PDF is the copy that matters.

### The digest

```
canonical = encrypted_seed | n_shares | k_threshold | version
          | share_index ":" guardian_username ":" pq_hybrid_encrypted_share   (one per share)
argument  = lowercase hex SHA-256(canonical)
```

- Fields joined with `|`, the three inside a share with `:`.
- **Shares sorted ascending by `share_index`** before serializing, so the digest does not depend
  on the order the client happened to build the array in. `canonicalSetupString` sorts a copy —
  it never mutates the caller's array.
- **Share 0's middle field is empty** — it has no guardian.
- **`version` is the literal string you send** — empty when omitted, because the digest is
  computed before the server normalizes it to `v1`. **Sign what you send.** `buildSetupPayload`
  omits the key entirely by default, and `JSON.stringify` drops it, so body and digest agree.

Signing the payload rather than the intent is what stops anything between client and server
substituting its own shares on a validly-authorized call — setup **deletes every existing
share** and overwrites the vault in one transaction.

### Local validation

`validateSetupPayload` mirrors every server rule (`shares.length === n_shares`, unique indices
in range, index 0 present and guardian-less, a guardian on every index ≥ 1, no guardian twice,
non-empty ciphertexts, version). The guide is explicit that a `400` from this endpoint means
the client has a bug — and errors carry no message to render, so the check has to be local.

`SetupValidationError` and `ThresholdError` both extend `RecoveryValidationError`, so one
`catch` covers payload validation regardless of which rule failed.

## Guardian management

| Function | Endpoint | Action | Signed by |
| --- | --- | --- | --- |
| `inviteGuardian` | `POST /recovery/guardians/invite` | `guardian-invite` | owner |
| `acceptGuardianship` | `PATCH /recovery/guardians/{id}/accept` | `guardian-accept` | **invitee** |
| `revokeGuardian` | `DELETE /recovery/guardians/{id}` | `guardian-revoke` | owner |
| `listGuardians` | `GET /recovery/guardians` | — | paginated |
| `listGuardianships` | `GET /recovery/guardianships` | — | paginated |

**Both directions of a guardian-set change need the seed key.** Adding is not the safe half: a
guardian the owner did not choose counts toward the PIN-reset quorum and can fetch a Shamir share.
They cannot touch an inheritance — guardians take no part in a release.

**Invite signs the `guardian_username`**, so a signature made for one username is refused for
another. The server checks that signature **before** looking the username up, so this endpoint
is never a username-existence oracle — use `GET /users/lookup` for that. A test asserts the
signature fails to verify against a substituted username.

**Accept needs a signature, not just the JWT** — it changed on 2026-07-29 and used to be a
bodyless `PATCH`. Accepting is the moment the owner's `user_address` becomes visible to you and
the moment you start counting toward their quorum, so a bearer token must not be able to forge
the second leg of a consent handshake. It is the **invitee's own** second factor that applies.

The invitee reaches `acceptGuardianship` from the guardian inbox
([`lib/app` § The guardian inbox](../app/README.md)), which builds its invitation rows from the
`pending_invite` entries of `listGuardianships` — there is no `…/pending` endpoint for
invitations the way there is for sessions and PIN resets. `pendingInvitations` is that filter.
**There is no decline**: the invitee accepts or leaves it, and only the owner can `revokeGuardian`.

### Revocation is not cryptographic revocation

`revokeGuardian` returns a `200` **with a body you must read**. When `recovery_setup_stale` is
`true`, re-running `PUT /recovery/setup` is a **required next step, not a notice**:

- the vault still claims `n_shares` holders but one is gone, and
- more importantly, **the revoked guardian already downloaded their share.** Deleting the row
  stops the server serving it; it does not take it back. Until you re-split under a **fresh
  REK** and re-encrypt the seed, `k` holders including the ex-guardian can still reconstruct it.

`recovery_setup_stale` is `false` when they never held a share — nothing to redo.

The call is idempotent: a retry answers `share_removed: false`, `votes_withdrawn: 0`. Use a
fresh challenge, since action signatures are single-use.

### Quorum

`summarizeQuorum` returns the active count, the configured threshold and the effective quorum
`min(configured, active)` **together**, plus `raisesBarWithoutParticipant` — because a forced or
accidental extra guardian raises the owner's bar without adding anyone who will actually
respond. Surface them as one unit; the number alone is misleading.

`recipientFor` converts a listed guardian into a PQXDH recipient for
[`buildSetupPayload`](#put-recoverysetup-and-its-digest), taking the recipient half of the
`recovery-share` `info` string from the row's own `user_address`. It throws
`GuardianAddressUnavailableError` when that field is absent and `GuardianKeysUnavailableError`
when the encryption keys are — both meaning the same thing, that the guardian has not accepted
yet and nothing can be wrapped for them. `toRecipient` is the lower half, taking an address from
the caller; nothing in the UI supplies one.

The owner never types a guardian's address. `GET /recovery/guardians` supplies it, and it is the
only place that does: `GET /users/lookup` resolves address → username and never the reverse. A
share wrapped under the wrong address is accepted by every party and fails only at
reconstruction.

The same absence rule applies to `user_address` and `encryption_public_key_*` here, and to
`owner_user_address` on `GET /recovery/guardianships`: present only on `active` rows, **absent**
rather than empty. The two address fields are the two halves of one consent handshake — neither
side learns the other's address before it completes. That endpoint is the **only** place a guardian
can obtain the owner's address, which they need for the PQXDH `info` string when re-wrapping their
share. The `owner_release_cycle` that used to sit beside it is gone with the release vote
([Task 91](../../../../api-general/.docs/tasks/tasks.md#task-91)).

## The recovery session — recovering-device side

The transport, polling, vault fetch, reconstruction **and the crypto** are all built. The two
gaps that blocked this task were closed on 2026-08-06 as Decisions C and D — see
[proposals/opaque-blob-layouts.md](../../../proposals/opaque-blob-layouts.md).

**Decision C — the ephemeral key is two keys.** PQXDH is hybrid, so
`POST /recovery/request` carries `ephemeral_x25519_public` (32 B) **and**
`ephemeral_mlkem_public` (1184 B), both base64. `generateEphemeralKeys` mints both pairs;
`parseSessionRecipient` **validates each length** before wrapping, so a malformed key fails
loudly rather than producing a share the recovering device silently cannot open.

**Decision D — `info` binds the `session_id`.** For `usage=recovery-session` both address slots
of the PQXDH info string carry the session id, because the recovering device can derive neither
its own `user_address` (that needs the lost seed) nor the guardian's (the session response
carries no guardian identity). The session id is single-use, server-generated and 30-minute
scoped, so it provides the cross-session binding the addresses were there for. A test confirms a
blob wrapped for one session will not open under another.

What is here:



| Function | Endpoint | Notes |
| --- | --- | --- |
| `startRecovery` | `POST /recovery/request` | public, **unsigned**, **not retry-safe** |
| `getRecoverySession` / `pollRecoverySession` | `GET /recovery/session/{id}` | public |
| `getRecoveryVault` | `GET /recovery/vault?username=` | public |
| `completeRecovery` | — | unwrap → combine → decrypt |

**`POST /recovery/request` creates a row per call.** There is no idempotency key and no
signature — the caller has lost the seed, so there is no key to sign with, and its protection
is the guardian vote rather than a credential. **Persist `session.id` before the first
attempt** and resume by polling it; a blind retry strands the first session with its own
30-minute TTL and its own shares.

**Shares arrive as they are submitted.** `shares` holds whatever guardians have sent so far,
which may be fewer than `k`. `status` flips to `shares_collected` only once **every** guardian
has answered (`n - 1` submissions) — that means "nobody else is coming", not "you can start".
**Never gate reconstruction on the status**; count the shares.

**Poll, do not wait** — there are no webhooks. `pollRecoverySession` defaults to 3s, takes an
`AbortSignal` so polling stops when the screen closes, and raises `SessionExpiredError` both on
a `409` and on a locally-observed `expires_at`. Sessions live 30 minutes.

`completeRecovery` accepts an `ownShare` alongside the collected ones — the user's Recovery Kit
copy, typed or scanned from the PDF. The server-stored share 0 is wrapped to keys the user no
longer has, so the Kit is the only readable form of it.

**The Kit is one of the `k`, not a spare above them.** `hasReachedThreshold(session, ownShareCount)`
counts guardian submissions plus the shares the device already holds, and `pollRecoverySession`
takes `ownShareCount` so it stops one guardian earlier when the Kit was supplied. The recommended
2-of-3 is therefore what `recovery-flow.md` says it is: **the user plus either guardian**. A vault
configured `k = n` completes only with the Kit — every guardian plus share 0.

**Only the client can count the threshold.** `k_threshold` counts all `n` shares including share 0,
which is never uploaded; the server sees at most `n - 1` of them and cannot know whether the
recovering device holds its Kit. Comparing guardian submissions against `k_threshold` server-side
— which is what the code did until this was fixed — quietly demanded `k + 1` pieces of any owner
who had their Kit, turning the recommended 2-of-3 into a 3-of-3.

### Why counting the Kit is not a weakening

The former gate was argued for on the grounds that `POST /recovery/request` is public and
unsigned, so guardian approval *is* the authentication, and an unverifiable "I have my Kit"
should not be credited. Three things are wrong with that:

- **A stolen Kit plus one guardian opening a 2-of-3 vault is the configuration working**, not a
  bypass. That is precisely what the owner chose when they picked `k = 2` over `k = 3`, and what
  the setup UI promises. The defence against a stolen Kit is the threshold the owner selected and
  the guardian's out-of-band check that the requester is really them — never a server count.
- **The gate never prevented that attack**, it only raised every requester's bar by one. An
  attacker holding the Kit who could trick one guardian could usually trick two; the owner who
  lost their phone could not conjure a second guardian at 2am.
- **Nothing is disclosed by releasing shares early.** Fewer than `k` Shamir shares are
  information-theoretically independent of the REK, and every relayed blob is sealed to the
  session's ephemeral keys, which only the recovering device holds.

After reconstruction the flow rejoins the normal restore path (Task 10): set a new local PIN,
re-wrap the seed, then `POST /sign-up` to restore.

## The recovery session — guardian side

| Function | Endpoint | Notes |
| --- | --- | --- |
| `listPendingSessions` | `GET /recovery/sessions/pending` 🔒 | poll ~once a minute |
| `getStoredShare` | `GET /recovery/share/{session_id}` 🔒 | the guardian's own share |
| `unwrapOwnShare` | — | **fully specified**, real PQXDH |
| `submitReEncryptedShare` | `POST /recovery/submit` 🔒 | `recovery-share-submit` |
| `contributeShare` | — | the four steps in order |

**Only the re-wrap is blocked.** `unwrapOwnShare` is fully implementable and tested against
real PQXDH: the owner wrapped the share with `usage=recovery-share`, sender = owner, recipient =
guardian, and the guardian knows both addresses (their own, and the owner's from
`owner_user_address` on their `active` guardianship row). A test wraps with `pqxdhWrap` and
opens it, and another confirms it fails under a substituted owner address.

`submitReEncryptedShare` binds **both** `session_id` and the share bytes: binding the share
stops a proxy swapping in a corrupt one, binding the session stops the signature being replayed
into a different recovery. A test asserts the signature fails to verify against a substituted
share. This is the call that hands over a piece of someone's seed, so it needs the seed key —
and the **guardian's own** second factor.

## PIN reset

Recovers a forgotten PIN while the seed is still available:
**request → guardians vote to quorum → 48h contest period → `authorized` → owner confirms.**

| Function | Endpoint | Action | Second factor |
| --- | --- | --- | --- |
| `requestPinReset` | `POST /auth/pin-reset/request` | `pin-reset-request` | **none** |
| `voteOnPinReset` | `POST /auth/pin-reset/vote` | `pin-reset-vote` | **guardian's** |
| `revokePinReset` | `PATCH /auth/pin-reset/revoke` | `pin-reset-revoke` | **none** |
| `confirmPinReset` | `PATCH /auth/pin-reset/confirm` | `pin-reset-confirm` | **none** |
| `getPinResetStatus` | `GET /auth/pin-reset/{id}` | — | public |
| `listPendingPinResets` | `GET /recovery/pin-reset/pending` 🔒 | — | guardian inbox |
| `listPinResetVotes` | `GET /auth/pin-reset/{id}/votes` 🔒 | — | owner-only audit |

**Four of the five are public**, because an owner who lost their PIN cannot mint a JWT. They are
authenticated by action signature alone.

**The owner's three actions carry no `password`, and cannot** — the flow exists precisely
because the PIN is lost. That is structural; `ownerEnvelope` hard-codes `paranoid: false` so it
cannot regress. The vote is the exception: it is cast by a guardian who has lost nothing, so
*their* mode applies.

`confirmPinReset` **signs the new token**, not just the intent — otherwise anything in the
middle could keep the owner's signature and install a token of its own. It calls
`session.rekeySecondFactor` on success so the new PIN is live in-session.

`requestPinReset` returns `created` from the status code: `201` opened a new request, `200`
returned one already open. Read `votes` before claiming the tally starts at zero.

### The guardian inbox is not only "awaiting your vote"

Rows appear with `status` of `pending_quorum` **or** `contest_period`, so a guardian can see the
outcome of their own vote. **Only `pending_quorum` accepts a vote** — voting on a
`contest_period` row is `409 CONFLICT`. `canVoteOn` gates on
`status === 'pending_quorum' && !voted`; `voted` is independent of `status`.

### Auditing votes — rebuild, never trust

`verifyPinResetVotes` reconstructs `challenge:timestamp:pin-reset-vote:request_id` from the
**semantic fields** and verifies each signature against the guardian's SPKI public key.

The endpoint deliberately returns those fields rather than a rendered payload string: *a
verifier that trusts the server's rendering of what was signed has verified nothing*, since a
malicious backend could supply a matching string/signature pair whose meaning is not the vote it
is presented as. Tests cover a vote re-attributed to a different `request_id`, a tampered
timestamp, a tampered challenge, and a fabricated signature — all report `valid: false`, and a
malformed key reports invalid rather than throwing.

`GET /auth/pin-reset/{id}/votes` is the one **protected** route in the flow: it carries guardian
usernames and public keys, so leaving it public would turn a request id into a guardian-set
disclosure. Read it after the reset completes, once you can authenticate again.

`contestPeriodRemainingMs` clamps at zero and returns `undefined` before quorum. Note that
polling `GET /auth/pin-reset/{id}` is what **settles** the period — the
`contest_period → authorized` transition happens on that read.

## Tests

`recovery.test.ts` exhausts **every** k-subset for 2-of-3 and 3-of-5 rather than sampling one,
checks share layout and distinct x-coordinates, pins the k=1 degenerate path against the
ordinary one, asserts a sub-threshold combine fails at seed decryption rather than silently,
and confirms two vaults built from the same phrase never match.
