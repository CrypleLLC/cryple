# Cryple Web App — Agent Guide

Next.js 15 (App Router) client for the Cryple API. TypeScript, React 19, Tailwind v4.

## Read before writing code

Two sets of documents govern this client. They answer different questions and neither replaces the other.

| File | What it is |
| --- | --- |
| [front-end-guide.md](./front-end-guide.md) | Base URL, auth model, signatures, JWT, retry safety, 28 client caveats. **§5 is mandatory.** |
| [front-end-endpoints.md](./front-end-endpoints.md) | Every route, payload, response and error code. |
| [tasks.md](./tasks.md) | The integration task list — numbered, milestone-ordered, with acceptance criteria. Work from it. |

These two describe the API **as implemented** — the wire contract. They win over the current source and over anything you remember about this project. Cite the `§` you relied on when a change hinges on API behaviour.

The wire contract does not specify what goes *into* those fields. Every derivation, every constant, and every byte layout of a `ciphertext` / `wrapped_dek` / `pq_hybrid_*` value lives in the backend repo's `.docs/`, one directory up:

| File (relative to this repo: `../api-general/.docs/`) | What it settles |
| --- | --- |
| [crypto/ECDSA.md](../api-general/.docs/crypto/ECDSA.md) | **The frozen key tree.** seed → `user_address`, P-256 identity key, X25519, ML-KEM-768. |
| [crypto/test-vectors.json](../api-general/.docs/crypto/test-vectors.json) | Machine-checkable vectors for every derivation and the PQXDH wire blob. |
| [crypto/pqxdh.md](../api-general/.docs/crypto/pqxdh.md) | Hybrid X25519+ML-KEM wrapping — the exact bytes of every `pq_hybrid_*` field. |
| [crypto/key-continuity.md](../api-general/.docs/crypto/key-continuity.md) | Why re-sign-up must present the *same* encryption keys, and why keys are immutable. |
| [auth/challenge.md](../api-general/.docs/auth/challenge.md) | Challenge generation, timestamp binding, replay rules. |
| [auth/signed-actions.md](../api-general/.docs/auth/signed-actions.md) | The action-signature envelope and the **authoritative action table**. |
| [auth/two-factor-PIN.md](../api-general/.docs/auth/two-factor-PIN.md) | `Server_Auth_Token` derivation, PIN rules, **local seed encryption at rest**. |
| [auth/user-address.md](../api-general/.docs/auth/user-address.md) | `user_address` derivation and format. |
| [recovery-flow.md](../api-general/.docs/recovery-flow.md) | REK, Shamir parameters, guardian delivery paths, device-wipe policy. |
| [succession_protocol.md](../api-general/.docs/succession_protocol.md) | Heir DEK-wrapping machinery. |
| [onchain-architecture.md](../api-general/.docs/onchain-architecture.md) | ERC-4337 signer, heartbeat, and an explicit "what the chain does NOT do". |
| [pivot-scope.md](../api-general/.docs/pivot-scope.md) | What is in scope, cut, or postponed. |

**Precedence**: for a byte layout or a KDF constant, the frozen spec wins over the guide. For a status code, a field name, or a retry rule, the guide wins. Where they disagree on something else, the frozen spec is older — check `git log` on both before assuming. One known stale line: `auth/challenge.md` says the JWT expires in 8h; it is **24h** (`JWT_EXPIRY_HOURS` default in `../api-general/internal/utils/config/config.go`, and `front-end-guide.md` §5.5).

**The API's own tests are executable contract.** When a doc leaves wire behaviour ambiguous, the Go test suite in `../api-general/internal/` is the tie-breaker — it encodes exactly what a client will hit:

