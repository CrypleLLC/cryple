# Cryple API — Front-End Integration Guide

What a client needs to know before it can call the Cryple API: what the API is, how to reach it, how to authenticate, and the behaviours that will surprise you if you meet them at runtime instead of here.

It describes the API **as implemented**, not as specified. Where the implementation and `.docs/` disagree, this file follows the code.

**The endpoints themselves are in [front-end-endpoints.md](./front-end-endpoints.md)** — every route, its request payload, its success response and its error responses. This file is the context that reference assumes; §5 in particular is where the `signature` field required by most request bodies comes from.

Section numbers are **not contiguous** — they are the original numbering from before the endpoint reference was split out, kept so that every `§N` reference in `.docs/` and the module READMEs still resolves. §3, §4 and §6–§13 live in the endpoint reference.

> **This file is a synced copy.** The authoritative original is
> `front-end-guide.md` in the `api-general` repository, which is where the API is
> implemented. The only differences between the two copies are relative link prefixes —
> a path that reads `.docs/…` there reads `../api-general/.docs/…` here. Re-sync by
> copying the file across and rewriting those prefixes. **Check them by hand** — the script
> that used to catch a prefix that did not get rewritten was removed on 2026-09-06.

---

## Table of Contents

- [1. What the API Is](#1-what-the-api-is)
- [2. Base URL, CORS and Transport](#2-base-url-cors-and-transport)
  - [Verbs](#verbs)
  - [Status codes](#status-codes)
  - [Retry safety](#retry-safety)
- [5. Authentication Model](#5-authentication-model)
  - [5.1 Identity values](#51-identity-values)
  - [5.2 Challenge signature (sign-up / sign-in)](#52-challenge-signature-sign-up--sign-in)
  - [5.3 Action signature (everything destructive)](#53-action-signature-everything-destructive)
  - [5.4 Standard Mode vs Paranoid Mode](#54-standard-mode-vs-paranoid-mode)
  - [5.5 JWT usage](#55-jwt-usage)
- [14. Client Implementation Notes and Caveats](#14-client-implementation-notes-and-caveats)

---

## 1. What the API Is

Cryple is an **encrypted personal drive**. Users store client-side-encrypted secrets, notes and long-form documents, authenticated by a BIP39 seed phrase rather than an email and a password.

The backend is **zero-knowledge by construction**:

- The server never receives plaintext data, seed phrases, private keys, PINs, or unwrapped data-encryption keys. Every `ciphertext`, `wrapped_dek`, `encrypted_label`, `encrypted_seed`, `pq_hybrid_encrypted_*` field is an **opaque string produced by the client**. The server stores and returns them verbatim; it never inspects or validates their contents beyond "non-empty".
- Authentication is by **ECDSA P-256 signature**, not by password. There is no email, no username registration, no session cookie.
- **All authentication failures on `/sign-up`, `/sign-in` and `/auth/verify` return `404 Not Found`** — deliberately, to prevent account enumeration. A `404` from those endpoints means "wrong address, wrong signature, stale challenge, replayed challenge, or wrong second factor" and the client cannot tell which.

The API surface is split into five domains: `auth`, `users`, `secrets` (the legacy-item store), `notes` and `documents` (long-form writing as a sealed snapshot plus an append-only delta log).

**Every caller is an owner acting on their own vault.** There is no route in this API where one account acts on another's data. That changes when private sharing lands; nothing today needs the distinction.

> **Digital inheritance left this API on 2026-09-03**, and **guardians, seed recovery and PIN reset left on 2026-09-04.** The `succession` and `recovery` domains, the heir read path, Merkle anchoring, every smart-account field and all fourteen recovery/PIN-reset routes are gone. They live on in the `dms-shamir` proof of concept. If you are reading an older revision of this guide, that is what changed.
>
> **The consequence a client must build for:** there is no account recovery of any kind. A lost seed phrase is terminal, and so is a forgotten PIN on a Paranoid account. Say so in onboarding **before** the PIN is set, not in a help page afterwards.

---

---

## 2. Base URL, CORS and Transport

| Item             | Value                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| Default port     | `8080` (`PORT` env var)                                                 |
| Local base URL   | `http://localhost:8080`                                                 |
| API version      | None. Paths are served exactly as written in this guide.               |
| Content type     | `application/json; charset=utf-8` on every response with a body         |
| Request body     | JSON. `Content-Type` is not enforced, but send `application/json`.      |
| Max body size    | **1 MiB** (`MAX_BODY_BYTES`). Larger requests get `400 INVALID_BODY`.   |
| Trailing slashes | Stripped by middleware — `/secrets/` and `/secrets` are the same route. |

**There is no version prefix.** Every route in this guide is written as `POST /sign-up` and that is exactly the path you send — concatenate it onto the bare host. A `/v1` prefix was carried briefly and **removed on 2026-08-08**; if your client still has `v1` in its base URL or route constants, drop it. Configure the base once as your client's base URL and concatenate the documented paths onto it, so that if a prefix ever returns it lands in one place rather than in every route constant.

There is no version header and no version field in the response body either. Should versioning arrive later it will be announced as a contract change, not discovered.

Two paths are **not** versioned: `GET /health` and `GET /ready`, which stay at the root because they answer to orchestrators rather than to clients. You should not be calling them either way ([§6](./front-end-endpoints.md#6-service-endpoints)).

**Every public endpoint takes at least 350 ms** (`AUTH_MIN_RESPONSE_MS`), on success and on every failure alike. That covers `/sign-up`, `/sign-in`, `/auth/verify` and `/users/lookup` — the only public routes left; the JWT-protected routes answer at their natural speed. The floor is deliberate — without it, "no such account" would return measurably faster than a real one and hand back exactly the information the uniform `404` withholds. Budget for it in polling loops and spinners, never treat it as latency to optimize around, and never infer anything from how long a public call took.

**Size budget.** The 1 MiB cap covers the whole JSON body, so a single secret's `ciphertext` must leave room for the other fields and for base64 inflation — budget roughly **700 KiB of plaintext** per item and you will not come close to the limit. An oversized body is rejected as `400 INVALID_BODY`, the same code as malformed JSON; there is no distinct "too large" status, so check the size client-side before sending if you need to tell the user which it was. Large binaries do not belong on this endpoint at all — the drive is where they go, and it is v1 scope but unbuilt (`storage-plan.md`).

CORS is **enabled by default** (`ENABLE_CORS=true`, `CORS_ALLOW_ORIGINS=*`) and sends:

```
Access-Control-Allow-Origin: *            (or your origin — see below)
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 3600
```

`PUT` and `PATCH` are both in use — see the verb rules below. `Allow-Headers` is exactly what the API reads: `Authorization` for the JWT, `Content-Type` for JSON. **No custom request headers are supported** — every value the API needs travels in the URL or the JSON body, so do not send `User-Address`, `Token` or anything else custom; a preflight would fail. (Earlier deployments advertised `User-Address` and `Token`; no handler ever read them.)

**Multiple origins are supported.** `CORS_ALLOW_ORIGINS` takes either `*` or a comma-separated list (`https://app.cryple.io,https://staging.cryple.io`). With a list, the server echoes back **your** origin when it matches and adds `Vary: Origin`; when it does not match, the response carries no `Access-Control-Allow-Origin` and the browser blocks it. There is no error body to read in that case — a CORS failure is a browser-side network error, so if requests fail before any status code arrives, check that your exact origin (scheme, host **and** port) is in the deployment's list. A malformed list is rejected at startup, so a running server always has a usable configuration.

**Credentials are never used.** The API authenticates with a `Bearer` token, not cookies, so `Access-Control-Allow-Credentials` is not sent — do not set `credentials: "include"` on `fetch`; with `Access-Control-Allow-Origin: *` the browser would reject the response.

### Verbs

The API is not uniformly `POST`. The rule it follows:

| Verb     | Meaning here                                                                                                          | Routes                                                                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | Creates something that did not exist.                                                                                 | `/sign-up`, `/sign-in`, `/auth/verify`, `/secrets`, `/notes`, `/users/second-factor` |
| `PUT`    | Idempotent full replacement of a singleton at a fixed URL. Sending it twice leaves the same state as sending it once. | `/users/password`, `/notes/{id}`, `/documents/{id}/key` |
| `PATCH`  | Transitions an existing record to a new state. Nothing is created; the target must already exist.                     | *(no route uses it today; the three that did left with recovery)* |
| `GET`    | Reads.                                                                                                                | everything else                                                                                                                                                                                                                                                              |
| `DELETE` | Removes.                                                                                                              | `/secrets/{id}`, `/secrets`, `/notes/{id}`, `/notes`, `/users` |

> ⚠️ **All fourteen recovery and PIN-reset routes now return `404`.** They were removed on 2026-09-04, not moved or renamed. A client still calling them is reading a stale revision of this guide.

### Status codes

Three rules cover every success response, so a shared HTTP helper can be written
once:

| Code  | Means                                                                                                                       | Where                                                                                                                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `201` | **Something was created by this call.**                                                                                     | `POST /sign-up` (new account), `POST /secrets`, `POST /notes` |
| `200` | A read, or a create-or-return call that **returned** rather than created. | every `GET`, `DELETE /secrets` (batch), `POST /sign-up` on an existing account, `POST /secrets` replaying an `id` that already exists |
| `204` | Succeeded, and there is **nothing to tell you**. No body at all.                                                            | `DELETE /secrets/{id}`, `DELETE /users`, `POST /users/second-factor`, `PUT /users/password` |

`201 ⇒ created` is now literally true, in both directions: the three endpoints
that can either create or return an existing row (`POST /sign-up`,
and `POST /secrets` when you supply `id`) report
`201` only when they created, and `200` when they did not. Branch onboarding,
"reset already in progress" and "this item was already saved" UI off the status
code rather than re-reading state.

**Two `DELETE`s answer `200` with a body, and that is deliberate**, not an
inconsistency to code around: `DELETE /secrets` (batch) must tell you how many of
the requested ids actually existed. Both are facts the client has to act on and
cannot derive. Every `DELETE` whose outcome is fully described by "it worked"
answers `204`. So the client rule is _"`204` or a body"_, never _"`DELETE` means
`204`"_.

### Retry safety

Mobile clients retry on timeout, so know which calls tolerate it. **Every retry
needs a fresh `{challenge, timestamp, signature}`** — challenges are single-use
and are consumed _before_ the signature is checked, so replaying the same triple
always fails ([§14.1](#14-client-implementation-notes-and-caveats)). With a fresh
signature:

| Endpoint                                                                                            | Retry after a timeout           | What a retry returns                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sign-up` / `POST /sign-in` / `POST /auth/verify`                                             | ✅ safe                         | A new token; `/sign-up` reports `200` the second time.                                                                                                                                                                                                            |
| `POST /secrets`                                                                                     | ✅ safe **if you sent `id`**    | `200` and the stored item, identical to the first response. Without `id`: ⚠️ a second item with a new id, and nothing dedupes them.                                                                                                                               |
| `DELETE /secrets/{id}`                                                                              | ⚠️ `404 NOT_FOUND`              | The first call succeeded. Treat `404` on a retry as **success**, not as a missing resource.                                                                                                                                                                       |
| `DELETE /users`                                                                                     | ⚠️ `401 INVALID_CREDENTIALS`    | Not `404`: the account row is gone, so the retry fails at the account lookup before anything else. Treat it as success — the token is now useless anyway.                                                                                                         |
| `DELETE /secrets` (batch)                                                                           | ✅ safe                         | `200` with `deleted: 0` — `requested` still counts the ids you sent.                                                                                                                                                                                              |
| `POST /users/second-factor`                                                                         | ⚠️ `401 INVALID_CREDENTIALS`    | **Ambiguous by design**, but now resolvable: the "already enrolled" check runs after the signature check, so a retry's `401` is indistinguishable from a genuine signature failure. Read `has_password` from `GET /users/me` instead of inferring it — see below. |
| `PUT /users/password`                                                                               | ✅ safe                         | `204`; the new hash simply replaces itself.                                                                                                                                                                                                                       |

> ⚠️ **`POST /users/second-factor` is the one call whose own response is
> ambiguous after a timeout.** A `401` means either "the retry was refused because
> enrolment already succeeded" or "your signature was wrong", and the API will not
> distinguish the two — reporting "a PIN already exists" to a caller holding only a
> seed key is exactly what Paranoid Mode is designed to refuse.
>
> **Resolve it with [`GET /users/me`](./front-end-endpoints.md#get-usersme--protected): `has_password: true`
> means the first call landed.** You already hold a JWT, so this costs one
> unfloored request and no challenge. (The older advice — attempt a `/sign-in`
> carrying the token — still works, but it burns a challenge and pays the 350 ms
> floor to learn less.) Never retry enrolment in a loop.

---

---

## 5. Authentication Model

### 5.1 Identity values

| Value                          | Format                                | Notes                                                                                                                                                                |
| ------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_address`                 | 64-char **lowercase hex**             | `SHA-256(seed)`. **Not** an Ethereum address. Rejected by regex `^[0-9a-f]{64}$`.                                                                                    |
| `public_key`                   | base64                                | DER **SPKI** encoding of the ECDSA **P-256** public key.                                                                                                             |
| `encryption_public_key_x25519` | base64                                | Opaque to the server; stored and served verbatim.                                                                                                                    |
| `encryption_public_key_mlkem`  | base64                                | Opaque to the server; stored and served verbatim.                                                                                                                    |
| `challenge`                    | 64-char lowercase hex                 | 32 random bytes, fresh per request, **single use**.                                                                                                                  |
| `timestamp`                    | integer                               | Unix **seconds**.                                                                                                                                                    |
| `signature`                    | base64                                | **64 raw bytes**, IEEE **P1363** (`r‖s`, 32 + 32). ASN.1/DER signatures are rejected.                                                                                |
| `password`                     | 64-char lowercase hex                 | The `Server_Auth_Token` — never the raw PIN. See [§5.4](#54-standard-mode-vs-paranoid-mode).                                                                         |
| `username`                     | string                                | Auto-assigned at sign-up: the first 12+ characters of `user_address`, extended until unique. There is no endpoint to change it. Resolve it with `GET /users/lookup`. |
| every `id`, `*_id`, `uuid`     | 36-char **lowercase hyphenated** UUID | Canonical form only — `3f2504e0-4f89-11d3-9a0c-0305e82c3301`. See the note below.                                                                                    |

> ⚠️ **Ids must be sent in canonical form, in the path and in the body.** The
> only accepted spelling is the 36-character lowercase hyphenated one, which is
> exactly what the API returns — echo back the string you were given and you can
> never get this wrong. The four other spellings some UUID libraries emit are all
> rejected with **`400 INVALID_PARAM`** before the request reaches the database:
>
> | Sent                                               | Result              |
> | -------------------------------------------------- | ------------------- |
> | `3f2504e0-4f89-11d3-9a0c-0305e82c3301`             | accepted            |
> | `urn:uuid:3f2504e0-…-3301`                         | `400 INVALID_PARAM` |
> | `{3f2504e0-…-3301}`                                | `400 INVALID_PARAM` |
> | `3f2504e04f8911d39a0c0305e82c3301` (unhyphenated)  | `400 INVALID_PARAM` |
> | `3F2504E0-4F89-11D3-9A0C-0305E82C3301` (uppercase) | `400 INVALID_PARAM` |
>
> This matters beyond tidiness on the signed routes: an id is part of the signed
> payload ([§5.3](#53-action-signature-everything-destructive)), so "what you
> send" and "what you sign" have to be the same bytes. One accepted spelling is
> what makes that rule unambiguous. If your language's UUID type stringifies to
> anything else (`System.Guid` uppercases, some libraries prefer the URN form),
> convert once at the edge of your HTTP layer rather than per call.

### 5.2 Challenge signature (sign-up / sign-in)

The signed payload is `challenge + ":" + timestamp` — **not** the raw challenge.

```js
const challenge = toHex(crypto.getRandomValues(new Uint8Array(32))); // 64 lowercase hex chars
const timestamp = Math.floor(Date.now() / 1000); // unix seconds
const payload = `${challenge}:${timestamp}`;

const sigBuf = await crypto.subtle.sign(
  { name: "ECDSA", hash: "SHA-256" },
  privateKey, // P-256, derived per .docs/crypto/ECDSA.md
  new TextEncoder().encode(payload), // WebCrypto hashes internally and outputs P1363
);
const signature = base64(new Uint8Array(sigBuf)); // 64 bytes → base64
```

Server-side checks, in order — any failure yields `404 NOT_FOUND`:

1. `user_address` matches `^[0-9a-f]{64}$`.
2. `challenge` matches `^[0-9a-f]{64}$`.
3. `|now − timestamp| ≤ AUTH_CHALLENGE_TTL_SECONDS` (**default 300s**, in _both_ directions — a future timestamp fails too).
4. The challenge is atomically claimed in Redis (`SET NX EX`). A second request with the same challenge is rejected as a replay — **before** any signature work.
5. The signature verifies against the stored (or supplied) public key.
6. The second factor matches the account's mode.

Because step 4 consumes the challenge, **you must generate a fresh challenge for every request**, including retries.

### 5.3 Action signature (everything destructive)

> ⚠️ **This section changed substantially on 2026-07-29 and is breaking.** Most mutating endpoints now require an action signature and, on Paranoid Mode accounts, the second factor alongside it. An old client gets `401 INVALID_CREDENTIALS`. See the rule below and the full table.
>

**The rule the API follows**, so you can predict any endpoint without looking it up:

> The JWT authorizes **reads and additions**. Anything that **destroys or replaces** existing data needs an action signature — plus `password` when the signing account is in Paranoid Mode.

So: `GET` anything and `POST /secrets` need only the token. Every `DELETE`, plus `PUT /users/password` and `POST /users/second-factor`, needs the seed key. Plan your UX around holding the unlocked key for the session, not prompting per action.

**Whose PIN?** The _signer's_. Every action today is signed by the account's own owner, so the two coincide — but the rule is the signer's, and that will matter again when private sharing adds an action one account signs against another's data.

Sensitive non-auth actions carry their own signature. The signed payload is a colon-joined string:

```
challenge : timestamp : action : arg1 : arg2 : ...
```

Same rules as above (hex-64 challenge, ±300s freshness, single-use nonce, SHA-256, P-256, P1363 base64). The `action` string and its arguments per endpoint:

| Endpoint                                | `action`                  | Arguments                               | Signing key   | Send `password` if Paranoid |
| --------------------------------------- | ------------------------- | --------------------------------------- | ------------- | --------------------------- |
| `POST /users/second-factor`             | `enable-second-factor`    | `new_password`                          | Account owner | no                          |
| `PUT /users/password`                   | `rotate-second-factor`    | `new_password`                          | Account owner | **yes**                     |
| `DELETE /users`                         | `account-delete`          | `user_address`                          | Account owner | **yes**                     |
| `DELETE /secrets/{id}`                  | `secret-delete`           | `{id}` from the path                    | Account owner | **yes**                     |
| `DELETE /secrets`                       | `secret-delete`           | every id, **sorted ascending**          | Account owner | **yes**                     |

The one row marked "no" is structural, not an oversight: `enable-second-factor` creates the second factor, so none exists yet to demand. Nine more rows were retired on 2026-09-04 with recovery and PIN reset; they are still specified in `dms-shamir`.

**Both remaining second-factor actions sign the new token itself**, not the intent, so nothing between you and the server can substitute a token of its own and leave the account with a second factor the attacker knows. That matters more than it used to: since there is no reset path, an account that comes out of enrolment with the wrong PIN is finished.

**`DELETE /secrets` is the only batchable action.** Sort the ids ascending and de-duplicate them, then sign them as consecutive arguments; the server rebuilds the payload the same way. Every other signature binds one target, so N deletions elsewhere means N signatures and N challenges.

**Two failure modes to handle:**

- A bad signature and a wrong PIN both return `401 INVALID_CREDENTIALS`, identically. You cannot tell them apart, by design — do not try to render a specific message.
- **The challenge is spent before the second factor is checked.** A wrong PIN burns it, so the retry needs a _fresh_ challenge, timestamp and signature. Retrying with the same triple always fails a second time for a different reason than the user thinks.

Example, deleting one item:

```js
const payload = `${challenge}:${timestamp}:secret-delete:${secretID}`;
```

> **Every row in the table is JWT-protected _and_ signed.** The signature sits on
> top of the bearer token, because a token alone can lock the real owner out
> beyond its own lifetime: enabling a second factor changes what sign-in
> requires, and since 2026-09-04 there is no reset path to undo it. Send the
> signature fields in the request body, alongside the `Authorization` header.
>
> Until 2026-09-04 four `pin-reset-*` rows were the exception — public routes
> with no token to fall back on, because their caller had lost the PIN by
> definition. They are gone, and **no unauthenticated mutating route remains.**

### 5.4 Standard Mode vs Paranoid Mode

|                              | Standard Mode                | Paranoid Mode                           |
| ---------------------------- | ---------------------------- | --------------------------------------- |
| Set at sign-up by            | omitting `password`          | sending `password`                      |
| `password` on later requests | must be **omitted or empty** | must be the correct `Server_Auth_Token` |
| Stored server-side           | `NULL`                       | Argon2id hash of the token              |

`Server_Auth_Token` derivation (frozen — see `.docs/auth/two-factor-PIN.md`):

```
Server_Auth_Token = hex( PBKDF2-HMAC-SHA256(
    password   = PIN,
    salt       = utf8(user_address),   // the 64-char hex STRING, i.e. 64 bytes — not the 32 raw bytes
    iterations = 600000,
    length     = 32 bytes ) )          // → 64 lowercase hex chars
```

The server validates the shape (`^[0-9a-f]{64}$`) before hashing; anything else is a credential failure. **Sending a `password` for a Standard-Mode account fails just as hard as omitting it for a Paranoid-Mode account.**

**Switching modes after sign-up.** A Standard-Mode account can turn Paranoid Mode on later via [`POST /users/second-factor`](./front-end-endpoints.md#post-userssecond-factor--protected); the reverse is not supported.

| Transition          | Endpoint                    | What you need                                                |
| ------------------- | --------------------------- | ------------------------------------------------------------ |
| Standard → Paranoid | `POST /users/second-factor` | JWT + an `enable-second-factor` signature over the new token |
| Rotate the token    | `PUT /users/password`       | JWT + the current token                                      |
| Token forgotten     | —                           | **No path exists.** The account is unreachable, permanently  |
| Paranoid → Standard | —                           | Not supported                                                |

The asymmetry is deliberate: adding a first PIN needs only the seed key, because in Standard Mode that key is already the account's whole authority. **Replacing a PIN that already exists never works with the seed key alone** — the second factor exists precisely to survive a compromised seed backup, so changing it requires the current token.

> ⚠️ **There is no third option, and a client must not imply one.** The guardian-gated reset was the escape hatch and it left on 2026-09-04. A user who enables Paranoid Mode and forgets the PIN loses the account even though they still hold the seed. Say this at the moment they turn it on, in words, and offer Standard Mode as the deliberate alternative rather than a lesser one.

**To find out which mode an account is in, read `has_password` from [`GET /users/me`](./front-end-endpoints.md#get-usersme--protected).** Cache it locally if you like, but do not depend on that cache: local state does not survive a reinstall, and "restore on a new device" is the normal path in a seed-phrase product, not an edge case. One authenticated call answers the question on first launch, so a client never has to guess whether to prompt for a PIN — or ask the user "did you set one?", which is exactly what someone restoring a lost device cannot reliably answer.

The mode is withheld from _unauthenticated_ callers, and that has not changed: a `404` from `/sign-in` still never says which factor was wrong. But a valid JWT is proof the second factor already passed, so telling that caller its own mode discloses nothing it did not just demonstrate.

### 5.5 JWT usage

`/sign-up`, `/sign-in` and `/auth/verify` return an `access_token`. Send it on every protected route:

```
Authorization: Bearer <access_token>
```

- Default lifetime **24 hours** (`JWT_EXPIRY_HOURS`).
- The token binds the `user_address`; there is no refresh endpoint — re-run the challenge flow.
- The middleware has no path allowlist: any missing/invalid/expired token on a protected route yields `401 UNAUTHORIZED` before the handler runs.

#### Session lifecycle — read this before designing your session UI

**A token is valid until it expires, and nothing can end it early.** The middleware checks two things: the HMAC signature and the `exp` claim. There is no server-side session record, no token id, no denylist, and no logout, revocation or refresh endpoint. Every consequence below follows from that one fact:

| Event                                                     | Effect on tokens already issued                                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Log out" in your UI                                      | **None server-side.** Delete the token from your own storage; that is the whole operation.                                                                                                          |
| `POST /users/second-factor` (Standard → Paranoid)         | None. Existing tokens keep working for their full lifetime.                                                                                                                                         |
| `PUT /users/password` (token rotation)                    | None. **This is not "changing your password ends your other sessions".**                                                                                                                            |
| `DELETE /users`                                           | The token still passes the middleware. The handler then cannot resolve the account, so calls fail with `401 INVALID_CREDENTIALS` (or `404 NOT_FOUND`, per endpoint) rather than `401 UNAUTHORIZED`. |
| Token expiry                                              | The only thing that actually ends a session.                                                                                                                                                        |

This is a deliberate MVP posture, not an oversight: a revocation list would be the first piece of server-side session state in a system whose entire design is "the server holds ciphertext and nothing else". The trade-off is stated plainly so you do not build a promise the API does not keep.

What this means for the client:

1. **Never tell the user that changing their PIN signed out their other devices.** It did not. If your UI shows a device or session list, it can only reflect what _this_ device knows.
2. **Treat the token as a bearer credential with a hard 24-hour tail.** Store it where a hostile script cannot read it, keep it out of URLs and logs, and drop it on logout. A leaked token is usable until `exp` no matter what the owner does afterwards.
3. **Shorten the window if the deployment wants one.** `JWT_EXPIRY_HOURS` is the only lever; a shorter value costs the user a fresh challenge signature more often (which is silent if the seed key is already unlocked on the device).
4. **Handle `401 UNAUTHORIZED` on any protected route as "session over"** — clear the token and restart the challenge flow. Do not retry with the same token.
5. **`401 INVALID_CREDENTIALS` is a different animal**: the token is fine, the account or second factor is not. Do not treat it as an expiry signal.

If a deployment later needs real revocation, it is a Redis denylist keyed by a token id added to the claims (`jti`) — the claims carry no such id today, so it is a protocol change to the token itself, not a middleware tweak.

---

---

## 14. Client Implementation Notes and Caveats

1. **One challenge per request.** Challenges are single-use and consumed _before_ signature verification. Retrying a failed request with the same `{challenge, timestamp, signature}` triple always fails. Generate fresh values on every attempt, including automatic retries.
2. **Clock skew is fatal.** A timestamp more than 300 seconds off in _either_ direction is rejected as `404`/`401`. If sign-in fails on an otherwise valid account, check the device clock first.
3. **Error responses carry no message.** Only `{"code":"…"}`. All user-facing copy has to be built client-side from the code plus the endpoint you called — validation detail such as _which_ share index was wrong is not transmitted. The single exception is a URL matching no route at all, which returns a `text/plain` `404` — if your HTTP layer parses every error body as JSON, guard that one case or check `content-type`, because it is the only body that is not JSON.
4. **A wrong verb is `405 METHOD_NOT_ALLOWED`, and the `Allow` header names the right one.** Read it in DevTools or `curl` when debugging: it names the verb the path actually accepts. It is not CORS-exposed, so `res.headers.get("Allow")` is `null` from script — by design, since a wrong verb is a bug to fix in your source, not a runtime condition to branch on. `405` is decided before the token is checked, so getting one without an `Authorization` header does not mean the route is public.
5. **`404` is overloaded on auth endpoints.** Never render "user not found" for a `404` from `/sign-up`, `/sign-in` or `/auth/verify` — that would defeat the anti-enumeration design. Use one generic "could not sign in" message.
6. **Every public endpoint takes ≥350 ms by design**, not just the auth ones — `/users/lookup` is floored too. Do not add timeouts below ~2 s, and do not surface response time to the user. Protected routes are not floored and answer at their natural speed.
7. **`/sign-up` on an existing address is a sign-in**, and the status code tells you which happened — `201` created, `200` already existed. Convenient for "restore on new device" flows: the same call works whether or not the account exists, and you can still branch onboarding off the status. **The three key fields must match what the account already has.** `public_key` is enforced implicitly — the signature is verified against the _stored_ key, so a drifted ECDSA derivation fails there. Since 2026-08-01 the two encryption keys are enforced explicitly: if `encryption_public_key_x25519` or `encryption_public_key_mlkem` differs from the stored value, the call is refused with the usual generic `404` **after** the signature verifies, and nothing is changed. This is not a rotation endpoint — there is no way to update encryption keys today, by design ([Task 63](../tasks.md)). If you hit this `404` on an account you know exists and a signature you know is right, your key derivation has drifted; the server log names which of the two keys mismatched. Re-derive from the seed rather than re-registering.
8. **`GET /users/{uuid}/public-keys` has no caller today, and that is not a bug.** It returns an account's X25519 + ML-KEM public keys. Its two consumers — heir DEK wrapping and guardian share wrapping — left with inheritance and with recovery; private sharing is what will use it next. Do not treat it, or `user_keys`, as dead.
9. **Every DELETE now requires a body.** It carries the action signature that authorizes the call, so `DELETE /users` and `DELETE /secrets/{id}` — which used to accept an absent body — now answer `400 INVALID_BODY` without one. Standard Mode accounts still omit `password`; they send the signature fields alone.
10. **The seed key is needed for everything destructive.** Every `DELETE`, plus `PUT /users/password` and `POST /users/second-factor`, requires an action signature on top of the JWT. Reads and `POST /secrets` need only the token. If your UI restores a session without unlocking the seed, every one of those screens has to prompt before it can act, so design for "unlock once per session" rather than "prompt per action". Only `DELETE /secrets` batches; everything else is one signature per target ([§5.3](#53-action-signature-everything-destructive)).
11. **There is no account recovery, and the UI is what makes that survivable.** Offer a printable Recovery Kit at onboarding, state before the PIN is set what a forgotten PIN costs in each mode, and prompt later to verify the backup while it is still cheap to fix.
12. **Second-factor mode is strict in both directions.** Sending `password` on a Standard-Mode account fails exactly like omitting it on a Paranoid-Mode account. Track the mode locally and mirror it on every request — and update your local record after a successful `POST /users/second-factor`, because from that moment sign-in requires the token.
13. **`version` is always `"v1"`.** Omit it, or send `"v1"`. Any other value is a `400`.
14. **Cross-user reads are `404`, not `403`.** A secret, note or document belonging to someone else is indistinguishable from one that does not exist.
15. **Only the auth endpoints enforce field-level validation.** `/sign-up`, `/sign-in` and `/auth/verify` run struct validation (missing required field ⇒ `400 INVALID_BODY`); the secrets, notes, documents and users handlers do not — missing fields surface later as `400 BAD_REQUEST`, `401 INVALID_CREDENTIALS` or `404 NOT_FOUND` from the service layer. Validate client-side rather than relying on a specific code.
17. **Poll, don't wait.** There are no webhooks, SSE or WebSocket channels. Nothing in the current API needs polling; the sharing inbox will be the first thing that does.
18. **Bodies are capped at 1 MiB and oversized ones return `400 INVALID_BODY`**, indistinguishable from malformed JSON. Check size client-side if you need to distinguish them. Idle connections are closed after 120s and a request that takes longer than 30s to send or receive is dropped — neither is reachable with normal payloads.
19. **Sessions cannot be ended early.** No logout, no revocation, no refresh — a token is valid for its full `JWT_EXPIRY_HOURS` and neither a PIN change nor account deletion invalidates one already issued. Logout means deleting your copy. See [§5.5](#55-jwt-usage); do not build a "sign out all devices" affordance on top of this API.
20. **No custom request headers.** `Access-Control-Allow-Headers` is `Content-Type, Authorization` and nothing else. If you are configuring a multi-origin deployment, every origin must be listed in `CORS_ALLOW_ORIGINS` exactly — scheme, host and port — or the browser blocks the response with no status code to inspect ([§2](#2-base-url-cors-and-transport)).
21. **The server never decrypts.** Every `*ciphertext*`, `*_dek`, `encrypted_*` and `pq_hybrid_*` field is produced and consumed exclusively by the client. If a flow seems to require the server reading one of them, the flow is being misread.
22. **Optional fields are absent, never `null`.** The server omits empty optional keys rather than serializing them as `null` — an unset optional simply disappears from the object. Type them optional (`?` / `| undefined`) and test with `in` or `!== undefined`. Code branching on `=== null` for any of these takes the wrong path on every response.
23. **There is no enumerations section any more.** The only enums that needed one were the release states and the recovery-session lifecycle, and both left with their domains. Every field that still has a closed set of values documents it at the endpoint that returns it.
24. **`401 INVALID_CREDENTIALS` can come back from a `GET` that has no body.** It means the JWT is well-formed but its account no longer resolves — most often because the account was deleted while a token was still live. Handle it as "start over from sign-in" on every `🔒` route, not just the ones that take a signature ([§4](./front-end-endpoints.md#4-error-codes)).
25. **Send ids exactly as you received them.** Only the canonical lowercase hyphenated UUID is accepted, in paths and in bodies alike; the URN, braced, unhyphenated and uppercase spellings are `400 INVALID_PARAM` ([§5.1](#51-identity-values)). If you round-trip ids through a UUID type, normalise once at the edge of your HTTP layer — and remember the same string goes into the signed payload on destructive calls.
26. **Know which retries are safe before you add a retry policy** ([§ Retry safety](#retry-safety)). Three traps: a retried `POST /secrets` **without an `id`** creates a second row; a retried `DELETE` reports a `404` that means _"already done"_, not _"failed"_; and a retried `POST /users/second-factor` returns a `401` you cannot tell from a real signature failure. Every retry also needs a fresh challenge (see note 1).
27. **`201` means created, `204` means "nothing to tell you", `200` means everything else** ([§ Status codes](#status-codes)). Do not key a helper on the verb: `DELETE /secrets` (batch) answers `200` with a `deleted` count you have to read, while `POST /sign-up` answers `200` when it returned an existing row instead of creating one.
28. **Ten lists page; `GET /secrets` and do not** ([§3.1](./front-end-endpoints.md#31-pagination)). Send `?limit=` (1–200, default 50) and follow `next_cursor` until `has_more` is `false` — a short page is not the last page, and a cursor is opaque, so never build or parse one yourself. The vault listing is the deliberate exception: it returns everything, and so does `?fields=meta`. Render the vault index from `?fields=meta` and fetch full ciphertext only when you need it; that listing's `ciphertext_sha256` is for change detection, **not** verification — hash the bytes you received.

