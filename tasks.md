# Web App — API Integration Tasks

Task list for integrating the Cryple API (`../api-general`) into this client. Read [AGENTS.md](./AGENTS.md) first — every task below assumes its rules: the frozen specs win on bytes and constants, [front-end-guide.md](./front-end-guide.md) / [front-end-endpoints.md](./front-end-endpoints.md) win on the wire contract, and nothing in the current `src/` is a reference.

Ordering is load-bearing: Milestone 0 is the trust root for everything after it, and each milestone unblocks the next. Within a milestone, tasks are ordered by dependency.

Conventions for this file: check a task only when its listed acceptance criteria pass. A task that touches a domain updates that domain's `README.md` in the same change (no comments in code — the README carries the documentation).

---

## Milestone 0 — Cryptographic foundations

Nothing ships, and no other milestone starts, until Task 3's fixture is green. A wrong derivation here produces a valid-looking but different account, and the failure surfaces at inheritance release — years too late.

- [x] **Task 1: Test runner.** Add Vitest (proposed in AGENTS.md as the conventional choice for Next 15 + TS strict; confirm with the user before installing). Wire `npm test`. Acceptance: a trivial test runs in CI-able form. *Blocks: every task below — the crypto layer cannot be written without its fixtures.*

- [x] **Task 2: Dependencies.** Add `@noble/curves` (SLIP-0010 P-256 signing, X25519 — WebCrypto cannot import a raw EC private scalar) and `@noble/post-quantum` (ML-KEM-768). `@noble/hashes` and `bip39` are already installed. Copy `../api-general/.docs/crypto/test-vectors.json` into the test fixtures verbatim — this client only ever *reads* that file; regenerating it is a backend operation.