- `domain/auth/service/service_test.go` — the whole client-visible auth contract as tests: replayed challenges rejected, freshness in both directions, ASN.1/DER signatures rejected, signature bound to its timestamp / action / arguments, a sign-in signature refused as an action signature, mode mismatches failing symmetrically, every credential failure returning one indistinguishable error, restore-with-drifted-keys refused.
- `domain/*/http/http_test.go` — exact request/response shapes per route, which routes need a token, non-canonical UUID rejection, the 350 ms public-response floor, opaque `500`s.
- `domain/recovery/service/service_test.go` — `SetupDigest` is exported precisely so it can be cross-checked; `TestSetupDigest_*` pin share-order independence and every field the digest commits to. Port those two tests into this client's suite against your own digest implementation.

No Go test consumes `test-vectors.json` — the generator produces it and nothing re-reads it. **This client's fixture test is therefore the only cross-client check of the derivations**, which is one more reason it is not optional.

The four specs marked **FROZEN** (`crypto/ECDSA.md`, `crypto/pqxdh.md`, `auth/two-factor-PIN.md`, `onchain-architecture.md`) are Milestone 0 output. Every path, label, iteration count and version byte in them is part of account identity. **Do not change one, and do not "fix" one inline** — a divergent constant does not throw, it produces a different account or an unopenable blob, and the failure surfaces years later at inheritance release.

## The frozen key tree — implement exactly this

```
BIP39 mnemonic (12 or 24 words)
  │  PBKDF2-HMAC-SHA512(NFKD(mnemonic), "mnemonic"+passphrase, 2048, 64B) → seed
  │
  ├─ SHA-256(seed)                                          → user_address (64-char lowercase hex)
  ├─ SLIP-0010 P-256, m/9027'/0'/0'                          → ECDSA P-256 (API auth + ERC-4337 signer)
  ├─ HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|x25519",   L=32)  → X25519
  └─ HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|mlkem768", L=64)  → ML-KEM-768 (d‖z for FIPS 203 keygen)

  RESERVED, NEVER DERIVED:  m/44'/60'/…   — Cryple has no secp256k1 key and no EOA.
```

The traps, all of which produce a silently wrong account:

- **`user_address` hashes the 64 raw seed bytes**, not the mnemonic and not its hex string. The current `src/` hashes the hex string — that is the bug, not the spec.
- **SLIP-0010, not BIP32.** HMAC key is `"Nist256p1 seed"`, and the retry rules validate against **P-256's** order. Deriving with a secp256k1 library and reinterpreting the bytes is the exact mistake `crypto/ECDSA.md § Why Not BIP32` exists to stop.
- **Every level of the path is hardened.** `9027'`, `0'`, `0'`.
- **X25519: use the 32 output bytes as the scalar directly.** RFC 7748 clamping is inside the X25519 function — do not pre-clamp.
- **ML-KEM needs 64 bytes** because FIPS 203 consumes `(d‖z)`. That is why it is HKDF and not a 32-byte HD node; never invent an expansion step.
- **`public_key` on the wire is SPKI DER, base64** (always 124 chars). The on-chain form is raw `(X, Y)`, and the uncompressed point is `0x04‖X‖Y`. Three encodings of one key — mixing them is the common integration bug.

**Reproduce [`crypto/test-vectors.json`](../api-general/.docs/crypto/test-vectors.json) before this client touches real data.** It covers the all-`abandon` mnemonic end to end: seed, `user_address`, all three key pairs in every encoding, the `Server_Auth_Token`, and a full PQXDH blob. Add it as a fixture in the client's test suite — that is what "a new client is trusted" means here, and it is not optional.

Required dependencies not yet installed: `@noble/curves` (SLIP-0010 P-256 signing and X25519 — WebCrypto cannot import a raw EC private scalar) and `@noble/post-quantum` (ML-KEM-768). `@noble/hashes` and `bip39` are already present. WebCrypto covers SHA-256, HKDF, PBKDF2 and AES-256-GCM.

## PQXDH — the only way to wrap anything for someone else

Used for two things, and nothing else in MVP scope: succession DEK wrapping for heirs, and guardian share wrapping for recovery.

