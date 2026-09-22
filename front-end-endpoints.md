# Cryple API — Endpoint Reference

Every HTTP endpoint the server exposes: the exact request payload it accepts, the success response it returns, and every error response it can produce.

This describes the API **as implemented**, not as specified. Where the implementation and `.docs/` disagree, this file follows the code.

**Read [front-end-guide.md](./front-end-guide.md) first.** It carries what you need before any call here will work: the base URL, CORS and transport limits, how to build the challenge and action signatures that most of these endpoints require in their request body, JWT usage, and the client caveats. This file assumes all of it. Paths below are served exactly as written — the API has no version prefix.

Section numbers are **not contiguous** — they are the original numbering from before this file was split out of the guide, kept so that every `§N` reference in `.docs/` and the module READMEs still resolves. §1, §2, §5 and §14 live in the guide. §12 (Notes) and §16 (Documents) were added after the split and took free numbers rather than topical ones, for the same reason: renumbering would break every existing reference. §10 and §11 held recovery and PIN reset, and are kept as a single removal notice rather than reused.

> **2026-09-21: the device model and the PIN OPRF** ([.docs/crypto/device-keys.md](../api-general/.docs/crypto/device-keys.md),
> [.docs/auth/pin-oprf.md](../api-general/.docs/auth/pin-oprf.md)). **Every client must be rebuilt against this
> version.**
> - **The seed is a cold root.** `/sign-up` carries a genesis batch.
> - **Each device has its own key.** `/sign-in` names a `device_id` and is signed by that device.
>   The JWT names the device, and **a removed device's token is `401 UNAUTHORIZED` at once**.
> - **Scopes.** A device only reaches the routes of the scopes it holds (`404` otherwise).
>   Deletes need a full device (one holding `admin`).
> - **Key generations.** Every `wrapped_dek` write carries `key_generation`: `409
>   STALE_KEY_GENERATION` when it is not the scope's current one.
> - **No `password` anywhere.** Paranoid mode's PIN is a proof over an OPRF, only on the routes
>   the root signs (§8, §19, §20).
> - **New sections:** §19 (devices and keyrings) and §20 (the PIN).

> **This file has a synced copy** in the `web-app` repository. The only differences are
> relative link prefixes — a path that reads `.docs/…` here reads `../api-general/.docs/…`
> there. When you change this file, copy it across and rewrite those prefixes. **Check them by
> hand** — the script in that repo that used to catch a prefix that did not get rewritten was
> removed on 2026-09-06.

---

## Table of Contents

