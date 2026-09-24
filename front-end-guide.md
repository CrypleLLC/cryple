# Cryple API — Front-End Integration Guide

What a client needs to know before it can call the Cryple API: what the API is, how to reach it, how to authenticate, and the behaviours that will surprise you if you meet them at runtime instead of here.

It describes the API **as implemented**, not as specified. Where the implementation and `docs/` disagree, this file follows the code.

**The endpoints themselves are in [front-end-endpoints.md](./front-end-endpoints.md)** — every route, its request payload, its success response and its error responses. This file is the context that reference assumes; §5 in particular is where the `signature` field required by most request bodies comes from.

Section numbers are **not contiguous** — they are the original numbering from before the endpoint reference was split out, kept so that every `§N` reference in `docs/` and the module READMEs still resolves. §3, §4 and §6–§13 live in the endpoint reference.

> **This file is a synced copy.** The authoritative original is
> `front-end-guide.md` in the `api-general` repository, which is where the API is
> implemented. The only differences between the two copies are relative link prefixes —
> a path that reads `docs/…` there reads `../api-general/docs/…` here. Re-sync by
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
- Authentication is by **ECDSA P-256 signature**, not by password. There is no email, no username registration, no session cookie. **Since 2026-09-21 the seed is a cold root and each device signs with its own key** ([docs/crypto/device-keys.md](../api-general/docs/crypto/device-keys.md)); §5 below is written for that model.
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
| API version      | None. Paths are served exactly as written in this guide.                |
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

| Verb     | Meaning here                                                                                                          | Routes                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `POST`   | Creates something that did not exist.                                                                                 | `/sign-up`, `/sign-in`, `/auth/verify`, `/secrets`, `/notes`, `/devices/enrol` |
| `PUT`    | Idempotent full replacement of a singleton at a fixed URL. Sending it twice leaves the same state as sending it once. | `/users/username`, `/notes/{id}`, `/secrets/keys`, `/connections/{id}/keys`    |
| `PATCH`  | Transitions an existing record to a new state. Nothing is created; the target must already exist.                     | _(no route uses it today; the three that did left with recovery)_              |
| `GET`    | Reads.                                                                                                                | everything else                                                                |
| `DELETE` | Removes.                                                                                                              | `/secrets/{id}`, `/secrets`, `/notes/{id}`, `/notes`, `/users`                 |

> ⚠️ **All fourteen recovery and PIN-reset routes now return `404`.** They were removed on 2026-09-04, not moved or renamed. A client still calling them is reading a stale revision of this guide.

### Status codes

Three rules cover every success response, so a shared HTTP helper can be written
once:

| Code  | Means                                                                     | Where                                                                                                                                 |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `201` | **Something was created by this call.**                                   | `POST /sign-up` (new account), `POST /secrets`, `POST /notes`                                                                         |
| `200` | A read, or a create-or-return call that **returned** rather than created. | every `GET`, `DELETE /secrets` (batch), `POST /sign-up` on an existing account, `POST /secrets` replaying an `id` that already exists |
| `204` | Succeeded, and there is **nothing to tell you**. No body at all.          | `DELETE /secrets/{id}`, `DELETE /users`, `POST /oprf/account/enable`, `POST /keyrings/wraps`                                          |

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