```
ephemeral   = fresh X25519 key pair, per wrapped payload
ecdhSecret  = X25519(ephemeralPriv, recipientX25519Pub)
kemSecret, kemCiphertext = ML-KEM-768.encapsulate(recipientMlkemPub)

IKM         = 0xFF×32 ‖ ecdhSecret ‖ kemSecret            (96 bytes, order normative)
salt        = 0x00×32
info        = "Cryple-PQXDH-v1|" ‖ usage ‖ "|" ‖ senderUserAddress ‖ "|" ‖ recipientUserAddress
sessionKey  = HKDF-SHA256(IKM, salt, info, L=32)

blob = 0x01 ‖ kemCiphertext(1088) ‖ ephemeralX25519Pub(32) ‖ iv(12) ‖ AES-256-GCM(sessionKey, iv, payload)   → base64
```

- **AES-256-GCM, not ChaCha20-Poly1305.** Earlier drafts named both; GCM won because ChaCha is absent from WebCrypto. No AAD — context binding lives in `info`.
- `usage` is one of `succession-dek`, `recovery-share`, `recovery-session`. Never reuse a label for a new purpose.
- Sender and recipient addresses in `info` are the 64-char lowercase hex strings, joined literally with `|`. For `recovery-session` the "recipient" is the recovering account's own `user_address`.
- **Reject unknown version bytes** rather than guessing, and check the blob length against the layout before attempting decryption.
- A fresh ephemeral key per payload is required — the blob must be self-contained, because an heir may need to open it after the owner's account is gone.

## The second factor and the seed at rest

Two **different** PBKDF2 usages, both from the PIN, and confusing them is the single easiest way to lock a user out:

```
Server_Auth_Token = hex(PBKDF2-HMAC-SHA256(PIN, salt=utf8(user_address), 600_000, 32))   → the `password` field
localWrapKey      = PBKDF2-HMAC-SHA256(PIN, salt=32 random bytes, 600_000, 32)           → never leaves the device
encrypted_seed    = { v: 1, salt, iv(12 random), ct: AES-256-GCM(localWrapKey, iv, seedPhrase) }
```

- The `Server_Auth_Token` salt is the **UTF-8 bytes of the 64-character hex string** — 64 bytes, not the 32 raw bytes it encodes. This is the most likely place for a client to diverge.
- The local salt is random **per device**, so the same PIN yields a different wrapping key on each device. That is correct; this value is never compared across devices. Keep the `v` KDF-version marker — a future move off PBKDF2 needs it to re-wrap old blobs.
- **PIN rules, enforced client-side**: exactly 6 ASCII digits; no ascending/descending sequence (`123456`, `654321`); no all-repeating digit (`111111`).
- **3 failed local PIN attempts wipes the device copy.** That is product policy from `recovery-flow.md`, not a suggestion — build it.
- 600k iterations is 0.3–1s on a laptop, several seconds on a low-end phone. Pay it **once per session** and hold the derived material in memory; a per-request derivation is a broken UX, and a per-request *prompt* is the wrong design (see the signature model below).
- The raw PIN never leaves the device in either mode.

**Mode transitions are one-directional.** Standard → Paranoid via `POST /users/second-factor` (action `enable-second-factor`, refused if a factor already exists). Paranoid → Paranoid via `PUT /users/password` (needs the current token) or the guardian-gated reset. **Paranoid → Standard does not exist** — never build a "disable PIN" affordance. The asymmetry is deliberate: the PIN's whole threat model is a compromised seed, so the seed key alone must never be able to replace a PIN that is already set.

## The current `src/` is obsolete — do not use it as a reference

The API was rewritten. Everything below in `src/` targets an API that no longer exists. Treat it as scaffolding to replace, never as a pattern to copy or extend.