- [3. Response Envelopes](#3-response-envelopes)
  - [3.1 Pagination](#31-pagination)
  - [3.2 Timestamps](#32-timestamps)
- [4. Error Codes](#4-error-codes)
- [6. Service Endpoints](#6-service-endpoints)
- [7. Auth Endpoints](#7-auth-endpoints)
- [8. Users Endpoints](#8-users-endpoints)
- [9. Secrets Endpoints](#9-secrets-endpoints)
- [10–11. Recovery and PIN Reset Endpoints — removed](#1011-recovery-and-pin-reset-endpoints-removed-2026-09-04)
- [12. Notes Endpoints](#12-notes-endpoints)
- [16. Documents Endpoints](#16-documents-endpoints)
- [17. Files Endpoints](#17-files-endpoints)
- [18. Sharing Endpoints](#18-sharing-endpoints)
- [19. Devices and Keyrings Endpoints](#19-devices-and-keyrings-endpoints)
- [20. PIN Endpoints (OPRF)](#20-pin-endpoints-oprf)

---

## 3. Response Envelopes

### Success

Every non-`204` success response uses this envelope:

```json
{
  "message": "Secrets retrieved successfully",
  "data": {}
}
```

- `message` — human-readable, stable per endpoint. Do not branch on it.
- `data` — the payload; object, array, or omitted entirely when empty.
- `page` — **paginated list endpoints only** ([§3.1](#31-pagination)). Absent everywhere else.

Endpoints that return `204 No Content` send **no body at all**.

### 3.1 Pagination

Eight list endpoints are paginated. They accept two optional query parameters
and add a `page` object to the envelope:

```
GET /notes?limit=25&cursor=bzoyNQ

{
  "message": "Notes retrieved successfully",
  "data": [ /* up to `limit` rows */ ],
  "page": { "next_cursor": "bzo1MA", "has_more": true }
}
```

| Parameter | Default | Rule                                                                                                     |
| --------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `limit`   | `50`    | Integer `1`–`200`. Zero, negative, non-numeric or over `200` is `400 INVALID_PARAM`.                     |
| `cursor`  | none    | **Opaque.** Send back a `next_cursor` this API gave you, verbatim. Anything else is `400 INVALID_PARAM`. |

Paginated: `GET /notes`.

Rules worth building to:

- **Loop until `has_more` is `false`.** On the last page `has_more` is `false`
  and `next_cursor` is absent. Do not stop because a page came back short: a
  page can legitimately be shorter than `limit`.
- **Never construct, parse or persist a cursor.** It encodes a position today
  and may encode something else tomorrow; that change is explicitly allowed to
  happen without notice, and it is only safe because the token is opaque.
- **On the two vote reports, `page` describes `data.votes`**, not `data` — those
  responses are an object wrapping a `votes` array, and the array is what pages.
- **`GET /secrets` is not paginated in either form.** The client is expected to
  need every item at once. Use
  [`?fields=meta`](#get-secretsfieldsmeta) to render the index cheaply.
- A rejected `limit` or `cursor` is refused before anything is read, so a `400`
  here never means a partial result.

### 3.2 Timestamps

Every timestamp field the API returns — `created_at`, `updated_at`,
`expires_at`, `voted_at`, and the rest — is **RFC 3339 in UTC,
with a `Z` suffix**:

```json
"created_at": "2026-07-26T12:00:00Z"
```

These are **instants, not local times**. The server does not know your user's
timezone and never asks for it. Render in the device's zone at display time and
the value is correct everywhere — including for a user who travels between zones
and for a user reading their vault from a different country:

```js
new Date(secret.created_at).toLocaleString(); // renders in the device's zone
```

Do not strip the `Z`, and do not re-interpret the string as a local time — both
turn a correct instant into one that is wrong by the device's offset.

Timestamps your client **sends** are the opposite format: **unix seconds** as a
JSON integer (`"timestamp": 1785000000`), never a formatted string
([§5.2](./front-end-guide.md#52-challenge-signature-sign-up--sign-in)).

### Error

Every error response from a route that exists is this, and only this:

```json
{ "code": "NOT_FOUND" }
```

The one exception is a **URL that matches no route at all**, which the router
answers with `404` and a `text/plain` body (`404 page not found`). That is a
client bug you will hit on the first request and never again, so it is left as
the router's default rather than dressed up as JSON. A **wrong verb on a real
path** is not in that category — see `405` below — and does return the envelope.

> ⚠️ **There is no `message` or `error` field on error responses, and this is deliberate.** The server builds a machine-readable `code` and drops the human-readable message. Service-level validation text (e.g. `"expected 3 shares, got 2"`) exists in the backend but **never reaches the client** — it is logged server-side only, because account creation is free and unrestricted, so any detail sent to "an authenticated user" is detail sent to an attacker.
>
> Two consequences for the client:
>
> - **Map `code` + the endpoint you called to your own copy.** The codes are unambiguous per endpoint — see each endpoint's error table below.
> - **Validate payloads locally before sending.** Every structural rule the server enforces (share counts, thresholds, index uniqueness, required fields) is checkable from data the client already holds. A `400` from these endpoints means the client has a bug, not that the user needs a message.

---

---

## 4. Error Codes

| HTTP | `code`                | When                                                                                                                                                                                                                                                                               |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `INVALID_BODY`        | Body is absent, unreadable, or not valid JSON.                                                                                                                                                                                                                                     |
| 400  | `BAD_REQUEST`         | Body parsed, but a field is missing/invalid, or a business rule rejected it.                                                                                                                                                                                                       |
| 400  | `INVALID_PARAM`       | An id — in the path **or** in the body — is not a canonical lowercase hyphenated UUID ([§5.1](./front-end-guide.md#51-identity-values)), or a query parameter is missing/malformed: an out-of-range `limit`, an unrecognised `cursor` ([§3.1](#31-pagination)), or a `fields` value other than `meta`. |
| 400  | `INVALID_BATCH`       | §7 sign-up and §19 only: a device batch or genesis broke a chain or completeness rule. The message says which. Only callers who already proved the root, or who hold a device JWT, can reach it. |
| 401  | `UNAUTHORIZED`        | Missing, malformed, expired or invalid `Authorization: Bearer` token, **or a valid token whose device has been removed**. Start over: sign in with another device, or re-enrol with the seed. |
| 401  | `INVALID_CREDENTIALS` | A device signature or a root signature failed to verify, a PIN proof was wrong or missing, **or the JWT is valid but its account no longer exists**. |
| 404  | `NOT_FOUND`           | Resource does not exist or is not yours; **the calling device lacks the route's scope, or is not full on a delete**; **or** authentication failed on an auth endpoint. |
| 405  | `METHOD_NOT_ALLOWED`  | The path exists but does not accept this verb.                                                                                                                                                                                                                                     |
| 409  | `CONFLICT`            | The resource is not in a state that accepts the request.                                                                                                                                                                                                                                                                                                                               |
| 409  | `STALE_KEY_GENERATION` | A `wrapped_dek` (or a sharing sub-key or address book) sealed under a generation that is not the scope's current one. Re-read `GET /keyrings`, re-wrap under the current generation, and retry. |
| 409  | `TOO_MANY_DEVICES`    | §19 only: the account already has `DEVICES_MAX_PER_ACCOUNT` active devices. |
| 413  | `BAD_REQUEST`         | `POST /files` only ([§17](#17-files-endpoints)): the declared object exceeds `FILES_MAX_OBJECT_BYTES`. **Note the code is `BAD_REQUEST`, not a code of its own** — branch on the status, not the code, to tell this from an ordinary field rejection.                                                                                                                                    |
| 429  | `TOO_MANY_REQUESTS`   | Four budgets. Per client address: one shared by the public routes (`/sign-up`, `/sign-in`, `/auth/verify`, `/users/lookup`, `/devices/enrol`, `/devices/enrol/chain`, `/oprf/account/evaluate`), one on the device PIN routes (`/oprf/devices/{id}/evaluate`, `/confirm`), and one shared by `PUT /users/username` and `GET /users/resolve`. Per account: one on `POST /files`. The address or account sent more requests than that budget allows in the current window. `Retry-After` is the number of seconds to wait. **It says nothing about the account** — do not show it as an authentication failure, and do not retry before `Retry-After`. |
| 500  | `INTERNAL_ERROR`      | Unexpected server/database failure. Safe to retry once.                                                                                                                                                                                                                            |
| 503  | `SERVICE_UNAVAILABLE` | The per-address budgets above only — `POST /files` lets the request through instead: the rate limiter could not reach its store, so the request was refused rather than let through unmetered. Retry after a short wait. |
| 503  | `NOT_READY`           | `GET /ready` only ([§6](#6-service-endpoints)): a dependency did not answer. Never returned by any other endpoint.                                                                                                                                                                 |
| 507  | `QUOTA_EXCEEDED`      | `POST /files` only ([§17](#17-files-endpoints)): the account has no storage left for this upload. The only `5xx` in this file that is **not** a server fault and must not be retried unchanged.                                                                                     |

Codes defined but not currently emitted by any handler: `DATABASE_ERROR`, `EMPTY_BODY`, `FORBIDDEN`.

`USER_NOT_FOUND` is a fifth: it exists only in a defensive branch of
`DELETE /users` that cannot fire, because the root verification fails first with
`401 INVALID_CREDENTIALS`. Earlier versions of
this guide listed it as a `DELETE /users` response — **do not branch on it.** A
delete that cannot find the account answers `401 INVALID_CREDENTIALS`, the same
code as a wrong PIN.

> **`401 INVALID_CREDENTIALS` is reachable on every protected route, including plain `GET`s that take no body.** Almost every protected handler starts by resolving the JWT's `user_address` back to an account row, and a failure there is reported as `INVALID_CREDENTIALS`, never `UNAUTHORIZED`. Since 2026-09-21 a deleted account's tokens fail earlier, with `401 UNAUTHORIZED`, because its devices are gone. `INVALID_CREDENTIALS` on a plain `GET` now means only a race with that deletion. The per-endpoint tables below list it wherever it applies; treat it as always possible on a `🔒` route and handle it as "start over from sign-in", distinct from a `401 UNAUTHORIZED` expiry. The only protected route without this path is `GET /users/{uuid}/public-keys`, which looks up the _subject_, not the caller.

**`405` always carries an `Allow` header** with the verbs that path does accept, as one comma-separated value:

```
HTTP/1.1 405 Method Not Allowed
Allow: GET, POST
Content-Type: application/json; charset=utf-8

{"code":"METHOD_NOT_ALLOWED"}
```

Two things to know about it. It is decided **before** the token is checked, so a wrong verb returns `405` even with no `Authorization` header — do not read that as "this route is public". And `Allow` describes the routing table, not intent: a literal path segment that also matches a sibling `{id}` pattern is reported under both, so the header can name a verb you did not expect. Treat it as a debugging aid, not as a route description.

---

---

## 6. Service Endpoints

All public, no authentication. Like every other route they sit at the server root, so the full path is `http://localhost:8080/health`.

| Method | Path      | Response                                                   |
| ------ | --------- | ---------------------------------------------------------- |
| `GET`  | `/health` | `200` `{"message":"OK"}`                                   |
| `GET`  | `/ready`  | `200` `{"message":"OK"}` — or `503` `{"code":"NOT_READY"}` |

There are exactly two, and they answer different questions. **`/health` is
liveness**: the process is up and the router works. It is static, so it stays
`200` even when the database is unreachable — that is deliberate, since a
restart would not fix a broken dependency. **`/ready` is readiness**: it checks
that Postgres and Redis actually answer, within roughly 3 seconds, and reports
`503 NOT_READY` when either does not.

> **Neither is for clients.** They exist for the orchestrator's probes. A `503`
> on `/ready` says this instance is out of rotation, not that the API is down;
> do not surface it to the user or branch on it.

**`GET /` and `GET /status` were removed on 2026-07-31** and now answer `404`.
They used to be aliases of the same static handler. If anything probes either
one, repoint it at `/health`.

Prometheus metrics are served on a **separate port** (`METRICS_PORT`, default `80`), disabled unless `METRICS_ENABLE=1`.

---

---

## 7. Auth Endpoints

Public. Like every public endpoint, both are **timing-padded to at least 350 ms** (`AUTH_MIN_RESPONSE_MS`) on success and failure alike — see [§2](./front-end-guide.md#2-base-url-cors-and-transport). Do not treat slow responses as errors, and do not use response time as a signal.

### `POST /sign-up`

Creates the account and its **genesis**, signed by the **root**: the seed's P-256 key at `m/9027'/0'/0'`. The format of the batch is [device-keys.md](../api-general/.docs/crypto/device-keys.md).

**Request**

```json
{
  "user_address": "3f1c…64 hex chars…",
  "public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…",
  "challenge": "7f3b…64 hex chars…",
  "timestamp": 1785000000,
  "signature": "base64 of 64 raw bytes, by the root over challenge:timestamp",
  "batch": {
    "events": [
      { "statement": "Cryple-Chain-v1|<user_address>|1|000…0|device-add|<device_id>|<signing spki>|<x25519>|<mlkem>|admin,passwords,secrets,notes,documents,files,sharing", "signer": "root", "signature": "…" },
      { "statement": "Cryple-Chain-v1|<user_address>|2|<hash 1>|sharing-keys|1|<x25519>|<mlkem>", "signer": "root", "signature": "…" },
      { "statement": "Cryple-Chain-v1|<user_address>|3|<hash 2>|keyring-rotate|passwords=1,secrets=1,notes=1,documents=1,files=1,sharing=1", "signer": "root", "signature": "…" }
    ],
    "wraps": [
      { "scope": "secrets", "generation": 1, "recipient": "root", "wrapped_key": "sealed(root wrap key, KEK)" },
      { "scope": "secrets", "generation": 1, "recipient": "<device_id>", "wrapped_key": "PQXDH device-keyring blob" }
    ],
    "materials": [ { "scope": "sharing", "generation": 1, "sealed_material": "sealed(sharing KEK, x25519 priv ‖ mlkem seed)" } ]
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `user_address` | ✅ | 64 lowercase hex. |
| `public_key` | ✅ | The **root** key, base64 DER SPKI, P-256. Must be the key that produced `signature` and every genesis event. |
| `challenge`, `timestamp`, `signature` | ✅ | The root over `challenge:timestamp`, single use, within ±300 s. |
| `batch` | ✅ | Exactly three events: `device-add` (the first device, which must hold `admin`), `sharing-keys` generation 1, `keyring-rotate` of every keyring scope to 1. Plus a wrap of every generation to the root and to the device for each scope it holds, and the `sharing` material. |

**There is no second factor at sign-up.** Paranoid mode is turned on afterwards (§20).

**`201 Created`**

```json
{
  "message": "Account created",
  "data": { "access_token": "eyJhbGciOiJIUzI1NiIs…", "device_id": "<the genesis device>" }
}
```

**`200 OK`**: the address already had an account, the root signature verified against the **stored** key, and the batch's first `device_id` is already a device of that account. This is a retry. Nothing is written, and the token is for that device.

**Errors**

| Status | `code` | Cause |
| --- | --- | --- |
| 400 | `INVALID_BODY` | Empty or invalid JSON, or a required field missing. |
| 400 | `INVALID_BATCH` | The root signature verified, the address is new, but the genesis breaks a rule. The message names it. |
| 404 | `NOT_FOUND` | Bad address format; stale or replayed challenge; invalid signature; an address that exists under another root key or whose retry names an unknown device. |
| 500 | `INTERNAL_ERROR` | Database failure. |

### `POST /sign-in`

### `POST /auth/verify`

Identical handlers. **A device signs in with its own key.** The seed and the root are not involved.

**Request**

```json
{
  "device_id": "<uuid>",
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64 P1363, by the device's signing key over challenge:timestamp"
}
```

**`200 OK`**: `{"access_token", "device_id"}`, the same envelope as `/sign-up`. The token names the device.

**Errors:** `400 INVALID_BODY` · `404 NOT_FOUND` for an unknown or removed device, a bad signature, or a stale or replayed challenge, all alike · `500`.

**There is no PIN on sign-in.** The device's PIN unlocks its local keys, and the server rations it through the device's OPRF registration (§20). The account PIN of a Paranoid account gates only what the root signs.

---

---

## 8. Users Endpoints

### `GET /users/me` — 🔒 protected

Your own account, as the API sees it. Takes no parameters: the account is the one in the JWT, so this endpoint cannot be pointed at anybody else.

**`200 OK`**

```json
{
  "message": "Account retrieved successfully",
  "data": {
    "user_address": "3f1c…64 hex chars",
    "username": "3f1c8a2b9d4e",
    "uuid": "0c892e57-93cf-423a-a9e9-fee5a9f87681",
    "paranoid": false,
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

| Field          | Notes                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `user_address` | The `SHA-256` of the seed you authenticated with. Useful to confirm the client derived the account you expected. |
| `username`     | The account's **current** username ([§8](#8-users-endpoints)); this is how one account addresses another. Assigned automatically at sign-up and changeable through `PUT /users/username`. |
| `uuid`         | Your public identifier — what a contact feeds to `GET /users/{uuid}/public-keys` (§19).                          |
| `paranoid`     | **`true` = Paranoid Mode**, `false` = Standard Mode. Always present, never omitted.                              |
| `created_at`   | Account creation.                                                                                                |

**Call this on first launch after a restore.** `paranoid` is the one fact a client cannot derive and cannot safely cache: it decides whether to prompt for a PIN, and a reinstall wipes local state. The alternative — probing `/sign-in` and reading the `404` — burns a challenge, costs the 350 ms floor, and returns the same `404` for a wrong PIN, a wrong seed and a nonexistent account. See [§5.4](./front-end-guide.md#54-standard-mode-vs-paranoid-mode).

It is also how you confirm a `POST /oprf/account/enable` that timed out actually landed.

**Deliberately not here:** anything the account has configured. This endpoint answers "who am I", not "what have I set up".

**Errors:** `401 UNAUTHORIZED` (missing or invalid token) · `404 NOT_FOUND` (the token is valid but the account no longer exists — it was deleted; treat it as signed out) · `500 INTERNAL_ERROR`.

### `GET /users/lookup?address={user_address}` — public

Resolves an address to that account's **current** username.

| Param     | In    | Required | Notes                        |
| --------- | ----- | -------- | ---------------------------- |
| `address` | query | ✅       | Must match `^[0-9a-f]{64}$`. |

**`200 OK`**

```json
{
  "message": "Username retrieved successfully",
  "data": { "username": "3f1c8a2b9d4e" }
}
```

**Errors:** `400 INVALID_PARAM` (missing/malformed address) · `404 NOT_FOUND` (no such user, or user has no username).

This is the **inverse** of `GET /users/resolve` below and is public, because its only key is a `user_address` — presenting a valid one already proves possession of the seed it derives from. A `users.uuid` proves nothing, which is why the reverse direction is behind the JWT.

### `PUT /users/username` — 🔒 protected

Claims a username and makes it the account's current one.

**An account holds a set of usernames and displays one.** A rename **adds** a name and never
releases the previous one, so nobody else can take a name this account has used, and the owner can
switch back at any time by claiming it again — there is no separate reclaim call.

```json
{
  "username": "pedrosilva",
  "challenge": "...",
  "timestamp": 1785000000,
  "signature": "..."
}
```

| Field | Notes |
| --- | --- |
| `username` | **Normalised before signing**: lowercased and trimmed. Must match `^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$` — ASCII only |
| signed action | `username-update`, one argument: the normalised username, signed by **the calling device**, which must be full (`404` otherwise) |

⚠️ **Sign the normalised form, not what the user typed.** The server normalises again before
verifying the signature, so signing the raw input produces a well-formed request that fails with
`401 INVALID_CREDENTIALS` — a formatting mistake wearing an authentication error's clothes.

**`204 No Content`** on success.

**Errors:** `400 INVALID_PARAM` (fails the format) · `401 INVALID_CREDENTIALS` (device signature) ·
`404 NOT_FOUND` (a limited device) · **`422 USERNAME_UNAVAILABLE`** · `429 TOO_MANY_REQUESTS` (the sweep budget shared with
`GET /users/resolve`, below).

⚠️ **The `422` is the same answer whoever holds the name.** A name held by another account returns
it identically whether that account currently displays it or merely reserved it by renaming away.
**Do not render a message that speculates about which** — the server does not tell you, on purpose.

### `GET /users/resolve?username={username}` — 🔒 protected

Resolves a username to an account. This is the direction safe sharing addresses a recipient in.

| Param | In | Required | Notes |
| --- | --- | --- | --- |
| `username` | query | ✅ | Normalised client-side first, same rule as above |

**`200 OK`**

```json
{
  "message": "Account resolved successfully",
  "data": { "uuid": "0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e", "username": "pedrosilva" }
}
```

Returns the `uuid` and nothing else — not the `user_address`, not a public key, not anything the
account has configured. Feed the `uuid` to `GET /users/{uuid}/public-keys`.

**Errors:** `404 NOT_FOUND` · `429 TOO_MANY_REQUESTS`.

⚠️ **Only the current username resolves**, and the `404` is deliberately ambiguous: a name nobody
ever held, a malformed name, and a name someone renamed away from all return it. **Never render it
as "this user does not exist"** — that claims something the server did not say, and the ambiguity is
what stops an old name being used to confirm an account's new one.

Floored by `AUTH_MIN_RESPONSE_MS` like `/users/lookup`, so a `404` is never measurably faster than a
hit.

⚠️ **This route and `PUT /users/username` share a per-address budget** — 30 requests an hour by
default, counted across both, whichever account sends them. Resolve when the user submits a name,
never as they type. A `429` carries `Retry-After`, which can be most of an hour: show when to try
again rather than retrying.

### Moved on 2026-09-21

- **`GET /users/{uuid}/public-keys`** is now answered by the devices domain, with a different
  body: the root key, the current sharing generation and the proof path. See §19.
- **`POST /users/second-factor` and `PUT /users/password` are gone.** Paranoid mode is turned on
  and rotated under `/oprf/account/*` (§20), with an OPRF-derived proof key instead of a
  `Server_Auth_Token`.

### `DELETE /users` — 🔒 protected

Deletes the account and, by cascade, every device, keyring, event, PIN registration, item, connection and share. **Irreversible.** Needs a **full device** (`404` otherwise) **and the root**: the seed must be typed for this, so a stolen device cannot destroy the account.

**Request**

```json
{
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363, by the ROOT over challenge:timestamp:account-delete:<user_address>",
  "pin_proof": "Paranoid accounts only: Ed25519 under the account-proof key over SHA-256 of that same payload"
}
```

Getting a `pin_proof` means calling `POST /oprf/account/evaluate` first (§20). A Standard account sends none; sending one anyway is refused.

**`204 No Content`**: no body. Every token of the account is `401 UNAUTHORIZED` from then on.

**Errors:** `400 INVALID_BODY` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (root signature, proof missing, wrong, or sent by a Standard account) · `404 NOT_FOUND` (a limited device) · `500 INTERNAL_ERROR`.

---

---

## 9. Secrets Endpoints

> **Scope `secrets`.** Every route in this section needs a device holding `secrets` (`404` otherwise); deletes need a **full** device and are signed by it; every `wrapped_dek` write carries the current `key_generation` (`409 STALE_KEY_GENERATION` otherwise). Responses return `key_generation` beside `wrapped_dek`.

🔒 All protected. A "secret" is one encrypted legacy item. The server stores three opaque strings and never decrypts anything.

> **Storing a note rather than a secret?** Notes are a separate resource with the same shape plus an edit route — see [§12](#12-notes-endpoints). Use `/notes` for anything the user types and later revises; use `/secrets` for material written once, like a seed phrase.

### `POST /secrets`

**Request**

```json
{
  "id": "6b2f…-uuid, generated by you",
  "ciphertext": "base64 AES-256-GCM blob produced client-side",
  "wrapped_dek": "base64 DEK wrapped to the owner's key",
  "key_generation": 1,
  "version": "v1"
}
```

| Field         | Required           | Notes                                                                                                                                                                                     |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | ❌ but **send it** | A canonical UUID you generate. This is what makes the call safe to retry. Omit it and the server generates one, and the call stops being idempotent. Non-canonical ⇒ `400 INVALID_PARAM`. |
| `ciphertext`  | ✅                 | Opaque. Must be non-empty.                                                                                                                                                                |
| `wrapped_dek` | ✅                 | Opaque. Must be non-empty. Sealed under the `secrets` KEK of `key_generation`.                                                                                                                                                                |
| `key_generation` | ✅              | The `secrets` generation `wrapped_dek` is sealed under. Must be the current one: `409 STALE_KEY_GENERATION` otherwise. |
| `version`     | ❌                 | Omit or `""` ⇒ defaults to `"v1"`. Any other value is rejected.                                                                                                                           |

**`201 Created`** when the item was stored — **`200 OK`** when you sent an `id`
that was already stored. Same body either way:

```json
{
  "message": "Secret added successfully",
  "data": {
    "id": "6b2f…-uuid",
    "ciphertext": "base64…",
    "wrapped_dek": "base64…",
    "key_generation": 1,
    "version": "v1",
    "created_at": "2026-07-26T12:00:00Z",
    "updated_at": "2026-07-26T12:00:00Z"
  }
}
```

> **Generate the `id` yourself, once per item, before the first attempt** — then a
> timeout costs you nothing: replay the identical body and you get `200` with the
> stored item, byte-for-byte, `created_at` included. Reuse the same id for every
> retry of the same item, and a fresh one for a genuinely new item.
>
> Three things to know. **It is create-or-return, not an upsert:** if you replay an
> id with a _different_ `ciphertext`, the stored row wins and your new payload is
> silently discarded — to change an item, delete it and create a new one. **Ids are
> scoped to your account**, so a UUID another user already holds is never a
> conflict for you. And **without `id` there is no idempotency to fall back on**:
> every call creates an item, and a retried timeout leaves you two, each separately
> indistinguishable from the original, because only you can read either.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`id` is not a canonical UUID) · `400 BAD_REQUEST` (`ciphertext is required` / `wrapped_dek is required` / unsupported `version`) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /secrets`

Returns every secret owned by the caller. **Always an array** — an empty vault yields `[]`, never `null`.

**`200 OK`**

```json
{
  "message": "Secrets retrieved successfully",
  "data": [
    {
      "id": "…",
      "ciphertext": "…",
      "wrapped_dek": "…",
      "key_generation": 1,
      "version": "v1",
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

There is no pagination here and no `limit`/`cursor` — see [§3.1](#31-pagination). Every item arrives with its full `ciphertext`, so on a large vault this is the heaviest response the API produces. Render your index from `?fields=meta` below and call this one only when you actually need the payloads (bulk export).

### `GET /secrets?fields=meta`

The same listing with the payloads stripped: no `ciphertext`, no `wrapped_dek`. Use it for the vault index — the list a user scrolls — so opening the app does not download every blob.

**`200 OK`**

```json
{
  "message": "Secrets metadata retrieved successfully",
  "data": [
    {
      "id": "…",
      "ciphertext_sha256": "64 lowercase hex characters",
      "ciphertext_bytes": 1234,
      "version": "v1",
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

`fields` takes **only** the value `meta`; anything else is `400 INVALID_PARAM`. Omit it for the full listing above.

`ciphertext_sha256` is `SHA-256` over the ciphertext exactly as `GET /secrets` serves it, and `ciphertext_bytes` is that string's length — enough to show a size, detect that an item changed, or diff your local cache against the server without transferring anything.

> ⚠️ **Do not treat `ciphertext_sha256` as verification.** It is the server's description of bytes the server holds. Anything that needs a trustworthy hash must hash the ciphertext **you** received. This field is for indexing and change detection only.

Like the full listing, this one is **not paginated** — it deliberately returns every item so the complete set of leaf hashes is available in one call.

**Errors:** `400 INVALID_PARAM` (unknown `fields` value) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /secrets/{id}`

**`200 OK`** — `data` is a single secret object, same shape as above.

**Errors:** `400 INVALID_PARAM` (not a canonical UUID) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (missing, or owned by someone else — indistinguishable by design) · `500 INTERNAL_ERROR`.

### `DELETE /secrets/{id}`

Signed with `secret-delete` over the path `{id}`.

**Request** — the body is **required**; it carries the signature that authorizes the deletion. The three signature fields below are required, signed by **the calling device**, which must be full (`404` otherwise). See [§5.3](./front-end-guide.md#53-action-signature-everything-destructive).

```json
{
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature"
}
```

**`204 No Content`** — no body.

**Errors:** `400 INVALID_PARAM` · `400 INVALID_BODY` (absent or not valid JSON) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (bad signature, or a second factor that does not match the account's mode) · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `DELETE /secrets` — batch

One `secret-delete` signature covering a whole set, so a multi-select delete costs one seed prompt instead of N. **Sort the ids ascending and de-duplicate them**, then sign them as consecutive arguments — the server rebuilds the payload the same way, so the order you send them in does not matter, but the set must match.

**Request:**

```json
{
  "ids": ["3f6b…-uuid", "9b2e…-uuid"],
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature"
}
```

**`200 OK`:**

```json
{
  "message": "Secrets deleted successfully",
  "data": { "requested": 2, "deleted": 2 }
}
```

`requested` is the de-duplicated count. `deleted` can be lower without being an error: an id that is not yours simply does not match, exactly as a cross-user read is invisible. Compare the two if you need to tell the user something was already gone.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (any id is not a canonical UUID — nothing is deleted) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (empty id set) · `500 INTERNAL_ERROR`.

---

---

## 10–11. Recovery and PIN Reset Endpoints — **removed 2026-09-04**

Every route that was documented here is gone: `PUT /recovery/setup`, the four
`/recovery/guardians/*` routes, `POST /recovery/request`,
`GET /recovery/session/{id}`, `GET /recovery/vault`,
`GET /recovery/sessions/pending`, `GET /recovery/share/{session_id}`,
`POST /recovery/submit`, and all six `/auth/pin-reset/*` routes. The `guardians`,
`recovery_*` and `pin_reset_*` tables went with them.

**What a client must do differently:**

- There is **no account recovery of any kind**. A lost seed phrase is terminal,
  and so is a forgotten PIN on a Paranoid account — `POST /oprf/account/rotate` (§20)
  changes a PIN the user still knows and is the only way a PIN ever changes.
- The client must say so **before** the PIN is set, not after. See
  [../tasks.md](../tasks.md), Tasks 95 and 105.
- The nine signed actions these routes used (`recovery-setup`, `guardian-invite`,
  `guardian-accept`, `guardian-revoke`, `recovery-share-submit` and the four
  `pin-reset-*`) are retired from
  [signed-actions.md](../api-general/.docs/auth/signed-actions.md).
- **`GET /users/{uuid}/public-keys` stays** and now has no caller. It is what
  private sharing (Task 102) will use to wrap an item key to a recipient.

The implementation of everything above is preserved and running in the
`dms-shamir` proof of concept.

## 12. Notes Endpoints

> **Scope `notes`.** Every route in this section needs a device holding `notes` (`404` otherwise); deletes need a **full** device and are signed by it; every `wrapped_dek` write carries the current `key_generation` (`409 STALE_KEY_GENERATION` otherwise). Responses return `key_generation` beside `wrapped_dek`.

🔒 All protected. Editable encrypted plain text.

### `POST /notes`

Creates a note. **JWT only** — no challenge, no signature, no PIN.

**Request**

```json
{
  "id": "6b2f…-uuid, generated by you",
  "ciphertext": "base64 AES-256-GCM blob produced client-side",
  "wrapped_dek": "base64 DEK wrapped to the owner's key",
  "key_generation": 1,
  "version": "v1"
}
```

| Field         | Required           | Notes                                                                                                                                     |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | ❌ but **send it** | A canonical UUID you generate. This is what makes the call safe to retry. Omit it and the server generates one, and the call stops being idempotent. Non-canonical ⇒ `400 INVALID_PARAM`. |
| `ciphertext`  | ✅                 | Opaque. Non-empty, at most 32,768 characters.                                                                                             |
| `wrapped_dek` | ✅                 | Opaque. Must be non-empty. Sealed under the `notes` KEK of `key_generation`.                                                                                                                |
| `key_generation` | ✅              | The current `notes` generation. `409 STALE_KEY_GENERATION` otherwise. |
| `version`     | ❌                 | Omit or `""` ⇒ defaults to `"v1"`. Any other value is rejected.                                                                           |

**`201 Created`** when the note was stored — **`200 OK`** when you sent an `id` that was already stored. Same body either way:

```json
{
  "message": "Note added successfully",
  "data": {
    "id": "6b2f…-uuid",
    "ciphertext": "base64…",
    "wrapped_dek": "base64…",
    "key_generation": 1,
    "version": "v1",
    "created_at": "2026-08-11T12:00:00Z",
    "updated_at": "2026-08-11T12:00:00Z"
  }
}
```

The idempotency rule is identical to `POST /secrets`: generate the `id` once per note before the first attempt, replay the identical body after a timeout, get `200` with the stored note byte-for-byte. It is **create-or-return, not an upsert** — replaying an id with a different `ciphertext` returns the stored row and discards your payload. To change a note, use `PUT` below.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`id` is not a canonical UUID) · `400 BAD_REQUEST` (`ciphertext is required` / `wrapped_dek is required` / unsupported `version` / ciphertext over 32,768 characters) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `PUT /notes/{id}`

Replaces a note's payload. **JWT only** — no challenge, no signature, no PIN.

**Request** — the create body without `id`, which comes from the path:

```json
{
  "ciphertext": "base64 AES-256-GCM blob produced client-side",
  "wrapped_dek": "base64 DEK wrapped to the owner's key",
  "key_generation": 1,
  "version": "v1"
}
```

**`200 OK`** with the stored note. `created_at` does not move; `updated_at` advances.

> **⚠️ Re-seal under the same DEK. Do not generate a new one.**
>
> Both `ciphertext` and `wrapped_dek` are opaque, so the server cannot tell a re-seal from a re-key and **nothing reports** a mistake here. Anything holding a copy of the old DEK stops being able to open the note.
>
> Keep the item DEK, encrypt the new plaintext under it, and send back the **same** `wrapped_dek` you were given.

**This is a strict update, never an upsert.** A `PUT` to an id that does not exist returns `404` and creates nothing. A `PUT` arriving after a `DELETE` would otherwise resurrect a row the client believes is gone.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (path id is not a canonical UUID) · `400 BAD_REQUEST` (same field rules as `POST`) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (no such note, or not yours — the same response either way) · `500 INTERNAL_ERROR`.

### `GET /notes`

The note index: **metadata only**, never the payloads. Paginated — `limit` and `cursor` per [§3.1](#31-pagination). Always an array; an empty account yields `[]`, never `null`.

**`200 OK`**

```json
{
  "message": "Notes retrieved successfully",
  "data": [
    {
      "id": "…",
      "ciphertext_sha256": "64 lowercase hex characters",
      "ciphertext_bytes": 6708,
      "version": "v1",
      "created_at": "…",
      "updated_at": "…"
    }
  ],
  "page": { "next_cursor": "…", "has_more": true }
}
```

`ciphertext_bytes` counts **base64 characters**, not decoded bytes — the same contract as `GET /secrets?fields=meta`. `ciphertext_sha256` is SHA-256 over the ciphertext exactly as `GET /notes/{id}` serves it, so you can reproduce it without decoding. It is **advisory, not an attestation**: the server hashed data the server holds. Hash real ciphertext client-side if you need a trustworthy digest.

Unlike `GET /secrets`, this endpoint is paginated and has no full-payload form. Notes are large — a 5000-character note is 6.7–26 KB of base64 — and Postgres stores every one of them out-of-line, so a listing that returned blobs would grow without bound. Fetch payloads one at a time with `GET /notes/{id}`.

**Errors:** `400 INVALID_PARAM` (unusable `limit` or `cursor`) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /notes/{id}`

One full note, `ciphertext` and `wrapped_dek` included.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (no such note, or not yours) · `500 INTERNAL_ERROR`.

### `DELETE /notes/{id}`

Deletes a note. **Requires a `note-delete` signed action** — unlike create and edit. Creating and editing are recoverable; deleting is not, so it carries the same proof-of-seed-key that `DELETE /secrets/{id}` carries.

**Request**

```json
{
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature"
}
```

The note id is signed as an argument, so a signature captured for one note cannot delete another.

**`204 No Content`** — no body.

**Errors:** `400 INVALID_PARAM` · `400 INVALID_BODY` (absent or not valid JSON) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (bad signature, or a second factor that does not match the account's mode) · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `DELETE /notes` — batch

One `note-delete` signature covering a whole set, so a multi-select delete costs one seed prompt instead of N. **Sort the ids ascending and de-duplicate them**, then sign them as consecutive arguments — the server rebuilds the payload the same way, so the order you send them in does not matter, but the set must match.

**Request:**

```json
{
  "ids": ["3f6b…-uuid", "9b2e…-uuid"],
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature"
}
```

**`200 OK`:**

```json
{
  "message": "Notes deleted successfully",
  "data": { "requested": 2, "deleted": 2 }
}
```

`requested` is the de-duplicated count. `deleted` can be lower without being an error: an id that is not yours simply does not match, exactly as a cross-user read is invisible. Compare the two if you need to tell the user something was already gone.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (any id is not a canonical UUID — nothing is deleted) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (empty id set) · `500 INTERNAL_ERROR`.

---

## 16. Documents Endpoints

> **Scope `documents`.** Every route in this section needs a device holding `documents` (`404` otherwise); deletes need a **full** device and are signed by it; every `wrapped_dek` write carries the current `key_generation` (`409 STALE_KEY_GENERATION` otherwise). Responses return `key_generation` beside `wrapped_dek`.

🔒 All protected. A "document" is a rich-text document stored as a **Yjs CRDT**: one compacted encrypted snapshot plus an append-only log of encrypted deltas. Single user, multiple devices — there is no real-time collaboration, no presence, and no WebSocket.

**You need a Yjs client.** The server never parses a delta, never merges, and never reads a document. It assigns sequence numbers, appends, and serves ranges. All merge logic lives in your editor.

**Body limit is different here.** These routes accept up to **8 MiB** (`DOCUMENT_MAX_BODY_BYTES`), because a snapshot is a whole compacted document. Every other route in this file stays at 1 MiB.

### The sync model in four rules

1. **`seq` is your cursor, not a version.** Yjs updates are commutative, so apply order does not matter — `seq` only tells you what you have already seen.
2. **Never send Yjs state vectors to the server.** A state vector is plaintext structural metadata (client count, per-client op counts). Sync on `seq`; it answers the same question and leaks less.
3. **Debounce 1–2 seconds and batch.** Each sealed blob costs 29 bytes of envelope overhead. Sealing every keystroke makes overhead dominate the payload.
4. **After compacting, reset your cursor to `snapshot_seq`.** Sequence numbers restart from 1 once the log is fully pruned. Carrying an old cursor across a compaction will skip updates.

### `POST /documents`

Creates an empty document. **JWT only** — no signature.

**Request:** `{ "id": "6b2f…-uuid, generated by you", "wrapped_dek": "base64", "key_generation": 1, "version": "v1" }`

`id` is optional but **send it** — same idempotency contract as `POST /notes`: a replay returns `200` with the stored row instead of creating a second document. Ids are scoped to your account.

**`201 Created`** (or **`200 OK`** on replay):

```json
{
  "message": "Document added successfully",
  "data": {
    "id": "6b2f…-uuid",
    "wrapped_dek": "base64…",
    "key_generation": 1,
    "snapshot_ciphertext": "",
    "snapshot_seq": 0,
    "revision": 1,
    "version": "v1",
    "created_at": "…Z",
    "updated_at": "…Z"
  }
}
```

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`id` is not a canonical UUID) · `400 BAD_REQUEST` (`wrapped_dek is required` / unsupported `version`) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /documents`

The document index: **cursors only**, no snapshot and no deltas. Paginated per [§3.1](#31-pagination). This is the endpoint to hit on app open.

**`200 OK`**

```json
{
  "message": "Documents retrieved successfully",
  "data": [
    { "id": "…", "snapshot_seq": 3, "latest_seq": 7, "revision": 2, "version": "v1", "created_at": "…", "updated_at": "…" }
  ],
  "page": { "has_more": false }
}
```

Compare `latest_seq` against the cursor you hold locally: if it is higher, you have updates to pull. Nothing else needs to move to answer that question.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /documents/{id}`

The snapshot, its cursor, the wrapped DEK and the current revision. A cold device fetches this, then everything above `snapshot_seq`.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `GET /documents/{id}/updates?since={seq}`

Deltas above the cursor, in `seq` order, paginated. `since` is **exclusive** and defaults to `0`.

```json
{
  "message": "Document updates retrieved successfully",
  "data": [ { "seq": 8, "ciphertext": "…", "created_at": "…" } ],
  "page": { "next_cursor": "…", "has_more": true }
}
```

> **Verify `seq` contiguity before you compact.** The server orders the log, so a compromised backend could drop an update. Reordering is harmless — Yjs merges commute — but a dropped delta is lost work, and the sealed-blob format carries no AAD to detect it. Check that the sequence runs unbroken from `snapshot_seq`, and refuse to compact over a gap.

**Errors:** `400 INVALID_PARAM` (non-numeric or negative `since`, unusable paging) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (no such document, or not yours) · `500 INTERNAL_ERROR`.

### `POST /documents/{id}/updates`

The autosave path. **JWT only.**

**Request:**

```json
{ "updates": [ { "client_update_id": "…uuid", "ciphertext": "base64 sealed Yjs update" } ] }
```

**`200 OK`:** `{ "applied": 1, "skipped": 0, "latest_seq": 43 }`

Batched, so a burst of debounced saves costs one round trip. At most **256 updates** per request and **262144 characters** per delta.

`client_update_id` is a UUID you generate per delta, and it makes the append **idempotent**: replaying it is `skipped` and consumes no sequence number, so a retried request after a timeout cannot duplicate or gap your log. One malformed id rejects the whole batch and appends nothing.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (any `client_update_id` is not a canonical UUID) · `400 BAD_REQUEST` (empty batch, over 256 updates, or an oversized delta) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `POST /documents/{id}/compact`

Merges the log into a new snapshot and prunes what it replaces, in one transaction. **JWT only.**

**Request:**

```json
{
  "snapshot_ciphertext": "base64 sealed merged Yjs state",
  "through_seq": 3,
  "expected_revision": 2
}
```

**`200 OK`** with the updated document.

**Only you can compact** — the server cannot merge an encrypted log. A document nobody opens never compacts and its log grows, so make compaction part of your open/close lifecycle rather than expecting a background job.

`through_seq` above the stored maximum is `400` and prunes nothing: that would discard deltas you never merged. `expected_revision` is optional (omit or send `0` to skip the check); a mismatch is `409 CONFLICT` and changes nothing.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` · `400 BAD_REQUEST` (empty snapshot, `through_seq` ahead of the log) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `409 CONFLICT` (stale `expected_revision`) · `500 INTERNAL_ERROR`.

### `PUT /documents/{id}/key`

Rotates the document's wrapped DEK. **JWT only.** Body: `{ "wrapped_dek", "key_generation", "expected_revision" }`. Guarded by `expected_revision` → `409 CONFLICT` on a stale write, and by the current `documents` generation → `409 STALE_KEY_GENERATION`. This is also how a document is re-wrapped under a new generation after a rotation.

> **Rotating the DEK invalidates the whole log, not one blob.** Every delta and the snapshot are sealed under the same document DEK, so compact first and then rotate.

### `DELETE /documents/{id}`

Deletes a document and its entire update log. **Requires a `document-delete` signed action**, unlike create, edit and compact.

**Request:** `{ "challenge": "…", "timestamp": 1737676800, "signature": "…" }`

**`204 No Content`** — no body.

### `DELETE /documents` — batch

One `document-delete` signature covering a whole set. **Sort the ids ascending and de-duplicate them before signing** — the server rebuilds the payload the same way.

**`200 OK`:** `{ "requested": 2, "deleted": 2 }`

`deleted` can be lower without being an error. An empty id set is `404 NOT_FOUND`, returned before the signature is checked so it cannot burn a challenge.

---

## 17. Files Endpoints

> **Scope `files`.** Every route in this section needs a device holding `files` (`404` otherwise); deletes need a **full** device and are signed by it; every `wrapped_dek` write carries the current `key_generation` (`409 STALE_KEY_GENERATION` otherwise). Responses return `key_generation` beside `wrapped_dek`.

🔒 All protected. The drive. A "file" is an opaque encrypted object in Cloudflare R2 plus one row of metadata here — **no byte of file content passes through this API.** It issues presigned URLs and records rows; you `PUT` and `GET` the bytes directly against R2.

**The domain is opt-in.** With `FILES_ENABLE=false` — the default — none of these routes are wired and every one of them is `404`. Treat a `404` on `GET /files` as "the drive is off on this deployment", not as an error to show a user.

Read [storage-plan.md](../api-general/.docs/storage-plan.md) before implementing. This section is the wire contract; that document is the format, and getting the format wrong corrupts data rather than failing a request.

### The object layout, and the four numbers that must agree

A file is `chunk_count` sealed chunks laid end to end:

```
chunk_plaintext = u32be(chunk_index) ‖ u32be(chunk_count) ‖ payload
chunk_object    = 0x01 ‖ iv(12) ‖ AES-256-GCM(DEK, iv, chunk_plaintext) ‖ tag(16)
```

| Constant | Value | Why |
| --- | --- | --- |
| Chunk payload | 8 MiB (`8388608`) | One chunk is one R2 multipart part, and R2's minimum part size is 5 MiB |
| Chunk overhead | `37` | `1` envelope byte + `12` IV + `8` position header + `16` GCM tag |
| Chunk stride | `8388645` | Chunk *n* of a full object starts at `n × 8388645` — this is what makes a ranged read possible |
| Padding bucket | 64 KiB (`65536`) | The plaintext is padded to the next multiple **before** chunking |

> **The overhead is 37, not 29.** 29 is the envelope overhead of a chunk with no position header, which is what this format was before the index moved out of AEAD additional data — the sealed-blob envelope has none. An offset computed with 29 drifts 8 bytes per chunk and every ranged read after the first fails its GCM tag.

**Raw bytes, not base64.** The envelope's base64 encoding exists for `TEXT` columns; an R2 object is not one, and base64-ing a multi-gigabyte file inflates it by a third for nothing. `ciphertext` (the manifest) is base64 because it is a column; the object is not.

`size_bytes` is the **stored, padded** length of the whole object. Derive it, and never guess it:

```
padded     = ceil(true_size / 65536) × 65536
chunk_count = ceil(padded / 8388608)
size_bytes  = padded + chunk_count × 37
```

The last chunk is short, so `size_bytes` is **not** `chunk_count × 8388645`. The server rejects a `POST` whose two numbers do not describe the same object: it requires `ceil(size_bytes / 8388645) == chunk_count` and answers `400 BAD_REQUEST` with `size_bytes does not match chunk_count`.

### The sealed manifest

There is no filename column. A file's name, MIME type and **true plaintext length** live in `ciphertext`, sealed under the file's own DEK exactly like `secrets.ciphertext`:

```json
{
  "name": "passport-scan.pdf",
  "mime": "application/pdf",
  "size": 2483911,
  "chunk_size": 8388608,
  "chunk_count": 1,
  "thumbnail_id": "…optional uuid",
  "created_at": "2026-09-09T10:14:22Z"
}
```

`size` is the true length and lives only here — `size_bytes` on the wire is the padded one, which is what the account is billed and quota'd for.

**`chunk_count` is a manifest field and nothing else.** `POST /files` takes one in its body, but no response ever returns it: the row carries `size_bytes` and not the chunk layout. So a client reads the layout from the manifest it just decrypted, and the only number it has to reconcile against the row is `size_bytes`. **Verify the manifest against the row before decrypting** ([storage-plan.md §5](../api-general/.docs/storage-plan.md#5-settled-decisions)): recompute `size_bytes` from `size` with the formula above and refuse if it disagrees. Present that as a data error, not a security alert — the likely cause is a bug in an upload.

### `POST /files`

Checks the quota, mints the object key, writes the row at `r2_state: "pending"`, and returns presigned upload URLs. **JWT only** — no signature.

**Request:**

```json
{
  "id": "6b2f…-uuid, generated by you",
  "ciphertext": "base64 sealed manifest",
  "wrapped_dek": "base64",
  "key_generation": 1,
  "size_bytes": 65573,
  "chunk_count": 1,
  "version": "v1"
}
```

**`ciphertext_sha256` is not sent here** — it goes to `PATCH`. It is computed over the finished object, which does not exist yet at this point, and this is the call that hands you the URLs to create it with. Sending it here anyway is ignored.

`id` is optional but **send it** — same idempotency contract as `POST /notes` and `POST /documents`. A replay returns `200` with the stored row instead of minting a second row and a second R2 object, and **if that row is still `pending` it comes back with a fresh ticket listing only the parts R2 does not yet have.** `POST` is therefore both create and resume; `GET /files/{id}/upload` is the same answer without re-sending the body.

**`201 Created`** (or **`200 OK`** on replay):

```json
{
  "message": "File created successfully",
  "data": {
    "id": "6b2f…-uuid",
    "ciphertext": "base64…",
    "wrapped_dek": "base64…",
    "key_generation": 1,
    "size_bytes": 65573,
    "ciphertext_sha256": "…",
    "version": "v1",
    "r2_state": "pending",
    "gcs_state": "pending",
    "created_at": "…Z",
    "updated_at": "…Z",
    "upload": {
      "multipart": false,
      "chunk_size": 8388608,
      "parts": [ { "number": 1, "url": "https://…presigned…", "size": 65573 } ],
      "expires_at": "…Z"
    }
  }
}
```

**`multipart` decides the upload shape and you must honour it.** `false` is a single presigned `PUT` of the whole object — no multipart, and therefore no minimum part size, which is what keeps small files cheap at an 8 MiB chunk. `true` is one `UploadPart` URL per chunk. Part numbers are 1-based and `size` is exactly what that part must carry.

`expires_at` is one hour out by default (`FILES_UPLOAD_URL_TTL_SECONDS`). A large multipart that outlives it re-requests the ticket rather than failing the whole upload.

**Creation is rate limited per account** — 300 `POST /files` per 10 minutes by default, from whatever network. A thumbnail is its own `POST`, so a photo with a preview costs two, and **a replay with the same `id` counts too**: resume through `GET /files/{id}/upload`, which is not limited, instead of re-posting. Over the budget the answer is `429 TOO_MANY_REQUESTS` with `Retry-After`, and nothing was created — no row, no reservation. **Pause the upload queue for `Retry-After` seconds and carry on**; do not mark those files failed, and do not call `DELETE /files/{id}/upload` for an id that was never created.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`id` is not a canonical UUID) · `400 BAD_REQUEST` (`size_bytes does not match chunk_count`, or an unsupported `version`) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · **`413 BAD_REQUEST`** (over `FILES_MAX_OBJECT_BYTES`, 5 GiB by default) · **`507 QUOTA_EXCEEDED`** · **`429 TOO_MANY_REQUESTS`** (the per-account creation budget, above) · `500 INTERNAL_ERROR`.

### `GET /files/{id}/upload` — resume

Which parts R2 already holds, plus URLs for the ones it does not.

**`200 OK`:** `{ "uploaded": [1, 3], "parts": [ { "number": 2, "url": "…", "size": 8388645 } ] }`

**Nothing about a partial upload is recorded in this API** — the answer comes from R2's own `ListParts`. So a client that reloads mid-upload must ask rather than remember, and must not assume its own progress counter survived.

**`uploaded` listing every part with an empty `parts` means the object is already assembled** and only the `PATCH` is outstanding — the state a client reaches when its completion call was cut off after R2 acted. Send nothing, hash the object, and `PATCH`.

**The hash covers the finished object, not what you re-send.** So a resume still reads and re-seals every chunk; `uploaded` only says which ones need not be `PUT` again. That is possible because a chunk's IV is derived from its index, making sealing reproducible — see `storage-plan.md` §3.3.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `DELETE /files/{id}/upload` — give the reservation back

Abandons an upload that will not be finished: aborts the multipart if there is one, removes the row, and frees the quota immediately. **JWT only, and it takes no body** — the one `DELETE` in this API that does not, because it carries no signed action.

**`204 No Content`** — no body.

**Call this when an upload has failed and the user has given up on it**, not on every error. The row plus the parts R2 already holds are what make an interrupted upload resumable through `GET /files/{id}/upload`; abandoning throws that away. Nothing was stored, so there is nothing to restore.

**Why a `POST /files` row costs quota at all:** the check runs *before* any URL is signed, so a `pending` row is a **reservation** — without it a client could mint unlimited signed capacity. That is also why the fix is to remove the row rather than to stop counting it.

**Only a `pending` row can be abandoned.** A stored file, a row already deleted, another account's id, a second call, and a `PATCH` that landed between the failure and this request all answer `404` — and all of them mean *stop worrying about it*, never *retry*. `DELETE /files/{id}` with a `file-delete` signature stays the only way to remove a file that exists.

**A closed tab never calls this**, so a server-side sweep still collects `pending` rows older than `FILES_ABANDONED_AFTER_SECONDS` (24 h). This route only turns "within a day" into "now" for the case the user is watching.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `PATCH /files/{id}`

Completes the upload. **JWT only.**

**Request:**

```json
{ "ciphertext_sha256": "hex sha-256 of the whole stored object" }
```

**`ciphertext_sha256` is required here**, and this is the first moment it can exist: it is the hash of the finished object. Compute it incrementally as you seal and upload — one running SHA-256 over each sealed chunk in order — so a multi-gigabyte upload never has to hold more than the parts in flight. A malformed value is `400 BAD_REQUEST` before the service is reached.

**Do not send part ETags, and do not read them.** A `parts` array is still accepted and **ignored** since 2026-09-10: the server builds the completion from R2's own `ListParts`. A client that reloaded mid-upload has forgotten the ETags it once had, so any list it could send would be incomplete. This also means **the bucket does not need `ETag` under CORS `ExposeHeaders`** — a browser never has to read a header off its own `PUT`.

**Retrying a `PATCH` is safe, including one whose answer you never received.** Completion is what consumes the multipart, so a second attempt finds no upload id — that is treated as *already assembled*, not as an error, and the length check below decides. Without this a lost response left the object finished in R2 and the row stuck at `pending` forever.

**`200 OK`** with the file row, now `r2_state: "ok"`.

**The server verifies before it believes you.** It `HEAD`s the object and compares its length against the `size_bytes` you declared at `POST`. A mismatch is `409 CONFLICT`, and **the object is abandoned rather than repaired**: the multipart is aborted, the row stays `pending`, and a 24-hour sweep collects it. Do not retry with an adjusted size — start a new upload.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` · `400 BAD_REQUEST` (`ciphertext_sha256` missing or not 64 hex characters) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `409 CONFLICT` (the stored object does not match the declared size) · `500 INTERNAL_ERROR`.

### `GET /files`

The listing. Returns the sealed manifests — **a directory listing is your render of data this API cannot read.**

**`200 OK`:** the same row shape as `POST`, minus `upload`, in a `data` array with a `page` object.

Paginated per [§3.1](#31-pagination), the same envelope `GET /notes` and `GET /documents` use — follow `next_cursor` until `has_more` is `false`, and never build a cursor yourself.

Rows with `r2_state: "pending"` are uploads that have not completed. They are not in the vault and cannot be downloaded, but they are not junk either: `GET /files/{id}/upload` resumes one and `DELETE /files/{id}/upload` gives its reservation back, and the sweep collects whatever is left after `FILES_ABANDONED_AFTER_SECONDS`. Show them as unfinished uploads rather than as files — or as nothing at all, which leaves the user unable to reclaim the space.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /files/usage`

What a storage bar needs.

**`200 OK`:** `{ "used_bytes": 8454149, "stored_bytes": 65573, "quota_bytes": 524288000, "file_count": 2 }`

`quota_bytes` is `users.storage_quota_bytes` — a ceiling, not a plan. The default is 500 MB.

**There are two sums because they answer different questions**, and a client that shows the wrong one lies to the user:

| | What it is | What it is for |
| --- | --- | --- |
| `stored_bytes` | `SUM(size_bytes) WHERE r2_state = 'ok'` — what R2 actually holds | **What a storage bar shows.** These are files that exist |
| `used_bytes` | the same sum over **every** live row, `pending` included | What the ceiling is checked against, before any URL is signed |

The difference is uploads that reserved their bytes and have not finished. **The reservation is deliberate** — without it a client could call `POST /files` a thousand times and mint unlimited signed capacity — and it is why `507 QUOTA_EXCEEDED` can arrive while a bar drawn from `stored_bytes` still shows room. Draw the difference as a second, quieter segment rather than hiding it, and `DELETE /files/{id}/upload` is what gives a reservation back.

**A deleted row is in neither sum.** Its bytes are released the moment it is marked, before the objects leave R2 and GCS — the space returns to the user ahead of the storage bill, which is the friendlier way round.

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /files/{id}`

The manifest, the wrapped DEK, and a short-lived presigned `GET` for the object.

**`200 OK`:** the file row plus `{ "url": "https://…presigned…", "expires_at": "…Z" }`

The URL is scoped to one object and one method and lives **five minutes** by default (`FILES_DOWNLOAD_URL_TTL_SECONDS`). Re-request it rather than caching it; an expired URL fails in a way that looks like a missing file.

**Reads never touch the GCS replica.** That is what keeps its egress at zero. `gcs_state` tells you about insurance, not about availability, and a file with `gcs_state: "pending"` is fully readable.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `DELETE /files/{id}`

**Requires a `file-delete` signed action** ([signed-actions.md](../api-general/.docs/auth/signed-actions.md)), plus the second factor on Paranoid accounts — unlike create and complete, which are JWT only.

**Request:** `{ "challenge": "…", "timestamp": 1737676800, "signature": "…" }`

**`204 No Content`** — no body.

**This is the one-element case of `DELETE /files`**, below — same action label, same signature shape. Use whichever matches the gesture.

**The row is marked, not removed.** `deleted_at` is set and the objects leave R2 and GCS when the mirror worker gets to them. Until then the bytes still count against the quota, and `GET /files/{id}` is already `404`.

**Errors:** `400 INVALID_BODY` (a `DELETE` with no body is `400`, not `204`) · `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (bad signature **or** wrong PIN — indistinguishable, by design) · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `DELETE /files`

Deletes a set of files under **one** signature. **Requires a `file-delete` signed action** over the ids, plus the second factor on Paranoid accounts.

**Request:** `{ "ids": ["…", "…"], "challenge": "…", "timestamp": 1737676800, "signature": "…" }`

The ids in the signed payload are **sorted ascending and de-duplicated**, exactly as for `secret-delete`, `note-delete` and `document-delete` — the server rebuilds the list its own way and a differently-ordered one verifies against nothing. Send `ids` in that same normalized order.

**`200 OK`:** `{ "requested": 3, "deleted": 2 }` — read the body; this route does not return `204`.

**A shortfall is not a partial failure.** The rows are marked in one statement, so it applies to the whole set or to none of it. `deleted < requested` means some ids matched no row — already deleted, never existed, or belonging to another account, all indistinguishable by design. Treat it as *the list is out of date* and reload.

**`deleted` counts rows, never objects.** Each marked row is removed from R2 and GCS afterwards, one at a time, exactly as a single delete already was; the bytes leave the quota when the mirror worker gets to them.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (any id that is not a canonical lowercase UUID, checked before anything is deleted) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (an empty id list) · `500 INTERNAL_ERROR`.

### What this API does not do

- **It does not see your bytes.** Uploads and downloads are client ↔ R2. What it holds is a wrapped key it cannot unwrap and a hash you computed.
- **It does not verify your padding, your chunking or your hash.** It sees a stored length and checks it against the object that landed. Everything else — the 64 KiB bucket, the position header in each chunk, `ciphertext_sha256` actually matching — is a client obligation, and a client that gets one wrong produces a file only it can fail to open.
- **It does not replicate synchronously.** `r2_state: "ok"` with `gcs_state: "pending"` is the normal state for up to a minute. **The UI must not claim two providers**; the honest promise is "replicated within a minute".

## 18. Sharing Endpoints

Safe sharing: an account gives another account **read** access to one of its items, and the server
never holds a key to any of it. All routes require the JWT.

**Read `internal/domain/sharing/README.md` for the design.** This section is the wire contract.

> **Scopes and generations (2026-09-21).**
> - Connection mutations need a device holding `sharing`.
> - Shares and shared reads need the item's scope, and the inbox lists only the item types the
>   device holds.
> - Deleting a connection or a share needs a full device.
> - A connection is made to **both sides' current `sharing` generations**, and each item scope
>   gets its own sub-key of the connection key, stored per side with
>   `PUT /connections/{id}/keys`.

### The shape, in one paragraph

A **connection** is the authorisation object: one per ordered pair of accounts, `pending` until the
recipient accepts, carrying the PQXDH blob that establishes the pair's session key. Everything else
hangs off it. A **share** carries one re-wrapped DEK per item — **the ciphertext is never copied**,
so the recipient reads the owner's row.

⚠️ **Three properties the UI must state and must not overstate:**

- **Deleting the original breaks the recipient.** That is the feature, not a bug.
- **Removing a share cuts off future reads through the API and nothing more.** It cannot claw back a
  DEK the recipient's client already holds. Never imply a share can be un-read.
- **Re-sharing cannot be prevented.** Never claim it can.

### Signed actions

Every mutation carries one, and the counterparty or the item is **inside the signature**, so a proxy
that rewrites a body cannot redirect a share. See
[signed-actions.md](../api-general/.docs/auth/signed-actions.md).

| Route | `action` | Signed arguments, in order |
| --- | --- | --- |
| `POST /connections` | `connection-invite` | `recipient_username` (normalised), `pqxdh_blob`, `sender_key_generation`, `recipient_key_generation` |
| `POST /connections/{id}/accept` | `connection-accept` | `connection_id` |
| `DELETE /connections/{id}` | `connection-delete` | `connection_id` |
| `PUT /connections/{id}/keys` | `connection-keys` | `connection_id`, hex SHA-256 of the lines `scope:key_generation:wrapped_key` joined by `\n`, in request order |
| `POST /shares` | `share-create` | `connection_id`, `item_type`, `item_id` |
| `DELETE /shares/{id}` | `share-delete` | `share_id` |
| `PUT /sharing/address-book` | `address-book-update` | `expected_revision`, hex SHA-256 of `ciphertext` |

Every one is signed by **the calling device's key**, with no PIN.

⚠️ **`share-create` is a signed-action label; `item-share` is the PQXDH usage label.** Different
protocols — a signature payload and an HKDF `info` input. Never use one where the other belongs.

### `POST /connections`

Invites an account to receive shares. `id` is optional and client-generated, so a retry is
idempotent rather than a second row.

```json
{
  "id": "0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e",
  "recipient_username": "pedrosilva",
  "pqxdh_blob": "PQXDH item-share blob, to the recipient's current sharing keys",
  "sender_wrapped_key": "the connection key sealed under the sender's current sharing KEK",
  "sender_key_generation": 3,
  "recipient_key_generation": 2,
  "challenge": "...", "timestamp": 1785000000, "signature": "..."
}
```

Read the recipient's current generation and keys from `GET /users/{uuid}/public-keys` (§19), and
**verify its proof path against the root key you pinned** before encapsulating.

**`201 Created`** → `{ id, direction, username, status, pqxdh_blob, sender_key_generation, recipient_key_generation, keys: [], created_at }`.

**Errors:** `400 BAD_REQUEST` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (no account uses that
username **right now** — only a current username resolves; or the device lacks `sharing`) ·
`409 CONFLICT` (a connection between the pair already exists) · `409 STALE_KEY_GENERATION` (either
generation is not current: re-read and re-encapsulate).

### `GET /connections`

Paginated, both directions. Each row carries `direction` (`inbound` / `outbound`), the
counterparty's **current** username joined at read time, their `user_address`, and `status`.

**Each side gets only the blob it can open**: `pqxdh_blob` goes to the recipient, whose keys it was
encapsulated to, and `sender_wrapped_key` to the sender, who sealed it under their own `sharing` KEK
of `sender_key_generation`. The sender cannot open what they encapsulated to the recipient, which is
why there are two. **Both blobs are blanked for a device that does not hold `sharing`.**

Each row also carries **`keys`**: this side's stored sub-keys, `[{ scope, key_generation,
wrapped_key }]`, **only for the scopes the calling device holds**. A limited device opens a share
with its scope's sub-key, and never needs the connection key.

⚠️ **`user_address` is on this row because the recipient cannot open anything without it.** The
frozen PQXDH `info` binds both full addresses, so re-deriving the connection key means rebuilding
the sender's side of that string. It is no new disclosure — the pair are connected, and the address
is already reachable through `GET /users/{uuid}/public-keys`.

⚠️ A rename shows up here immediately and breaks nothing — connections bind `user_id`, never the
username string.

### `POST /connections/{id}/accept`

Body is the signed action alone. **`204 No Content`.**

⚠️ **Acceptance is where key substitution is caught.** The PQXDH `info` binds both full
`user_address` values and the recipient derives with their own, so a server that handed the sender
substituted keys produces a blob the recipient cannot open — it fails here, loudly. What that does
**not** catch is an active man-in-the-middle, which is why the acceptance screen must show the
sender's key fingerprint and ask for an out-of-band comparison as a step, not a dismissible detail.

**Errors:** `400 BAD_REQUEST` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (not yours, not pending,
or gone).

### `DELETE /connections/{id}`

Either side may delete. Body is the signed action alone. **`204 No Content`.**

⚠️ **This deletes every share on the connection**, and leaves no tombstone.

### `POST /shares`

Shares one item over an **accepted** connection. `id` is optional and client-generated.

```json
{
  "id": "...",
  "connection_id": "...",
  "item_type": "secret | note | document | file",
  "item_id": "...",
  "wrapped_dek": "...",
  "challenge": "...", "timestamp": 1785000000, "signature": "..."
}
```

`wrapped_dek` is the item's **existing** DEK re-wrapped under the connection's **sub-key for the
item's scope**, `HKDF-SHA256(connection_key, "Cryple-Share-v1|<scope>")` — one AES-256-GCM wrap
with a fresh random 96-bit IV, not a new PQXDH envelope. **Never a counter for the
IV**: one key protects many messages here.

**`201 Created`** → the share.

**Errors:** `400 BAD_REQUEST` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (unknown connection,
**or an item the sender does not own** — the same answer either way) · `409 CONFLICT` (that item is
already shared on that connection) · `422 BAD_REQUEST` (the connection has not been accepted).

### `GET /shares`

The inbox: what arrived, paginated. Each row carries the share, its `wrapped_dek`, and the sender's
current username.

### `GET /shares/{id}`

The shared item: the share, plus the owner's `ciphertext` for it. For a `document` this is the
snapshot ciphertext; for a `file` it is the **sealed manifest**, and the object bytes need the next
route.

**Errors:** `404 NOT_FOUND` — for a non-recipient, **and for the sender**. This is the recipient's
read, not a shared view; what went out is `GET /items/{type}/{id}/shares`.

### `GET /shares/{id}/download`

For `item_type: "file"` only. Returns a short-lived presigned `GET` for the owner's object, plus the
`wrapped_dek`.

**`200 OK`** → `{ share_id, wrapped_dek, url, expires_at }`.

**Errors:** `400 BAD_REQUEST` (the share is not a file) · `404 NOT_FOUND`.

### `DELETE /shares/{id}`

Withdraws a share. Body is the signed action alone. **`204 No Content`.** Prospective only — see the
warning at the top of this section.

### `GET /items/{type}/{id}/shares`

Who an item went to: one row per recipient, with their current username. **Never returns a wrapped
DEK** — it is the owner's view of their own outbound shares.

```json
{ "id": "...", "item_type": "note", "item_id": "...", "username": "anacosta", "created_at": "..." }
```

⚠️ **The field is `username`, not `sender_username`.** This direction's counterparty is the
recipient, so this listing has its own shape rather than reusing the inbox row.

### `PUT /connections/{id}/keys`

Stores this side's per-scope sub-keys of the connection key, so devices that do not hold `sharing`
can open shares of the scopes they do hold. It needs a device holding `sharing` (to open the
connection key) **and every scope it seals a sub-key under**. Either side of the connection may call
it, pending or accepted. A later call replaces a scope's row, which is how a sub-key moves to a new
generation.

```json
{
  "keys": [
    { "scope": "notes", "key_generation": 1, "wrapped_key": "sealed(notes KEK, HKDF(connection_key, \"Cryple-Share-v1|notes\"))" }
  ],
  "challenge": "...", "timestamp": 1785000000, "signature": "..."
}
```

`scope` is one of `secrets`, `notes`, `documents`, `files`, each at most once; `key_generation` must
be that scope's current one.

**`204 No Content`.** **Errors:** `400 BAD_REQUEST` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND`
(not a party to the connection, or a scope the device lacks) · `409 STALE_KEY_GENERATION`.

### `GET /sharing/address-book` · `PUT /sharing/address-book`

The owner's connection nicknames and **root-key pins**, as one sealed blob (Task 121). The layout
inside is the client's. Both routes need `sharing`.

`GET` → `200 { ciphertext, wrapped_dek, key_generation, revision, updated_at }`, or `404` before
the first `PUT`.

```json
{
  "ciphertext": "sealed(DEK, address book)",
  "wrapped_dek": "sealed(sharing KEK, DEK)",
  "key_generation": 2,
  "expected_revision": 0,
  "challenge": "...", "timestamp": 1785000000, "signature": "..."
}
```

`expected_revision: 0` creates the book; `n` replaces revision `n` with `n+1`. Answers `200` with the
stored book. **Errors:** `400 BAD_REQUEST` · `401 INVALID_CREDENTIALS` · `409 CONFLICT` (stale
revision: read, merge, retry) · `409 STALE_KEY_GENERATION`.

⚠️ **The pins are security state.** A pin is the counterparty's **root** key, which never changes;
a rotated sharing key is accepted only if its proof path ends at the pinned root.

---

---

## 19. Devices and Keyrings Endpoints

The model is [device-keys.md](../api-general/.docs/crypto/device-keys.md): read it before building a client.

**Statements and batches.** Every change to devices and keyrings is a **batch** of chain events,
plus the wraps and sealed material they require, applied atomically:

```
statement = "Cryple-Chain-v1|<user_address>|<seq>|<prev hash>|<type>|<fields…>"
signature = base64 P1363 over SHA-256(statement), by "root" or by a device
event hash = hex SHA-256(statement + "|" + signer + "|" + signature)   — the next event's <prev hash>
```

| `type` | Fields |
| --- | --- |
| `device-add` | `device_id`, `signing_public_key` (SPKI P-256, 124 chars), `x25519` (32 bytes), `mlkem` (ML-KEM-768 encapsulation key), `scopes` (canonical order) |
| `device-remove` | `device_id` |
| `device-scopes` | `device_id`, narrowed `scopes` |
| `keyring-rotate` | `scope=generation,…` in canonical order, each current + 1 |
| `sharing-keys` | `generation`, `x25519`, `mlkem` |

**Canonical scope order:** `admin,passwords,secrets,notes,documents,files,sharing`.

**Batch rules:**

- Removing another device, or narrowing one, must rotate every keyring it loses. Removing
  yourself does not.
- Rotating `sharing` needs a `sharing-keys` event for the same generation, and the sealed material.
- Every generation a batch creates must be wrapped to `root` and to **exactly** the active devices
  holding the scope.

A batch that breaks any of these is `400 INVALID_BATCH`, and the message names the rule.

### `POST /devices/enrol/chain` — public, root-signed

The chain an enrolment builds on. **A device about to enrol has no JWT**, so this is how it learns the
`seq` and head its `device-add` must name, and which devices a "lost my devices" enrolment removes.

```json
{
  "user_address": "…",
  "challenge": "…", "timestamp": 1785000000,
  "signature": "the ROOT over challenge:timestamp:chain-read:<user_address>",
  "pin_proof": "Paranoid accounts only (§20)"
}
```

**`200 OK`** → `{ chain: [events], devices: [ same rows as GET /devices ] }`. **Verify the chain from
the root key before building on it.**

**Errors:** `400 INVALID_BODY` · `404 NOT_FOUND` (any root or proof failure, uniform) · `429`.

### `POST /devices/enrol` — public, root-signed

Enrols a device **with the seed**. The batch starts with its `device-add` and may go on to remove
devices and rotate: the root always wins against a stolen device.

```json
{
  "user_address": "…",
  "challenge": "…", "timestamp": 1785000000,
  "signature": "the ROOT over challenge:timestamp:device-enrol:<user_address>:<hex SHA-256 of the batch statements joined by \\n>",
  "pin_proof": "Paranoid accounts only (§20)",
  "batch": { "events": [ … ], "wraps": [ … ], "materials": [ … ] }
}
```

**`201 Created`** → `{ access_token, device_id, chain: [events], root_keyrings: { current, generations: [{ scope, generation, wrapped_key, sealed_material? }] } }`.

The root wraps let the new device open each generation with the root wrap key, which it holds only
while the seed is typed. It then posts its own wraps to `POST /keyrings/wraps`, and discards the
seed.

**Errors:** `400 INVALID_BATCH` · `404 NOT_FOUND` (any root or proof failure, uniform) · `409 TOO_MANY_DEVICES`.

### `GET /devices` — 🔒

`200 { devices: [{ id, signing_public_key, encryption_public_key_x25519, encryption_public_key_mlkem, scopes, created_at }], head }`.
There is no device name on the server; name devices in the client's encrypted space.

### `POST /devices/batch` — 🔒

`{ "batch": { … } }`, with every event signed by the **calling** device. Linking a limited device
is a `device-add` here, with the new device's wraps for every existing generation of its scopes.
Removing, narrowing and rotating need `admin`; a device may always remove itself (log-out).
**`200`** → the device list, or an empty list when the caller removed itself.

### `GET /devices/chain?after={seq}` — 🔒

The owner's own events after `seq`. Verify them from the root key; the server did, but the client is
the one that must not trust it.

### `GET /keyrings` — 🔒

`200 { current: { scope: generation }, generations: [{ scope, generation, wrapped_key, sealed_material? }] }`,
covering only the keyring scopes the calling device holds. `wrapped_key` is `null` for a generation
this device has no wrap of yet.

### `POST /keyrings/wraps` — 🔒

`{ "wraps": [{ scope, generation, recipient: "<device id>", wrapped_key }] }`. It adds wraps of
**existing** generations, for a device holding the scope, from a device holding it. **`204`.** An
existing wrap is `400 INVALID_BATCH`.

### `GET /users/{uuid}/public-keys` — 🔒

`200 { uuid, user_address, root_public_key, sharing_keys: { generation, encryption_public_key_x25519, encryption_public_key_mlkem }, proof: [events] }`.

`proof` runs from the root to the `sharing-keys` event that published these keys: the `device-add`
of each device that signed along the way, then the announcement. **Verify it against the root key
you pinned** (the fingerprint of `root_public_key`); do not trust the keys otherwise.

---

---

## 20. PIN Endpoints (OPRF)

The spec is [pin-oprf.md](../api-general/.docs/auth/pin-oprf.md). Elements are 32-byte ristretto255 encodings in
base64 (44 characters). The OPRF is RFC 9497, base mode, `ristretto255-SHA512`.

### Device PIN

| Route | Auth | Body → answer |
| --- | --- | --- |
| `POST /oprf/devices` | 🔒 | `{ blinded_element }` → `201 { registration_id, evaluated_element }` |
| `POST /oprf/devices/{id}/commit` | 🔒 same device | `{ confirm_public_key }` (Ed25519) → `204`. Replaces any earlier registration of this device |
| `POST /oprf/devices/{id}/evaluate` | public (`oprf-device` budget) | `{ blinded_element }` → `200 { evaluated_element, attempt_id, attempts_remaining }` |
| `POST /oprf/devices/{id}/confirm` | public | `{ attempt_id, proof }` → `204`, or `404` |
| `DELETE /oprf/devices/{id}` | 🔒 its device, or a full device | → `204` |

- `proof` is Ed25519, under the `device-confirm` key, over
  `"Cryple-PIN-v2|device-confirm|<registration_id>|<attempt_id>"`.
- **Confirm every successful unlock**: a confirmation gives every attempt back.
- **`404` on `evaluate` means the registration is gone.** The attempts ran out or the device was
  removed. Ask for the seed and re-enrol; do not ask for the PIN again.

### Account PIN (Paranoid)

| Route | Auth | Body → answer |
| --- | --- | --- |
| `POST /oprf/account/begin` | 🔒 full device + root | `{ blinded_element, challenge, timestamp, signature, pin_proof? }`, action `second-factor-begin` over `user_address`, `blinded_element` → `200 { evaluated_element }` |
| `POST /oprf/account/enable` | 🔒 full device + root | `{ proof_public_key, challenge, timestamp, signature }`, action `enable-second-factor` over `proof_public_key` → `204`. Standard accounts only, and **for ever** |
| `POST /oprf/account/rotate` | 🔒 full device + root + current proof | `{ proof_public_key, …, pin_proof }`, action `rotate-second-factor` → `204` |
| `POST /oprf/account/evaluate` | public, root-signed | `{ user_address, blinded_element, challenge, timestamp, signature }`, action `pin-evaluate` over `user_address`, `blinded_element` → `200 { evaluated_element }` |

- **`evaluate` always answers with an evaluation.** For a Standard account, an unknown address, a
  bad signature or a throttled attempt it is a fake one, deterministic per address, so the route
  reveals nothing. A client that derives a wrong proof from it simply fails the root action it was
  for, with the uniform answer.
- **Wrong PINs are throttled per account**: 5 free, then a wait doubling from 1 s to 15 minutes.
  During a wait even the right PIN yields a useless evaluation. A client seeing repeated failures
  for a PIN the user is sure of should suggest waiting, not retyping.
- **`pin_proof`** is Ed25519, under the `account-proof` key, over the same `SHA-256(payload)` the
  root signature covers. It goes on every root action of a Paranoid account: `chain-read`,
  `device-enrol`, `account-delete`, `second-factor-begin`, `rotate-second-factor`.

**Errors:** `400 BAD_REQUEST` (malformed element or key) · `401 INVALID_CREDENTIALS` (the account
routes: root, proof or state refused, uniformly) · `404 NOT_FOUND` (the device routes).