- [x] **Task 3: The frozen key tree** (`src/lib/keys/` or equivalent — naming is the implementer's, the constants are not). Implement exactly [crypto/ECDSA.md](../api-general/.docs/crypto/ECDSA.md):
  - BIP39 mnemonic → 64-byte seed (validate checksum before use; NFKD; passphrase supported, default empty).
  - `user_address = SHA-256(raw seed bytes)` → 64-char lowercase hex. **Not** the hex string of the seed — that is the current `src/` bug.
  - ECDSA P-256 via **SLIP-0010** (HMAC key `"Nist256p1 seed"`, P-256 order in the retry rules), path `m/9027'/0'/0'`, all levels hardened.
  - X25519 via `HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|x25519", L=32)`; use the output as the scalar directly, no pre-clamping.
  - ML-KEM-768 via `HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|mlkem768", L=64)` → FIPS 203 `(d‖z)` keygen.
  - Acceptance: **every value in `test-vectors.json` reproduced** — seed, `user_address`, P-256 private/chain-code/public in all three encodings, both encryption key pairs. This fixture is the only cross-client check of the derivations that exists anywhere; no Go test consumes the vectors.

- [x] **Task 4: Encoding helpers.** hex ↔ bytes, base64 ↔ bytes, P-256 public key → SPKI DER base64 (must come out 124 chars), uncompressed point, raw `(X, Y)`. Acceptance: round-trips against the vector file's three encodings of the same key.

- [x] **Task 5: PIN layer** per [auth/two-factor-PIN.md](../api-general/.docs/auth/two-factor-PIN.md). Two distinct PBKDF2 usages — do not share code paths that could conflate their salts:
  - `Server_Auth_Token = hex(PBKDF2-HMAC-SHA256(PIN, salt=utf8(user_address hex string) /* 64 bytes, not 32 */, 600_000, 32))`. Acceptance: matches the vector (`pin 428193` → recorded token).
  - Local seed vault: random 32-byte salt per device, PBKDF2 same parameters, AES-256-GCM with fresh 12-byte IV, stored as `{v: 1, salt, iv, ct}` in `localStorage`. Keep the `v` marker.
  - PIN format rules at creation: exactly 6 ASCII digits, no ascending/descending sequence, no all-repeating digit.
  - **3 failed unlock attempts wipes the local vault copy** — product policy from `recovery-flow.md`, not optional.

- [x] **Task 6: Session key custody.** In-memory keystore holding the derived P-256 key, X25519/ML-KEM private keys, and `Server_Auth_Token` after one PIN unlock per session. Zero on lock/timeout. Nothing here ever touches `localStorage`/`sessionStorage`, is logged, or is sent to the server except the token in the `password` field. Design target: "unlock once per session", never "prompt per action".

## Milestone 1 — HTTP and authentication

- [ ] **Task 7: HTTP layer** (`src/lib/api/`). One place that owns:
  - `NEXT_PUBLIC_BASE_API_URL` (includes `/v1`; default `http://localhost:8080/v1`) — `v1` appears nowhere else.
  - Success envelope `{message, data}`; error envelope `{"code": "…"}` only — all user-facing copy is built client-side from `code` + endpoint.
  - Status handling by response, never by verb (`DELETE` can return `200` with a body; `204` exists).
  - `401 UNAUTHORIZED` (session over → sign in again) vs `401 INVALID_CREDENTIALS` (can appear on a plain `GET`) as distinct outcomes.
  - Optional fields typed `?`/`| undefined`, never `| null`.
  - UUID canonicalization at the edge: lowercase hyphenated in, echo back exactly what the API returned.
  - Only `Content-Type` and `Authorization` headers; no `credentials: "include"`; timeouts ≥ 2 s (350 ms public floor); 1 MiB body cap awareness.
  - Pagination helper: follow `next_cursor` until `has_more === false`; cursors opaque, never built or persisted.
  - **No automatic retry of signed requests** — retry policy lives with the signer (Task 8), because every retry needs a fresh challenge triple.

- [ ] **Task 8: Signed-request helper — the single hardest piece; build it once, not per call site.** Per [auth/challenge.md](../api-general/.docs/auth/challenge.md) and [auth/signed-actions.md](../api-general/.docs/auth/signed-actions.md):
  - Fresh 32-byte challenge (64 lowercase hex) + unix-seconds timestamp per request, including every retry.
  - Payload `challenge:timestamp` (auth) or `challenge:timestamp:action:arg…` (actions), colon-joined; pass the payload to `crypto.subtle.sign` — **never pre-hash** (double-hash = every signature rejected).
  - Output: IEEE P1363, 64 raw bytes, base64.
  - Attach `password` (the `Server_Auth_Token`) exactly when the action table demands a second factor **and** the account is Paranoid — mode read from `has_password` on `GET /users/me`, never cached guesses.
  - Encode the action table from [signed-actions.md § Actions](../api-general/.docs/auth/signed-actions.md#actions) as data (action label → arg order → second-factor flag), so a new action is one row, not new code.
  - Acceptance: unit tests mirroring the backend's `service_test.go` cases — signature bound to timestamp, action, and arguments; sign-in payload never valid as an action payload; `secret-delete` ids sorted ascending and de-duplicated before signing.

- [ ] **Task 9: JWT lifecycle.** Store the token from `/sign-up` | `/sign-in` (both `201` and `200` carry one), attach as `Authorization: Bearer`, treat its 24h `exp` as the session, drop on logout (deleting our copy *is* logout — no revocation exists). `401 UNAUTHORIZED` anywhere → session over.

- [ ] **Task 10: Sign-up / sign-in / restore flows.**
  - Sign-up enrolls all three public keys (SPKI base64, X25519 base64, ML-KEM base64). **Enrollment is immutable** — no re-derivation drift is survivable, which is what Task 3's fixture protects.
  - Re-running `POST /sign-up` is the documented restore-on-new-device path; the server refuses (generic `404`) if either encryption key differs from what is stored. Surface that case as "derivation mismatch — check this build against the test vectors", not "user not found".
  - Any `404` from `/sign-up`, `/sign-in`, `/auth/verify` renders one generic "could not sign in" — the ambiguity is deliberate anti-enumeration.
  - Standard vs Paranoid at sign-up: send `password` or don't. Sending it on a Standard account fails exactly like omitting it on a Paranoid one.

## Milestone 2 — Users and secrets

- [ ] **Task 11: Users domain.** `GET /users/me` (source of truth for `has_password`), `GET /users/lookup`, `GET /users/{uuid}/public-keys`, `POST /users/second-factor` (action `enable-second-factor`, signs the new token; its ambiguous `401` on retry is resolved via `GET /users/me`), `PUT /users/password` (rotate — needs the current token), `DELETE /users` (action `account-delete`). **No "disable PIN" affordance exists or ever will** — Paranoid → Standard is not a supported transition.

- [ ] **Task 12: DEK wrap seam.** Define `wrapDek(dek): string` / `unwrapDek(wrapped): dek` as the *only* interface the secrets domain sees. ⚠️ **The owner-side KEK derivation is the one unresolved spec gap** (AGENTS.md § Resolved questions): `storage-plan.md` forbids inventing a KEK path and defers the derivation to `crypto/ECDSA.md`, where nothing has landed. The seam ships with a stub that throws; the real derivation is a backend-spec addition plus regenerated test vectors. **Do not pick a label or construction in this repo under any circumstances** — the server treats `wrapped_dek` as opaque, so a divergent choice fails silently, per item, forever. *Blocks Task 13 only.*

- [ ] **Task 13: Secrets domain** *(blocked on Task 12's spec resolution)*. Per-item flow: random 256-bit DEK → AES-256-GCM the payload → `wrapDek` → `POST /secrets {id, ciphertext, wrapped_dek, version}` with a **client-generated `id`** (that is what makes the POST retry-safe). Vault index from `GET /secrets?fields=meta` (unpaginated); hash the ciphertext you received rather than trusting `ciphertext_sha256`; single and batch delete via action `secret-delete` (batch = sorted de-duplicated ids; single = the one-element case; both need a JSON body). Budget ~700 KiB plaintext per item against the 1 MiB cap.

## Milestone 3 — Recovery

- [ ] **Task 14: PQXDH module** per [crypto/pqxdh.md](../api-general/.docs/crypto/pqxdh.md). Fresh ephemeral X25519 per wrap; `IKM = 0xFF×32 ‖ ecdhSecret ‖ kemSecret`; `HKDF-SHA256`, zero salt, `info = "Cryple-PQXDH-v1|{usage}|{sender}|{recipient}"`; AES-256-GCM, no AAD; wire blob `0x01 ‖ kem_ct(1088) ‖ eph_pub(32) ‖ iv(12) ‖ ct+tag`. Reject unknown versions and length-inconsistent blobs before decrypting. Zero all intermediates after use. Acceptance: reproduce the vector file's `session_key_hex` and decrypt its `wire_blob_base64` (encapsulation randomness makes wrap non-deterministic; unwrap of the recorded blob is the test).

- [ ] **Task 15: REK + Shamir.** Generate a random Recovery Encryption Key, AES-256-GCM the seed phrase under it, split the REK k-of-n (n = guardians + 1; share 0 is the user's own Recovery Kit copy). Pick and pin an SSS library in the same change (audited, GF(256), deterministic share format) — the share format is as durable as any protocol constant once shares are distributed. UI validation is the API's only rule: `1 ≤ k ≤ n`. **k=1 with one guardian requires the explicit warning**: "This person can recover your vault on their own."

- [ ] **Task 16: `PUT /recovery/setup`** with the `recovery-setup` digest: `encrypted_seed | n_shares | k_threshold | version | share_index:guardian_username:pq_hybrid_encrypted_share…`, shares sorted ascending by index, share 0's guardian field empty, `version` as the literal string sent (empty if omitted — sign what you send), argument = lowercase hex SHA-256. Guardian shares wrapped with PQXDH `usage=recovery-share`. Acceptance: port the backend's two `SetupDigest` tests (share-order independence; digest changes with every committed field) against this implementation.

- [ ] **Task 17: Guardian management.** Invite (action `guardian-invite`, signs the username — signature verified before the username lookup, so no existence oracle), accept (action `guardian-accept` binding `invitation_id` — consent needs the seed key, not just the JWT), revoke (action `guardian-revoke` — deletes the share and withdraws standing votes), `GET /recovery/guardians`, `GET /recovery/guardianships`. Surface guardian count and effective quorum (`min(configured, active)`) together — an extra guardian raises the bar without adding a participant.

- [ ] **Task 18: Seed recovery — recovering-device side.** `POST /recovery/request` (public, unsigned — the caller lost the seed; **not retry-safe**, it creates a row per call) with a fresh ephemeral key pair for the session; poll `GET /recovery/session/{id}` every few seconds while on screen (sessions expire in 30 minutes); fetch `GET /recovery/vault`; on quorum, unwrap shares (PQXDH `usage=recovery-session`, recipient = own `user_address`), reconstruct the REK, decrypt the seed, then run the normal restore path (Task 10).

- [ ] **Task 19: Seed recovery — guardian side.** Poll `GET /recovery/sessions/pending` (~once a minute), `GET /recovery/share/{session_id}`, unwrap own share, re-wrap to the session's ephemeral key, submit via `POST /recovery/submit` (action `recovery-share-submit`, guardian's own second factor).

- [ ] **Task 20: PIN reset.** Owner: `request` / `revoke` / `confirm` (all signed, none takes a second factor — the owner lost the PIN; `confirm` signs the *new* token), 48h contest period surfaced in UI. Guardian: poll `GET /recovery/pin-reset/pending`, vote (action `pin-reset-vote`, guardian's second factor applies). Owner-side vote audit: `GET /auth/pin-reset/{id}/votes` returns semantic fields — rebuild `challenge:signed_timestamp:pin-reset-vote:request_id` and verify each signature client-side; never trust a server-rendered payload string.

## Milestone 4 — Succession

- [ ] **Task 21: Beneficiaries.** Register (action `beneficiary-register`; omit the snapshot fields and let the server copy the heir's enrolled keys — supplying them only adds a mismatch failure mode; re-registering refreshes and **drops that heir's wrapped shares**, surfaced from `dropped_shares`), list (`keys_rotated: true` means *the heir deleted their account* — render "remove them and choose another", never a re-wrap prompt), delete (action `beneficiary-delete`, cascades their shares).

- [ ] **Task 22: Inheritance shares** *(needs Task 12/13 for the owner-side unwrap)*. Assign: unwrap the item's DEK, PQXDH-wrap it to the heir's snapshot keys (`usage=succession-dek`), `POST /succession/shares` (action `share-assign`, args `beneficiary_id, item_id`). List per beneficiary; delete (action `share-delete`). `item_type` is `secret` only.

- [ ] **Task 23: Release votes and status.** Guardian: fetch `release_cycle` from `GET /succession/status` **immediately before** signing `succession-release-vote` (args: owner's `user_address`, cycle — a cycle-*n* signature is refused in cycle *n+1*). Owner: status renders only `monitoring` / `counting_down` (nothing writes the other states; `last_check_in` is not a live "last seen"); `GET /succession/votes` audited client-side by rebuilding `challenge:signed_timestamp:succession-release-vote:owner_address:release_cycle` per vote.

## Milestone 5 — Product shell and cleanup

- [ ] **Task 24: Onboarding.** Generate/import mnemonic (12/24 words, checksum validated with `bip39.validateMnemonic` before any derivation), PIN setup with the format rules, mode choice (Standard vs Paranoid — one-way door, say so), Recovery Kit surface for share 0.

- [ ] **Task 25: App shell.** Vault list from the meta listing; guardian inbox (pending recovery sessions + pending PIN resets, ~1-minute poll); succession dashboard within the Task 23 constraints. Respect every boundary in AGENTS.md § Product boundaries — no heir screens, no session list, no key-rotation flow, no UI waiting on unreachable states, no check-in configuration (that is on-chain).

- [ ] **Task 26: Delete the obsolete `src/` scaffolding.** Everything in the AGENTS.md obsolete-code table goes, including `src/lib/crypto.ts` and its environment `console.log`s. Nothing from it is extended or copied. Do this as domains are replaced, not as a big bang — but nothing obsolete survives past Milestone 5.

- [ ] **Task 27: Per-domain `README.md`.** Each module built above carries its README as the sole documentation (no comments in code). Written incrementally with each task; this task is the final audit that none is missing or stale.

---

## Cross-cutting rules (apply to every task)

- Never log, persist unencrypted, or transmit: seed phrase, private keys, DEKs, REK, PIN, `Server_Auth_Token` (except the token in the `password` field). Zero key material after use.
- Every mutating retry needs a fresh `{challenge, timestamp, signature}` — the challenge is consumed before the signature is checked, and a wrong PIN spends it too.
- Bad signature and wrong PIN are indistinguishable by design (`401 INVALID_CREDENTIALS`); render one generic message.
- When wire behaviour is ambiguous, the backend's tests are the tie-breaker: `../api-general/internal/domain/*/http/http_test.go` and `auth/service/service_test.go` (AGENTS.md § The API's own tests).
- A task is not done until its domain README is updated and its fixture/unit tests pass.

## Dependency graph

```
1 → 2 → 3 → 4,5,6 → 7 → 8 → 9 → 10 → 11
                              12 → 13 ─────────┐
                    14 → 15 → 16 → 17 → 18,19,20│
                              21 → 22 (also ← 13)
                              23
                    24,25 (after their domains) → 26 → 27
```

Milestone 2's Task 13 is the only externally blocked item (KEK spec, backend). Milestones 3 and 4 do not depend on it except Task 22's unwrap step — sequence around it rather than waiting.