| What the code does | Reality |
| --- | --- |
| `Authorization: Bearer ${userAddress}:${hash(password)}` | Auth is a JWT from `/sign-up` \| `/sign-in`, obtained with an ECDSA P-256 signature. |
| Calls `/users/check`, `/keys`, `/keys/{id}` | None of these routes exist. Legacy items live at `/secrets`. |
| Base URL without a version segment | Every path is under `/v1` (except `/health`, `/ready`). |
| `POST /sign-in` with `{user_address, password}` | Needs `challenge`, `timestamp`, `signature`; `password` is the `Server_Auth_Token`. |
| Reads `errorData.error`, and `data.id` at the top level | Success is `{message, data}`; errors are **only** `{"code":"…"}` — no message field. |
| `encrypted_key` / `encrypted_data` / `data_iv` / `key_iv` per item | A secret is `{id, ciphertext, wrapped_dek, version}`. There is a per-item DEK now. |
| Treats `201` as the only auth success | `/sign-up` returns `201` created / `200` already existed; both carry a token. |
| `sessionStorage.setItem('userPassword', plaintext)` | Never persist a plaintext secret. The seed is stored AES-GCM-wrapped under the PIN; key material is held in memory for the session. |
| 8-hour session tracked in `localStorage` | The JWT's own 24h `exp` is the session. Nothing can end it early — there is no logout, refresh or revocation endpoint. |
| `user_address = SHA-256(hex string of seed)` | `SHA-256` of the **64 raw seed bytes**. Different value, wrong account. |

`src/lib/crypto.ts` also ships uncommented `console.log` of the environment and API URL (lines 14–18). Remove, do not extend.

## What the client must now be able to do, and does not

Nothing below exists in `src/` yet. All of it is specified — build against the documents above rather than asking — except the owner-side DEK wrap, whose status is in §Resolved questions at the bottom.

1. **Seed → the full key tree**, reproducing `test-vectors.json`. Everything else depends on this being right, so it lands first with its fixture test.
2. **Signed-request helper.** Build the challenge/action envelope **once**, as one function, not per call site — it is the single hardest part and the most repeated.
3. **Session key custody.** Unlock the seed once per session, hold the derived signing key and `Server_Auth_Token` in memory, and sign from there. Design for "unlock once", never "prompt per action".
4. **PQXDH wrap/unwrap** for succession shares and guardian shares.
5. **Shamir secret sharing** over the REK for `PUT /recovery/setup`, split client-side, plus the `recovery-setup` digest below.
6. **JWT lifecycle**: store, attach, treat `401 UNAUTHORIZED` as session-over.
7. **Local seed vault**: PIN-wrapped `encrypted_seed`, 3-attempt wipe, PIN format rules.
8. Five product domains: `auth`, `users`, `secrets`, `recovery` (guardians, seed recovery, PIN reset), `succession` (beneficiaries, shares, release votes).

## Signed actions — the authorization rule

> **The JWT authorizes reads and additions. Anything that destroys or replaces existing data, and anything touching the guardian / inheritance / sharing graph, needs the seed key — plus the second factor when the signer is in Paranoid Mode.**

```
payload = <challenge> ":" <timestamp> ":" <action> [":" <arg> …]     colon-joined, SHA-256, P-256, IEEE P1363
```

Sign-in and sign-up omit the action and args (`challenge:timestamp`) — a two-field payload can never collide with a three-plus-field one, which is why no version byte is needed.

The **authoritative action list, with each action's argument order and whether it takes a second factor, is the table in [auth/signed-actions.md](../api-general/.docs/auth/signed-actions.md#actions)**. Read it rather than inferring from an endpoint name. What it makes non-obvious:

- **The signer's own mode decides.** When a guardian acts on someone else's account (`pin-reset-vote`, `recovery-share-submit`, `succession-release-vote`), it is the **guardian's** second factor that is demanded — never the owner's.
- **Three carve-outs take no second factor, structurally**: `enable-second-factor` (none exists yet), the owner's `pin-reset-request` / `-revoke` / `-confirm` (they lost the PIN), and `POST /recovery/request` (unsigned entirely — the caller lost the seed). Do not "fix" these.
- **`guardian-accept` needs a signature**, not just the JWT. Accepting is what releases the owner's identity to the guardian and what raises the owner's recovery quorum — a bearer token must not be able to forge the second leg of a consent handshake.
- **`succession-release-vote` binds `release_cycle`.** Fetch the current cycle from `GET /succession/status` before signing; a signature for cycle *n* is refused in cycle *n+1*.
- **`secret-delete` is the one batchable action.** Its ids are **sorted ascending and de-duplicated** before the payload is rebuilt, and `DELETE /secrets/{id}` is the one-element case of the same label.
- **`recovery-setup` signs a digest of the whole payload**, not an intent:

  ```
  canonical = encrypted_seed | n_shares | k_threshold | version
            | share_index ":" guardian_username ":" pq_hybrid_encrypted_share   (one per share, sorted by share_index)
  argument  = lowercase hex SHA-256(canonical)
  ```

  `version` is the literal string you send — **empty if you omitted it**, since the digest is computed before the server normalizes it to `v1`. Sign what you send. Share 0 has no guardian, so its middle field is empty.

- **The challenge is consumed before the second factor is checked**, so a wrong PIN spends it and the retry needs a fresh triple. Both legs return the same error, so a client cannot tell a bad signature from a wrong PIN — surface one generic message.

## API rules that will bite you

Derived from the guide and the specs; these are the ones a client gets wrong by default.

- **One challenge per request, always fresh.** It is consumed *before* the signature is verified, so every retry — including automatic ones — needs a new `{challenge, timestamp, signature}` triple.
- **Do not pre-hash before `crypto.subtle.sign`.** It applies SHA-256 to its data argument; hashing first signs `SHA-256(SHA-256(payload))` and every signature is rejected.
- **IEEE P1363 only** (64 raw bytes → base64). The ASN.1/DER fallback was removed.
- **Freshness window is ±300s in both directions.** A future timestamp fails too. Never fake or round the clock.
- **`password` is never the user's PIN and never a local unlock password** — it is the `Server_Auth_Token` above. Send it only on Paranoid Mode accounts; sending it on a Standard Mode account fails exactly as hard as omitting it on a Paranoid one. Read the mode from `has_password` on `GET /users/me` — never guess, never trust cached local state.
- **Every `DELETE` requires a JSON body** carrying the signature. An absent body is `400 INVALID_BODY`.
- **Errors carry no message.** All user-facing copy is built client-side from `code` + the endpoint called. A `404` from `/sign-up`, `/sign-in` or `/auth/verify` is deliberately ambiguous — render one generic "could not sign in", never "user not found".
- **`401 UNAUTHORIZED` (token expired) and `401 INVALID_CREDENTIALS` (account/second factor) are different.** Only the first means "sign in again from scratch"; the second can appear on a plain `GET`.
- **Re-running `POST /sign-up` is the documented restore-on-new-device path**, and it re-sends all three keys. The server compares the two encryption keys against the stored ones and returns the generic `404` if either differs. A `404` on restore with a correct signature therefore means **your derivation is wrong**, not that the account is missing — check against the test vectors first. Nothing is overwritten by the rejected call.
- **Keys are immutable; there is no rotation.** A mismatch is refused rather than accepted precisely because accepting would silently orphan every DEK guardians and heirs already wrapped to the old keys.
- **Optional fields are absent, never `null`.** Type them `?` / `| undefined` and test with `in` or `!== undefined`. `| null` takes the wrong branch on every response.
- **UUIDs are canonical lowercase hyphenated only**, in paths and bodies. Echo back exactly what the API gave you — the same string goes into the signed payload, so "what you send" and "what you sign" must be the same bytes.
- **Status codes**: `201` created, `204` nothing to say, `200` everything else. Do not key a helper on the verb — `DELETE /recovery/guardians/{id}` and `DELETE /secrets` (batch) both return `200` with a body you must read.
- **Retries are not uniformly safe** (guide § Retry safety). `POST /secrets` without a client-generated `id` and `POST /recovery/request` each create a second row; a retried `DELETE`/`PATCH` returns `404`/`409` meaning *already done*; `POST /users/second-factor` returns a `401` you cannot distinguish from failure — resolve it with `GET /users/me`.
- **Poll, don't wait.** No webhooks, SSE or WebSockets. Recovery sessions expire in 30 minutes (poll every few seconds while on screen); guardian inboxes poll on the order of a minute.
- **Public endpoints have a 350 ms response floor.** Never use timings as a signal; never set timeouts below ~2 s.
- **No custom request headers** — only `Content-Type` and `Authorization` are allowed by CORS. Never set `credentials: "include"`.
- **1 MiB body cap.** Budget ~700 KiB of plaintext per secret; oversized bodies return `400 INVALID_BODY`, same as malformed JSON.
- **Eight lists paginate; `GET /secrets` does not.** Follow `next_cursor` until `has_more` is `false` — a short page is not the last page. Cursors are opaque: never build, parse or persist one. Render the vault index from `GET /secrets?fields=meta`, and hash the ciphertext *you* received rather than trusting `ciphertext_sha256`.
- **Auth needs Redis server-side and it fails closed.** A total auth outage with valid credentials is an infrastructure symptom, not a client bug — do not add retry logic that hammers it.