| Endpoint                                                | Retry after a timeout        | What a retry returns                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sign-up` / `POST /sign-in` / `POST /auth/verify` | ✅ safe                      | A new token; `/sign-up` reports `200` the second time.                                                                                                               |
| `POST /secrets`                                         | ✅ safe **if you sent `id`** | `200` and the stored item, identical to the first response. Without `id`: ⚠️ a second item with a new id, and nothing dedupes them.                                  |
| `DELETE /secrets/{id}`                                  | ⚠️ `404 NOT_FOUND`           | The first call succeeded. Treat `404` on a retry as **success**, not as a missing resource.                                                                          |
| `DELETE /users`                                         | ⚠️ `401 INVALID_CREDENTIALS` | Not `404`: the account row is gone, so the retry fails at the account lookup before anything else. Treat it as success — the token is now useless anyway.            |
| `DELETE /secrets` (batch)                               | ✅ safe                      | `200` with `deleted: 0` — `requested` still counts the ids you sent.                                                                                                 |
| `POST /devices/enrol`                                   | ⚠️ `400 INVALID_BATCH`       | The first call landed, so the batch's head is stale. Read `GET /devices` with the token you would have received, or sign in with the new device; do not enrol again. |
| `POST /oprf/account/enable`                             | ⚠️ `401 INVALID_CREDENTIALS` | Ambiguous by design. **Resolve it with `GET /users/me`: `paranoid: true` means the first call landed.** Never retry enrolment in a loop.                             |
| `POST /oprf/devices/{id}/evaluate`                      | ⚠️ spends an attempt         | Every evaluation counts against `OPRF_DEVICE_MAX_ATTEMPTS`. Do not auto-retry.                                                                                       |

---

---

## 5. Authentication Model

### 5.1 Identity values

| Value                      | Format                                | Notes                                                                                                                                                               |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_address`             | 64-char **lowercase hex**             | `SHA-256(seed)`. **Not** an Ethereum address. Rejected by regex `^[0-9a-f]{64}$`.                                                                                   |
| `public_key` (sign-up)     | base64                                | DER **SPKI** of the **root** P-256 key (`m/9027'/0'/0'`), 124 characters.                                                                                           |
| `device_id`                | UUID                                  | Generated by the client at enrolment. The device's identity from then on.                                                                                           |
| device keys                | base64                                | Each device's own P-256 signing key (SPKI), X25519 key (32 bytes) and ML-KEM-768 key, generated on the device. Keep them non-extractable where the platform allows. |
| `challenge`                | 64-char lowercase hex                 | 32 random bytes, fresh per request, **single use**.                                                                                                                 |
| `timestamp`                | integer                               | Unix **seconds**.                                                                                                                                                   |
| `signature`                | base64                                | **64 raw bytes**, IEEE **P1363** (`r‖s`, 32 + 32). ASN.1/DER signatures are rejected.                                                                               |
| `pin_proof`                | base64                                | Paranoid accounts, root actions only: an Ed25519 signature from the OPRF-derived `account-proof` key. See [§5.4](#54-standard-mode-vs-paranoid-mode).               |
| `key_generation`           | integer                               | The keyring generation a `wrapped_dek` is sealed under. Must be the scope's current one on every write.                                                             |
| `username`                 | string                                | Auto-assigned at sign-up, changeable with `PUT /users/username`. Resolve an address with `GET /users/lookup`, a name with `GET /users/resolve`.                     |
| every `id`, `*_id`, `uuid` | 36-char **lowercase hyphenated** UUID | Canonical form only — `3f2504e0-4f89-11d3-9a0c-0305e82c3301`. See the note below.                                                                                   |

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

### 5.2 Who signs what

**The seed is a cold root, and each device has its own key**
([docs/crypto/device-keys.md](../api-general/docs/crypto/device-keys.md)). A client must never store the seed.

| Request                                                              | Signed by      | Payload                                                                                  |
| -------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `POST /sign-up`                                                      | the **root**   | `challenge:timestamp`, plus a genesis batch of root-signed chain statements              |
| `POST /sign-in`, `/auth/verify`                                      | the **device** | `challenge:timestamp`                                                                    |
| device actions (deletes, username, sharing)                          | the **device** | `challenge:timestamp:action[:arg…]`                                                      |
| root actions (`device-enrol`, `account-delete`, the Paranoid routes) | the **root**   | `challenge:timestamp:action[:arg…]`, plus `pin_proof` on Paranoid accounts               |
| chain statements (`POST /devices/batch`, enrolment, sign-up)         | root or device | the statement itself ([§19](./front-end-endpoints.md#19-devices-and-keyrings-endpoints)) |

Every signature is ECDSA P-256 over SHA-256 of the payload, IEEE P1363. **Typing the seed** means
rebuilding the root key and the root wrap key for one request, then discarding them. Do it for
sign-up, enrolment and account-level actions only.

### 5.3 Action signature (everything destructive)

> The JWT authorizes **reads and additions** within the device's scopes. **Destroying data needs a
> full device's signature. Destroying or re-keying the account needs the root**, plus the PIN proof
> on Paranoid accounts.

- Each item domain's routes need the device to hold its **scope**. A device without it gets `404`,
  as if the item did not exist.
- **Deletes need a full device**, one holding `admin`, and are signed by it. A limited device, such
  as a browser in phase 2 or the password extension, cannot delete.
- The full table of actions and arguments is
  [docs/auth/signed-actions.md](../api-general/docs/auth/signed-actions.md). Batch deletes sort and
  de-duplicate the ids before signing, exactly as before.
- **The challenge is spent before anything else is checked.** Every retry needs a fresh
  challenge, timestamp and signature.

### 5.4 Standard Mode vs Paranoid Mode

|                         | Standard                                                                           | Paranoid                                               |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Device PIN              | yes — unlocks this device's local keys, rationed by the server (`/oprf/devices/*`) | yes, the same                                          |
| Account PIN             | none                                                                               | yes — required as `pin_proof` on **every root action** |
| What a stolen seed does | enrols a device, and then has the account                                          | nothing, without the account PIN                       |

**Getting a proof.** Call `POST /oprf/account/evaluate` with a root-signed blinded PIN, unblind, and
derive the `account-proof` key with Argon2id and HKDF
([docs/auth/pin-oprf.md](../api-general/docs/auth/pin-oprf.md)). Then sign the root action's digest with it. The
evaluation always answers, with a fake evaluation for a Standard account or a throttled attempt, so
a wrong proof is how a client finds out, never an error.

| Transition            | Routes                                                                     | Authorized by                               |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| Standard → Paranoid   | `POST /oprf/account/begin`, then `/enable`                                 | a full device and the root                  |
| Change the PIN        | `/begin` (with the current proof), then `/rotate` (with the current proof) | a full device, the root and the current PIN |
| Paranoid → Standard   | —                                                                          | **Not supported, ever.**                    |
| Forgotten account PIN | —                                                                          | **No path exists.** The account is lost     |

> ⚠️ **There is no third option, and a client must not imply one.** A user who enables Paranoid
> Mode and forgets the account PIN loses the account even though they still hold the seed. Say
> this at the moment they turn it on, in words, and offer Standard Mode as the deliberate
> alternative rather than a lesser one.

**To find out which mode an account is in, read `paranoid` from
[`GET /users/me`](./front-end-endpoints.md#get-usersme--protected).**

**A forgotten device PIN is recoverable**: after `OPRF_DEVICE_MAX_ATTEMPTS` the registration is
deleted, `evaluate` answers `404`, and the user re-enrols the device with the seed.

### 5.5 JWT usage

`/sign-up`, `/sign-in`, `/auth/verify` and `/devices/enrol` return `{ access_token, device_id }`.
Send the token on every protected route:

```
Authorization: Bearer <access_token>
```

- Default lifetime **24 hours** (`JWT_EXPIRY_HOURS`). There is no refresh endpoint: sign in again
  with the device key, which is silent once the device is unlocked.
- **The token names the device, and the API checks on every request that the device is still
  enrolled.**

| Event                           | Effect on tokens already issued                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "Log out"                       | Delete the token. To make the device forget the account for good, remove it (`device-remove` of itself). |
| Another device removes this one | **Every token of this device is `401 UNAUTHORIZED` on its next request.**                                |
| `DELETE /users`                 | Every device is gone, so every token is `401 UNAUTHORIZED`.                                              |
| Changing the PIN                | None.                                                                                                    |
| Token expiry                    | Sign in again.                                                                                           |

- **Handle `401 UNAUTHORIZED` as "this device's session is over"**: clear the token and sign in
  again. If sign-in also fails, the device was removed; re-enrol with the seed.
- **`401 INVALID_CREDENTIALS`** means a signature or proof was refused. Do not treat it as an expiry.

---

---

## 14. Client Implementation Notes and Caveats

1. **One challenge per request.** Challenges are single-use and consumed _before_ signature verification. Retrying a failed request with the same `{challenge, timestamp, signature}` triple always fails. Generate fresh values on every attempt, including automatic retries.
2. **Clock skew is fatal.** A timestamp more than 300 seconds off in _either_ direction is rejected as `404`/`401`. If sign-in fails on an otherwise valid account, check the device clock first.
3. **Error responses carry no message.** Only `{"code":"…"}`. All user-facing copy has to be built client-side from the code plus the endpoint you called — validation detail such as _which_ share index was wrong is not transmitted. The single exception is a URL matching no route at all, which returns a `text/plain` `404` — if your HTTP layer parses every error body as JSON, guard that one case or check `content-type`, because it is the only body that is not JSON.
4. **A wrong verb is `405 METHOD_NOT_ALLOWED`, and the `Allow` header names the right one.** Read it in DevTools or `curl` when debugging: it names the verb the path actually accepts. It is not CORS-exposed, so `res.headers.get("Allow")` is `null` from script — by design, since a wrong verb is a bug to fix in your source, not a runtime condition to branch on. `405` is decided before the token is checked, so getting one without an `Authorization` header does not mean the route is public.
5. **`404` is overloaded on auth endpoints.** Never render "user not found" for a `404` from `/sign-up`, `/sign-in` or `/auth/verify` — that would defeat the anti-enumeration design. Use one generic "could not sign in" message.
6. **Every public endpoint takes ≥350 ms by design**, not just the auth ones — `/users/lookup` is floored too. Do not add timeouts below ~2 s, and do not surface response time to the user. Protected routes are not floored and answer at their natural speed.
7. **`/sign-up` answers `201` once.** A retry of the same genesis answers `200` with a token for the same device; anything else on an existing address is `404`. **A new device on an existing account enrols** (`POST /devices/enrol`) or is linked from another device, and never signs up.
8. **`GET /users/{uuid}/public-keys` returns a proof, not just keys.** Verify the proof path against the counterparty's pinned root key before encrypting to the keys it announces.
9. **Every DELETE requires a body.** It carries the signature that authorizes the call.
10. **The device key signs everything destructive; the root signs only account-level actions.** Unlock the device once per session. Prompt for the seed only to enrol, to delete the account, or to change the account PIN ([§5.3](#53-action-signature-everything-destructive)).
11. **There is no account recovery, and the UI is what makes that survivable.** Offer a printable Recovery Kit at onboarding, state before the PIN is set what a forgotten PIN costs in each mode, and prompt later to verify the backup while it is still cheap to fix.
12. **The PIN proof is strict in both directions.** Sending `pin_proof` on a Standard account fails exactly like omitting it on a Paranoid one. Read `paranoid` from `GET /users/me`.
13. **`version` is always `"v1"`.** Omit it, or send `"v1"`. Any other value is a `400`.
14. **Cross-user reads are `404`, not `403`.** A secret, note or document belonging to someone else is indistinguishable from one that does not exist.
15. **Only the auth endpoints enforce field-level validation.** `/sign-up`, `/sign-in` and `/auth/verify` run struct validation (missing required field ⇒ `400 INVALID_BODY`); the secrets, notes, documents and users handlers do not — missing fields surface later as `400 BAD_REQUEST`, `401 INVALID_CREDENTIALS` or `404 NOT_FOUND` from the service layer. Validate client-side rather than relying on a specific code.
16. **Poll, don't wait.** There are no webhooks, SSE or WebSocket channels. Nothing in the current API needs polling; the sharing inbox will be the first thing that does.
17. **Bodies are capped at 1 MiB and oversized ones return `400 INVALID_BODY`**, indistinguishable from malformed JSON. Check size client-side if you need to distinguish them. Idle connections are closed after 120s and a request that takes longer than 30s to send or receive is dropped — neither is reachable with normal payloads.
18. **Removing a device ends its sessions at once.** A device list with a "remove" action is real: the removed device's tokens stop working on their next request ([§5.5](#55-jwt-usage)).
19. **No custom request headers.** `Access-Control-Allow-Headers` is `Content-Type, Authorization` and nothing else. If you are configuring a multi-origin deployment, every origin must be listed in `CORS_ALLOW_ORIGINS` exactly — scheme, host and port — or the browser blocks the response with no status code to inspect ([§2](#2-base-url-cors-and-transport)).
20. **The server never decrypts.** Every `*ciphertext*`, `*_dek`, `encrypted_*` and `pq_hybrid_*` field is produced and consumed exclusively by the client. If a flow seems to require the server reading one of them, the flow is being misread.
21. **Optional fields are absent, never `null`.** The server omits empty optional keys rather than serializing them as `null` — an unset optional simply disappears from the object. Type them optional (`?` / `| undefined`) and test with `in` or `!== undefined`. Code branching on `=== null` for any of these takes the wrong path on every response.
22. **There is no enumerations section any more.** The only enums that needed one were the release states and the recovery-session lifecycle, and both left with their domains. Every field that still has a closed set of values documents it at the endpoint that returns it.
23. **A `404` on a route you expect to work may be a scope.** A limited device gets `404` for the routes of scopes it lacks and for deletes. Check the device's scopes before reporting "not found" to the user.
24. **Send ids exactly as you received them.** Only the canonical lowercase hyphenated UUID is accepted, in paths and in bodies alike; the URN, braced, unhyphenated and uppercase spellings are `400 INVALID_PARAM` ([§5.1](#51-identity-values)). If you round-trip ids through a UUID type, normalise once at the edge of your HTTP layer — and remember the same string goes into the signed payload on destructive calls.
25. **Know which retries are safe before you add a retry policy** ([§ Retry safety](#retry-safety)). Three traps: a retried `POST /secrets` **without an `id`** creates a second row; a retried `DELETE` reports a `404` that means _"already done"_, not _"failed"_; and a retried `POST /oprf/account/enable` returns a `401` you cannot tell from a real signature failure. Every retry also needs a fresh challenge (see note 1).
26. **`201` means created, `204` means "nothing to tell you", `200` means everything else** ([§ Status codes](#status-codes)). Do not key a helper on the verb: `DELETE /secrets` (batch) answers `200` with a `deleted` count you have to read, while `POST /sign-up` answers `200` when it returned an existing row instead of creating one.
27. **Ten lists page; `GET /secrets` and do not** ([§3.1](./front-end-endpoints.md#31-pagination)). Send `?limit=` (1–200, default 50) and follow `next_cursor` until `has_more` is `false` — a short page is not the last page, and a cursor is opaque, so never build or parse one yourself. The vault listing is the deliberate exception: it returns everything, and so does `?fields=meta`. Render the vault index from `?fields=meta` and fetch full ciphertext only when you need it; that listing's `ciphertext_sha256` is for change detection, **not** verification — hash the bytes you received.