## Recovery and succession shape

- **Seed recovery splits a REK, not the seed.** The seed is AES-GCM-encrypted under a Recovery Encryption Key; the REK is Shamir-split. Share 0 is the user's own Recovery Kit copy and always counts as one share, so **n = guardians + 1**. Default and recommended: **2-of-3** (user + either of two guardians).
- **k=1 with one guardian means that guardian alone can reconstruct the seed.** The setup UI must say so explicitly: *"This person can recover your vault on their own. Only choose someone you fully trust."*
- Guardians never see a plaintext share. The recovering device generates an ephemeral key pair per session; each guardian re-wraps their share to it with PQXDH `usage = recovery-session`. The server is a relay.
- Even colluding guardians cannot open a Paranoid Mode vault — they reconstruct the seed but still need the PIN for a JWT.
- Quorum is `min(configuredMinimum, activeGuardians)`, so a forced or accidental extra guardian **raises the owner's bar without adding a participant**. Surface the guardian count and the effective quorum together.

## Product boundaries — do not build these

- **No heir-facing screens.** Nothing lets a named beneficiary discover, accept, decline or claim an inheritance. Before release that is permanent by design; after release the routes are unbuilt and their paths unsettled.
- **No "sign out all devices" / session list.** The API has no revocation. Logout means deleting your own copy of the token.
- **No key rotation flow, and no "disable PIN".** Rotation is a protocol change (backend Task 63), not an endpoint. `keys_rotated: true` means the heir *deleted their account* — surface "remove them and choose another", never a re-wrap prompt.
- **No UI waiting on `released`, `cancelled` (release trigger) or `completed` (recovery session).** No code path writes them; they need a chain indexer that does not exist. `GET /succession/status` only ever reads `monitoring` or `counting_down`, and `last_check_in` is not a live "last seen".
- **Check-in / dead-man's-switch configuration is on-chain**, not in this API.
- **Nothing from `.docs/storage-plan.md`.** The file vault is postponed post-MVP; it is the one `.docs` file that is not a build target.

## Conventions

- **No comments in code.** Documentation belongs in a `README.md` per domain/module; names carry the meaning. `src/lib/crypto.ts` is the counter-example — it predates this rule.
- The server is zero-knowledge. Every `ciphertext`, `wrapped_dek`, `encrypted_*`, `pq_hybrid_*` field is produced and consumed exclusively here. If a flow seems to need the server reading one, the flow is being misread.
- Never log, persist unencrypted, or send to the server: the seed phrase, private keys, DEKs, the PIN, or the `Server_Auth_Token`. Zero `sessionKey`, `ecdhSecret`, `kemSecret` and ephemeral private keys after use.
- Path alias `@/*` → `./src/*`. TypeScript `strict` is on.
- Branches: `development` → `staging` → `preview` → `main`. Work off `development` unless told otherwise.
- `NEXT_PUBLIC_BASE_API_URL` points at the API **including `/v1`**; default `http://localhost:8080/v1`. Configure it once — never sprinkle `v1` through route constants.

## Commands

```bash
npm run dev       # next dev --turbopack
npm run build
npm test          # vitest run
npm run test:watch
npm run lint      # eslint, flat config
npm run lint:fix
```

CI runs typecheck, lint (`--max-warnings 0`) and tests on every push and PR.

**Lint is ESLint 9 flat config** (`eslint.config.mjs`), extending `next/core-web-vitals` and `next/typescript`. Two rules exist because of this project's threat model rather than style, and both carry their reasoning in the failure message:

- **`no-console` is an error.** The cross-cutting rule is "never log the seed phrase, private keys, DEKs, the PIN, or the `Server_Auth_Token`" — and the deleted `src/lib/crypto.ts` logged the environment and API URL. A blanket ban is the only version of that rule a linter can enforce.
- **`no-restricted-globals` blocks `localStorage` and `sessionStorage`.** Only the seed vault may reach persistent storage, and only for one PIN-encrypted blob. `src/lib/pin/**` and `src/lib/app/mode-hint.ts` are the two exemptions; adding a third needs a reason that survives §Conventions.

Tests are Vitest (`environment: 'node'`, matching `src/**/*.test.ts` only — so `.tsx` component tests would need jsdom and a testing library that are deliberately not installed). Keep testable product logic in framework-free modules, as `src/lib/app` does.

Regenerating the vectors is a backend operation (`go run ./tools/cryplevectors` in `../api-general`) and is **idempotent**. If its output differs from the committed file, a protocol constant changed — that is a breaking change to every user's keys, not a fix. This client only ever *reads* that file.

## Resolved questions, and the one remaining spec gap

Earlier revisions of this file carried open questions. All but one are answered by `../api-general/.docs/` and the API source; the resolutions are recorded here so they are not re-asked.

- **Seed → `user_address`, seed → keys, fate of the local unlock password**: resolved by the frozen specs, inlined in the sections above.
- **Free vs Premium gating: do not build any.** The API has no tier, plan, or entitlement concept anywhere — no config field, no enforcement, nothing on the wire. The only server-side rule on recovery setup is `1 ≤ k_threshold ≤ n_shares` (`recovery/service/service.go`). The Free-tier-1-guardian / Premium-k-of-n split in `recovery-flow.md` is product-plan copy, not API behaviour. Build k-of-n configuration as the API supports it; keep the k=1 trust warning, which is a safety requirement, not a tier.

**The one gap: the KEK that produces the owner's own `wrapped_dek` for `POST /secrets`.** This is confirmed unspecified, and deliberately so:

- The frozen key tree derives exactly four things — `user_address`, P-256, X25519, ML-KEM — and no symmetric wrapping key. PQXDH scopes itself to wrapping *for someone else*.
- `storage-plan.md` §3.1.1 says it outright: *"do not invent a KEK path here — if the vault needs a dedicated wrapping key, its derivation belongs in that spec [`crypto/ECDSA.md`], with test vectors."* Backend Task 59 deferred the decision there; nothing has landed.
- The server treats `wrapped_dek` as fully opaque (`front-end-endpoints.md`: "Opaque. Must be non-empty."), so nothing server-side will ever catch a divergent client derivation — it fails silently, per item, forever.

**Resolution path, not a user question**: the derivation is a one-paragraph addition to `crypto/ECDSA.md` plus regenerated test vectors, made in the backend repo — the obvious shape is another HKDF leaf under the existing `Cryple-Key-v1|…` labelling scheme, but **the label and construction are the backend spec's to choose, never this client's**. Until that lands, build the `secrets` domain behind a single `wrapDek` / `unwrapDek` seam so the derivation slots in without touching call sites. Everything else — key tree, auth, recovery, succession — is fully specified and unblocked.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> Note: this installation is Next `15.5.9` and has **no** `node_modules/next/dist/docs/` directory, so the instruction above cannot be followed as written. Verify App Router APIs against the installed package or the official docs.
