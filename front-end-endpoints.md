# Cryple API — Endpoint Reference

Every HTTP endpoint the server exposes: the exact request payload it accepts, the success response it returns, and every error response it can produce.

This describes the API **as implemented**, not as specified. Where the implementation and `.docs/` disagree, this file follows the code.

**Read [front-end-guide.md](./front-end-guide.md) first.** It carries what you need before any call here will work: the base URL, CORS and transport limits, how to build the challenge and action signatures that most of these endpoints require in their request body, JWT usage, and the client caveats. This file assumes all of it. Paths below are served exactly as written — the API has no version prefix.

Section numbers are **not contiguous** — they are the original numbering from before this file was split out of the guide, kept so that every `§N` reference in `.docs/` and the module READMEs still resolves. §1, §2, §5 and §14 live in the guide. §15 (Notes) and §16 (Documents) were added after the split and take the next free numbers rather than topical ones, for the same reason: renumbering would break every existing reference.

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
- [10. Recovery Endpoints](#10-recovery-endpoints)
- [11. PIN Reset Endpoints](#11-pin-reset-endpoints)
- [12. Succession Endpoints](#12-succession-endpoints)
- [13. Enumerations](#13-enumerations)
- [15. Notes Endpoints](#15-notes-endpoints)
- [16. Documents Endpoints](#16-documents-endpoints)

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
GET /succession/beneficiaries?limit=25&cursor=bzoyNQ

{
  "message": "Beneficiaries retrieved successfully",
  "data": [ /* up to `limit` rows */ ],
  "page": { "next_cursor": "bzo1MA", "has_more": true }
}
```

| Parameter | Default | Rule                                                                                                     |
| --------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `limit`   | `50`    | Integer `1`–`200`. Zero, negative, non-numeric or over `200` is `400 INVALID_PARAM`.                     |
| `cursor`  | none    | **Opaque.** Send back a `next_cursor` this API gave you, verbatim. Anything else is `400 INVALID_PARAM`. |

Paginated: `GET /succession/beneficiaries` ·
`GET /succession/beneficiaries/{id}/shares` · `GET /succession/shares` ·
`GET /succession/anchors` · `GET /succession/inheritances/{owner}/anchors` ·
`GET /succession/inheritances/{owner}/items/{id}/updates` · `GET /succession/votes` ·
`GET /recovery/guardians` · `GET /recovery/guardianships` ·
`GET /recovery/sessions/pending` · `GET /recovery/pin-reset/pending` ·
`GET /auth/pin-reset/{id}/votes`.

Rules worth building to:

- **Loop until `has_more` is `false`.** On the last page `has_more` is `false`
  and `next_cursor` is absent. Do not stop because a page came back short: a
  page can legitimately be shorter than `limit`.
- **Never construct, parse or persist a cursor.** It encodes a position today
  and may encode something else tomorrow; that change is explicitly allowed to
  happen without notice, and it is only safe because the token is opaque.
- **On the two vote reports, `page` describes `data.votes`**, not `data` — those
  responses are an object wrapping a `votes` array, and the array is what pages.
- **`GET /secrets` is not paginated in either form** and never will be without a
  companion change — a client recomputes the vault Merkle root over every blob,
  so a truncated vault listing would break verification. Use
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
and for an heir in a different country than the owner:

```js
new Date(secret.created_at).toLocaleString(); // renders in the device's zone
```

Do not strip the `Z`, and do not re-interpret the string as a local time — both
turn a correct instant into one that is wrong by the device's offset.

Timestamps your client **sends** are the opposite format: **unix seconds** as a
JSON integer (`"timestamp": 1785000000`), never a formatted string
([§5.2](./front-end-guide.md#52-challenge-signature-sign-up--sign-in)).

**One group of returned timestamps is also unix seconds: everything inside the
`chain` object** on [`GET /succession/status`](#get-successionstatus) —
`last_check_in`, `triggerable_at`, `triggered_at`, `releasable_at`,
`released_at`. Those are block timestamps copied from the contract, and
reformatting them would make this API disagree with the chain in a way nobody
could see. They are numbers, not strings, so a client that types them as
`string` fails at compile time rather than rendering `Invalid Date`.

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

> ⚠️ **There is no `message` or `error` field on error responses, and this is deliberate.** The server builds a machine-readable `code` and drops the human-readable message. Service-level validation text (e.g. `"guardian \"alice\" has not accepted an invitation"`) exists in the backend but **never reaches the client** — it is logged server-side only, because account creation is free and unrestricted, so any detail sent to "an authenticated user" is detail sent to an attacker.
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
| 401  | `UNAUTHORIZED`        | Missing, malformed, expired or invalid `Authorization: Bearer` token.                                                                                                                                                                                                              |
| 401  | `INVALID_CREDENTIALS` | Second factor (`password`) wrong, an action signature failed to verify, **or the JWT is valid but its account no longer exists**.                                                                                                                                                  |
| 404  | `NOT_FOUND`           | Resource does not exist, is not yours, **or** authentication failed on an auth endpoint.                                                                                                                                                                                           |
| 405  | `METHOD_NOT_ALLOWED`  | The path exists but does not accept this verb.                                                                                                                                                                                                                                     |
| 409  | `CONFLICT`            | The resource is not in a state that accepts the request (expired session, closed PIN reset, already-released succession).                                                                                                                                                          |
| 500  | `INTERNAL_ERROR`      | Unexpected server/database failure. Safe to retry once.                                                                                                                                                                                                                            |
| 503  | `NOT_READY`           | `GET /ready` only ([§6](#6-service-endpoints)): a dependency did not answer. Never returned by any other endpoint.                                                                                                                                                                 |

Codes defined but not currently emitted by any handler: `DATABASE_ERROR`, `EMPTY_BODY`, `FORBIDDEN`.

`USER_NOT_FOUND` is a fifth: it exists only in a defensive branch of
`DELETE /users` that cannot fire, because both the second-factor check and the
account lookup fail first with `401 INVALID_CREDENTIALS`. Earlier versions of
this guide listed it as a `DELETE /users` response — **do not branch on it.** A
delete that cannot find the account answers `401 INVALID_CREDENTIALS`, the same
code as a wrong PIN.

> **`401 INVALID_CREDENTIALS` is reachable on every protected route, including plain `GET`s that take no body.** Almost every protected handler starts by resolving the JWT's `user_address` back to an account row, and a failure there is reported as `INVALID_CREDENTIALS`, never `UNAUTHORIZED`. That is not hypothetical: the token outlives the account (`DELETE /users` does not revoke it — see [§5.5](./front-end-guide.md#55-jwt-usage)), so a client that deletes an account and keeps using the token sees this code everywhere. The per-endpoint tables below list it wherever it applies; treat it as always possible on a `🔒` route and handle it as "start over from sign-in", distinct from a `401 UNAUTHORIZED` expiry. The only protected route without this path is `GET /users/{uuid}/public-keys`, which looks up the _subject_, not the caller.

**`405` always carries an `Allow` header** with the verbs that path does accept, as one comma-separated value:

```
HTTP/1.1 405 Method Not Allowed
Allow: GET, POST
Content-Type: application/json; charset=utf-8

{"code":"METHOD_NOT_ALLOWED"}
```

Two things to know about it. It is decided **before** the token is checked, so a wrong verb returns `405` even with no `Authorization` header — do not read that as "this route is public". And `Allow` describes the routing table, not intent: `POST /auth/pin-reset/confirm` reports `Allow: GET, PATCH` because `GET /auth/pin-reset/{id}` genuinely matches `confirm` as an `{id}`. Treat it as a debugging aid, not as a route description.

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

Creates an account. **If the `user_address` already exists, this behaves exactly like `/sign-in`** (the extra key fields are ignored) — so it is safe to call idempotently from an onboarding flow. The status code tells the two apart: **`201` means the account was just created**, `200` means it already existed. Branch on that to decide whether to run first-time onboarding.

**Request**

```json
{
  "user_address": "3f1c…64 hex chars…",
  "public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…",
  "encryption_public_key_x25519": "base64…",
  "encryption_public_key_mlkem": "base64…",
  "challenge": "7f3b…64 hex chars…",
  "timestamp": 1785000000,
  "signature": "base64 of 64 raw bytes",
  "password": "optional 64-hex Server_Auth_Token"
}
```

| Field                          | Required | Notes                                                              |
| ------------------------------ | -------- | ------------------------------------------------------------------ |
| `user_address`                 | ✅       | 64 lowercase hex.                                                  |
| `public_key`                   | ✅       | base64 DER SPKI, P-256. Must be the key that produced `signature`. |
| `encryption_public_key_x25519` | ✅       | Stored as-is for heirs/guardians to fetch.                         |
| `encryption_public_key_mlkem`  | ✅       | Stored as-is.                                                      |
| `challenge`                    | ✅       | 64 lowercase hex, single use.                                      |
| `timestamp`                    | ✅       | Unix seconds, within ±300s.                                        |
| `signature`                    | ✅       | Over `challenge:timestamp`.                                        |
| `password`                     | ❌       | Present ⇒ account is created in Paranoid Mode.                     |

**`201 Created`** — the account did not exist and was registered:

```json
{
  "message": "Account created",
  "data": { "access_token": "eyJhbGciOiJIUzI1NiIs…" }
}
```

**`200 OK`** — the address already had an account, so this was a sign-in:

```json
{
  "message": "Authentication successful",
  "data": { "access_token": "eyJhbGciOiJIUzI1NiIs…" }
}
```

Both carry a usable token — treat either as a successful authentication and read `data.access_token` the same way. Only `/sign-up` can return `201`; `/sign-in` and `/auth/verify` always answer `200`.

**Errors**

| Status | `code`           | Cause                                                                                                                             |
| ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_BODY`   | Empty/invalid JSON, or a required field missing (struct validation).                                                              |
| 404    | `NOT_FOUND`      | Bad address format, stale/replayed challenge, invalid signature, malformed `password`, or (existing account) wrong second factor. |
| 500    | `INTERNAL_ERROR` | Hashing or database failure.                                                                                                      |

### `POST /sign-in`

### `POST /auth/verify`

Identical handlers — `/auth/verify` is an alias, keep using whichever your client already calls.

**Request**

```json
{
  "user_address": "3f1c…",
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64…",
  "password": "optional 64-hex Server_Auth_Token"
}
```

**`200 OK`** — same envelope as `/sign-up`.

**Errors** — same table as `/sign-up`. Unknown account, bad signature and wrong PIN are all `404 NOT_FOUND`; the client must show a single generic message.

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
    "has_password": false,
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

| Field          | Notes                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `user_address` | The `SHA-256` of the seed you authenticated with. Useful to confirm the client derived the account you expected. |
| `username`     | The auto-assigned username ([§8](#8-users-endpoints)); this is what guardian and beneficiary invitations take.   |
| `uuid`         | Your public identifier — feed it to `GET /users/{uuid}/public-keys`.                                             |
| `has_password` | **`true` = Paranoid Mode**, `false` = Standard Mode. Always present, never omitted.                              |
| `created_at`   | Account creation.                                                                                                |

**Call this on first launch after a restore.** `has_password` is the one fact a client cannot derive and cannot safely cache: it decides whether to prompt for a PIN, and a reinstall wipes local state. The alternative — probing `/sign-in` and reading the `404` — burns a challenge, costs the 350 ms floor, and returns the same `404` for a wrong PIN, a wrong seed and a nonexistent account. See [§5.4](./front-end-guide.md#54-standard-mode-vs-paranoid-mode).

It is also how you confirm a `POST /users/second-factor` that timed out actually landed: that call's retry is ambiguous by design, and this is the read-back it was missing.

**Deliberately not here:** whether you have guardians or beneficiaries. Those have their own endpoints, their own scoping and their own empty states — `GET /recovery/guardians` and `GET /succession/beneficiaries`. This endpoint answers "who am I", not "what have I configured".

**Errors:** `401 UNAUTHORIZED` (missing or invalid token) · `404 NOT_FOUND` (the token is valid but the account no longer exists — it was deleted; treat it as signed out) · `500 INTERNAL_ERROR`.

### `GET /users/lookup?address={user_address}` — public

Resolves an address to its auto-assigned username. Needed before inviting someone as a guardian or beneficiary, since those endpoints take usernames.

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

### `GET /users/{uuid}/public-keys` — 🔒 protected

Fetches a user's hybrid encryption keys so the client can wrap a DEK or a Shamir share for them. `{uuid}` is the `user_uuid` returned by the succession endpoints.

**`200 OK`**

```json
{
  "message": "Public keys retrieved successfully",
  "data": {
    "uuid": "0f5c8b1e-…",
    "encryption_public_key_x25519": "base64…",
    "encryption_public_key_mlkem": "base64…"
  }
}
```

**Errors:** `400 INVALID_PARAM` (not a canonical UUID) · `401 UNAUTHORIZED` · `404 NOT_FOUND`.

### `POST /users/second-factor` — 🔒 protected

Turns on Paranoid Mode for an account that does not yet have a second factor. The JWT is **not** enough on its own — the body carries an [action signature](./front-end-guide.md#53-action-signature-everything-destructive) over `challenge:timestamp:enable-second-factor:<new_password>`, signed with the account's own key.

**Request**

```json
{
  "new_password": "new 64-hex Server_Auth_Token",
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64…"
}
```

The signature must cover the exact token you are installing. That is what stops anything in the middle from keeping your signature and swapping in a token of its own — you would finish the upgrade with a second factor you don't know.

**`204 No Content`** — no body. Every subsequent `/sign-in` for this account must now include `password`.

**Errors**

| Status | `code`                | Cause                                                                                                                |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_BODY`        | Absent or unparseable body. Unlike the DELETEs, a body is **required** here.                                         |
| 400    | `BAD_REQUEST`         | `new_password` is empty.                                                                                             |
| 401    | `UNAUTHORIZED`        | Bad/missing JWT.                                                                                                     |
| 401    | `INVALID_CREDENTIALS` | Signature failed/stale/replayed, `new_password` is not valid 64-hex, **or the account already has a second factor**. |
| 500    | `INTERNAL_ERROR`      | Database failure.                                                                                                    |

> The "already has a second factor" case returns the same `401` as a bad signature, so this endpoint is never an oracle for which mode an account is in. If you need to change an existing PIN, use `PUT /users/password` (you know the current token) or the PIN-reset flow (you don't).

### `PUT /users/password` — 🔒 protected

**Rotates** an existing second factor. Usable only by an account already in Paranoid Mode, presenting the _current_ token **and** a `rotate-second-factor` signature over `new_password`. To turn Paranoid Mode on in the first place, use [`POST /users/second-factor`](#post-userssecond-factor--protected).

Signing `new_password` is the point, not ceremony: without it, anything between you and the server could keep your valid signature and substitute a token of its own choosing — the same reason `enable-second-factor` signs its token.

**Request**

```json
{
  "new_password": "new 64-hex token",
  "password": "current 64-hex token",
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature"
}
```

**`204 No Content`** — no body.

**Errors**

| Status | `code`                | Cause                                                                                                               |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_BODY`        | Empty or unparseable body.                                                                                          |
| 400    | `BAD_REQUEST`         | `new_password` is empty.                                                                                            |
| 401    | `UNAUTHORIZED`        | Bad/missing JWT.                                                                                                    |
| 401    | `INVALID_CREDENTIALS` | `password` wrong, `new_password` is not a valid 64-hex `Server_Auth_Token`, **or the account is in Standard Mode**. |
| 500    | `INTERNAL_ERROR`      | Database failure.                                                                                                   |

> A Standard-Mode account calling this endpoint gets `401`, it does not get upgraded. Sending `new_password: ""` to drop back to Standard Mode is a `400`; there is no way to remove a second factor once set.

### `DELETE /users` — 🔒 protected

Deletes the account and, by cascade, its secrets, guardians, beneficiaries and shares. **Irreversible.**

**Request** — the body is **required**; it carries the `account-delete` signature over your own `user_address`. Standard Mode omits `password` but still sends the three signature fields.

```json
{
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
}
```

**`204 No Content`** — no body.

**Errors:** `400 INVALID_BODY` (body present but not valid JSON) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (missing/wrong token in Paranoid Mode, a token sent by a Standard-Mode account, a failed signature, **or an account the token outlived**) · `500 INTERNAL_ERROR`.

---

---

## 9. Secrets Endpoints

🔒 All protected. A "secret" is one encrypted legacy item. The server stores three opaque strings and never decrypts anything.

> **Storing a note rather than a secret?** Notes are a separate resource with the same shape plus an edit route — see [§15](#15-notes-endpoints). Use `/notes` for anything the user types and later revises; use `/secrets` for material written once, like a seed phrase.

### `POST /secrets`

**Request**

```json
{
  "id": "6b2f…-uuid, generated by you",
  "ciphertext": "base64 AES-256-GCM blob produced client-side",
  "wrapped_dek": "base64 DEK wrapped to the owner's key",
  "version": "v1"
}
```

| Field         | Required           | Notes                                                                                                                                                                                     |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | ❌ but **send it** | A canonical UUID you generate. This is what makes the call safe to retry. Omit it and the server generates one, and the call stops being idempotent. Non-canonical ⇒ `400 INVALID_PARAM`. |
| `ciphertext`  | ✅                 | Opaque. Must be non-empty.                                                                                                                                                                |
| `wrapped_dek` | ✅                 | Opaque. Must be non-empty.                                                                                                                                                                |
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
> assignable to heirs — a duplicate quietly widens what an heir inherits.

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
      "version": "v1",
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

There is no pagination here and no `limit`/`cursor` — see [§3.1](#31-pagination). Every item arrives with its full `ciphertext`, so on a large vault this is the heaviest response the API produces. Render your index from `?fields=meta` below and call this one only when you actually need the payloads (recomputing the vault Merkle root, or bulk export).

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

> ⚠️ **Do not treat `ciphertext_sha256` as verification.** It is the server's description of bytes the server holds. Anchoring a vault root, or checking a blob against one, must hash the ciphertext **you** received. This field is for indexing and change detection only.

Like the full listing, this one is **not paginated** — it deliberately returns every item so the complete set of leaf hashes is available in one call.

**Errors:** `400 INVALID_PARAM` (unknown `fields` value) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /secrets/{id}`

**`200 OK`** — `data` is a single secret object, same shape as above.

**Errors:** `400 INVALID_PARAM` (not a canonical UUID) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (missing, or owned by someone else — indistinguishable by design) · `500 INTERNAL_ERROR`.

### `DELETE /secrets/{id}`

Signed with `secret-delete` over the path `{id}`.

**Request** — the body is **required**; it carries the signature that authorizes the deletion. All four signature fields below are required; `password` only on Paranoid Mode accounts. See [§5.3](./front-end-guide.md#53-action-signature-everything-destructive).

```json
{
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
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
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
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

> **Both delete routes also delete what heirs inherited of the item.** Every wrapped key assigned to that item is removed in the same transaction, so deleting one legacy item silently shrinks the inheritance of every heir it was assigned to. Nothing else is affected — each heir keeps every other item assigned to them. Two consequences for the UI: warn before deleting an item that is assigned to someone (`GET /succession/beneficiaries/{id}/shares` tells you which), and treat any cached `share_count` from [§12](#12-succession-endpoints) as stale after a delete. The response does not report how many assignments went with it — re-read the beneficiary list if you display the count.

---

---

## 10. Recovery Endpoints

Guardian-assisted seed recovery. The seed is split client-side with Shamir's Secret Sharing into `n` shares with threshold `k`; **share 0 is the owner's own Recovery Kit share** and each remaining share is encrypted to one guardian's hybrid public keys. The server stores ciphertext and orchestrates collection — it can never reassemble the seed.

### `PUT /recovery/setup` — 🔒 protected

Signed with `recovery-setup` over a digest of the whole payload — see [§5.3](./front-end-guide.md#53-action-signature-everything-destructive) for the exact canonicalization. Signing the payload rather than the intent is what stops anything between you and the server substituting its own shares on a validly-authorized call.

> ⚠️ **This changed on 2026-07-29 and is breaking.** Setup deletes every existing guardian share and overwrites the vault in one transaction, so it now needs the seed key, not just the token.

Stores (or replaces) the recovery vault and the guardian share set.

**Request**

```json
{
  "encrypted_seed": "opaque blob, seed encrypted under the owner's own key",
  "n_shares": 3,
  "k_threshold": 2,
  "version": "v1",
  "shares": [
    { "share_index": 0, "pq_hybrid_encrypted_share": "opaque…" },
    {
      "share_index": 1,
      "guardian_username": "alice1234abcd",
      "pq_hybrid_encrypted_share": "opaque…"
    },
    {
      "share_index": 2,
      "guardian_username": "bob5678efgh",
      "pq_hybrid_encrypted_share": "opaque…"
    }
  ],
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature over the setup digest",
  "password": "64-hex token, Paranoid Mode only"
}
```

Rules enforced server-side (all violations ⇒ `400 BAD_REQUEST`):

- `1 ≤ k_threshold ≤ n_shares`, both ≥ 1.
- `shares.length` must equal `n_shares` exactly.
- `share_index` values must be unique and inside `0..n_shares-1`.
- **Index 0 is required** and must carry **no** `guardian_username` (it is the owner's Recovery Kit share).
- Every index ≥ 1 requires a `guardian_username` that exists **and has already accepted** its invitation (`status = active`).
- No guardian may hold more than one share.
- `pq_hybrid_encrypted_share` must be non-empty on every entry.
- `version` omitted/`""` ⇒ `"v1"`; anything else rejected.

**`200 OK`**

```json
{
  "message": "Recovery setup stored successfully",
  "data": {
    "n_shares": 3,
    "k_threshold": 2,
    "version": "v1",
    "share_count": 3,
    "updated_at": "2026-07-26T12:00:00Z"
  }
}
```

**Errors:** `400 INVALID_BODY` · `400 BAD_REQUEST` (any rule above) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (JWT address no longer resolves to a user) · `500 INTERNAL_ERROR`.

### `POST /recovery/guardians/invite` — 🔒 protected

Requires a JWT **and** a `guardian-invite` [action signature](./front-end-guide.md#53-action-signature-everything-destructive) over the username being invited — the payload is `${challenge}:${timestamp}:guardian-invite:${guardian_username}`, signed with the owner's P-256 key.

**Request**

```json
{
  "guardian_username": "alice1234abcd",
  "challenge": "64-char lowercase hex",
  "timestamp": 1710000000,
  "signature": "base64 IEEE P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
}
```

The username is a **signed argument**, so it cannot be swapped after the fact: a signature produced for one username is refused for any other. Like every action signature it is single-use — invite two guardians and you sign twice, and a retry after a timeout needs a fresh challenge.

**`201 Created`**

```json
{
  "message": "Guardian invited successfully",
  "data": {
    "id": "9c1e…-uuid",
    "username": "alice1234abcd",
    "status": "pending_invite",
    "has_share": false,
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

Re-inviting an existing guardian is idempotent; a previously `revoked` guardian returns to `pending_invite`.

**Errors:** `400 INVALID_BODY` · `400 BAD_REQUEST` (unknown username, or inviting yourself) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (missing, malformed, replayed, stale or wrong-username signature) · `500 INTERNAL_ERROR`.

> The signature is checked **before** the username is looked up, so a caller who cannot sign gets `401` whether or not the username exists. Do not use this endpoint to test whether a username is registered — that is what [`GET /users/lookup`](#get-userslookupaddressuser_address--public) is for.

### `PATCH /recovery/guardians/{id}/accept` — 🔒 protected

Called by the **invited guardian** (their own JWT), with the invitation `id` from `GET /recovery/guardianships`. Signed with `guardian-accept` over that `{id}`.

> ⚠️ **This changed on 2026-07-29 and is breaking — it used to take no body and no signature.** Accepting is not a formality: it is the moment the owner's `user_address` becomes visible to you, and the moment you start counting toward their recovery quorum. A token alone could previously make someone a guardian who never saw the invitation, which silently raises the owner's quorum bar without adding anyone who will actually respond.

**Request** — the body is **required**. All four signature fields below are required; `password` only on Paranoid Mode accounts. See [§5.3](./front-end-guide.md#53-action-signature-everything-destructive).

```json
{
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
}
```

**`204 No Content`** — no body.

**Errors:** `400 INVALID_PARAM` (not a canonical UUID) · `400 INVALID_BODY` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (bad signature or second-factor mismatch) · `404 NOT_FOUND` (no such invitation, not addressed to you, or not in `pending_invite`) · `500 INTERNAL_ERROR`.

### `GET /recovery/guardians` — 🔒 protected

_Paginated — `?limit=` / `?cursor=`, `page` in the envelope ([§3.1](#31-pagination))._

Guardians **the caller has appointed**.

**`200 OK`**

```json
{
  "message": "Guardians retrieved successfully",
  "data": [
    {
      "id": "9c1e…",
      "username": "alice1234abcd",
      "status": "active",
      "encryption_public_key_x25519": "base64…",
      "encryption_public_key_mlkem": "base64…",
      "has_share": true,
      "created_at": "2026-07-26T12:00:00Z"
    }
  ]
}
```

Use the returned keys to encrypt that guardian's Shamir share before `PUT /recovery/setup`.

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `DELETE /recovery/guardians/{id}` — 🔒 protected

Removes a guardian you appointed. `{id}` is the `id` from `GET /recovery/guardians`.

**Request** — the body is **required** and carries an [action signature](./front-end-guide.md#53-action-signature-everything-destructive) over `challenge:timestamp:guardian-revoke:{id}`, signed with the **account owner's** key. A JWT on its own is not accepted here.

```json
{
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64…",
  "password": "64-hex token, Paranoid Mode only"
}
```

**`200 OK`**

```json
{
  "message": "Guardian revoked successfully",
  "data": {
    "id": "9c1e…",
    "username": "alice1234abcd",
    "status": "revoked",
    "share_removed": true,
    "votes_withdrawn": 1,
    "active_guardians": 2,
    "recovery_setup_stale": true
  }
}
```

The call is idempotent — repeating it succeeds with `share_removed: false` and `votes_withdrawn: 0`, so a retry after a timeout is safe (use a fresh challenge; action signatures are single-use).

> ⚠️ **`recovery_setup_stale: true` means you must re-run `PUT /recovery/setup`.** Two separate reasons, and the client should not treat either as optional:
>
> - The vault still claims `n_shares` holders but one is gone, so the k-of-n configuration no longer describes reality.
> - **More importantly, revocation is not cryptographic revocation.** The revoked guardian downloaded their share when you assigned it. Deleting the row stops the server serving it; it does not take it back. Until you re-split with a **fresh REK** and re-encrypt the seed, `k` holders including the ex-guardian can still reconstruct it. Surface this as a required next step, not a notice.
>
> `recovery_setup_stale` is `false` when the guardian never held a share (revoked before setup, or invited and never included) — nothing to redo in that case.

Effects, all in one transaction: status becomes `revoked`; their Shamir share row is deleted; their pending release and PIN-reset votes are withdrawn. They immediately fail every active-guardian check, so `GET /recovery/sessions/pending` and `GET /recovery/pin-reset/pending` go empty for them and their votes stop counting toward any quorum. They can be re-invited later, which returns them to `pending_invite`.

The ex-guardian still sees the relationship in their own `GET /recovery/guardianships`, now with `status: "revoked"` and `owner_user_address` omitted again.

**Errors:** `400 INVALID_PARAM` (not a canonical UUID) · `400 INVALID_BODY` (absent or unparseable body) · `401 UNAUTHORIZED` (bad/missing JWT) · `401 INVALID_CREDENTIALS` (signature failed, stale, or replayed) · `404 NOT_FOUND` (no such guardian, or not yours — indistinguishable by design) · `500 INTERNAL_ERROR`.

### `GET /recovery/guardianships` — 🔒 protected

_Paginated — `?limit=` / `?cursor=`, `page` in the envelope ([§3.1](#31-pagination))._

Accounts **the caller guards for others** — the inbox for accepting invitations.

**`200 OK`**

```json
{
  "message": "Guardianships retrieved successfully",
  "data": [
    {
      "id": "9c1e…",
      "owner_username": "3f1c8a2b9d4e",
      "status": "pending_invite",
      "created_at": "2026-07-26T12:00:00Z"
    },
    {
      "id": "7b3d…",
      "owner_username": "a92f4c1d8e0b",
      "owner_user_address": "a92f4c1d8e0b…64 hex chars…",
      "owner_release_cycle": 1,
      "status": "active",
      "created_at": "2026-07-26T12:00:00Z"
    }
  ]
}
```

`owner_user_address` and `owner_release_cycle` are **present only on `active` rows** — both keys are omitted entirely while `pending_invite`, not sent as `""`/`0`. They are the two values a guardian must sign over to cast a release vote, and this endpoint is the **only** place either is supplied: `GET /succession/status` is owner-scoped and will show you your own switch, not theirs. Cache `owner_user_address` when the guardian accepts, but re-read `owner_release_cycle` before every vote: it changes when a countdown is cancelled, and a signature made for the wrong cycle is refused. See [`POST /succession/votes`](#post-successionvotes).

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `POST /recovery/request` — public

Started on a **new device with no keys**: the user has lost their seed, so there is no JWT to present. The client mints a **hybrid** ephemeral key pair for this session and guardians re-encrypt their shares to it. PQXDH needs both halves, so both are sent, as two fields:

**Request**

```json
{
  "username": "3f1c8a2b9d4e",
  "ephemeral_x25519_public": "base64 of 32 raw bytes → 44 chars",
  "ephemeral_mlkem_public": "base64 of 1184 raw bytes → 1580 chars"
}
```

> **This changed on 2026-08-08 and is breaking.** It replaces the single `ephemeral_public_key`, which could not express the two keys the construction actually requires (Decision C).

**Both lengths are validated server-side** — that is the point of two fields. Swap them, hex-encode one, or pack both into one string and the call fails here with `400`, rather than succeeding and yielding shares your device silently cannot open an hour later. Keep both private halves in memory only; they die with the session.

The `info` string for `usage = recovery-session` carries the **`session_id` in both address slots**, not `user_address` values — see [`GET /recovery/share/{session_id}`](#get-recoverysharesession_id--protected), where the guardian side of the same contract is spelled out.

**`201 Created`**

```json
{
  "message": "Recovery session created successfully",
  "data": {
    "id": "4d7a…-uuid",
    "n_shares": 3,
    "k_threshold": 2,
    "status": "pending",
    "expires_at": "2026-07-26T12:30:00Z",
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

Sessions live for `RECOVERY_SESSION_TTL_MINUTES` (**default 30 minutes**). Persist the `id` locally — polling it is the only way back to the session.

**Errors:** `400 INVALID_BODY` · `400 BAD_REQUEST` (either ephemeral key missing, not standard base64, or not decoding to exactly 32 / 1184 bytes — the message names the field and the length it got) · `404 NOT_FOUND` (unknown username, or that account never ran `/recovery/setup`) · `500 INTERNAL_ERROR`.

### `GET /recovery/session/{id}` — public

Polled by the recovering client. **Shares are withheld until the threshold is met** — below `k`, `shares` is absent; at or above `k`, `status` flips to `shares_collected` and every collected share is returned at once.

**`200 OK`** (below threshold)

```json
{
  "message": "Recovery session retrieved successfully",
  "data": {
    "id": "4d7a…",
    "n_shares": 3,
    "k_threshold": 2,
    "status": "pending",
    "expires_at": "…",
    "created_at": "…"
  }
}
```

**`200 OK`** (threshold reached)

```json
{
  "message": "Recovery session retrieved successfully",
  "data": {
    "id": "4d7a…",
    "n_shares": 3,
    "k_threshold": 2,
    "status": "shares_collected",
    "shares": [
      {
        "re_encrypted_share": "opaque, decrypt with the ephemeral private key",
        "submitted_at": "2026-07-26T12:05:00Z"
      },
      {
        "re_encrypted_share": "opaque…",
        "submitted_at": "2026-07-26T12:07:00Z"
      }
    ],
    "expires_at": "…",
    "created_at": "…"
  }
}
```

Combine the shares client-side, reconstruct the seed, then fetch `GET /recovery/vault` if you also need the owner's own `encrypted_seed` blob.

**Errors:** `400 INVALID_PARAM` · `404 NOT_FOUND` · `409 CONFLICT` (session expired — a fresh `POST /recovery/request` is required) · `500 INTERNAL_ERROR`.

### `GET /recovery/vault?username={username}` — public

Returns the owner's self-encrypted seed blob and the vault's split parameters.

**`200 OK`**

```json
{
  "message": "Encrypted vault retrieved successfully",
  "data": {
    "encrypted_seed": "opaque…",
    "n_shares": 3,
    "k_threshold": 2,
    "version": "v1"
  }
}
```

**Errors:** `400 INVALID_PARAM` (missing `username`) · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `GET /recovery/sessions/pending` — 🔒 protected

_Paginated — `?limit=` / `?cursor=`, `page` in the envelope ([§3.1](#31-pagination))._

Polled by **guardians**: recovery sessions awaiting their share.

**`200 OK`**

```json
{
  "message": "Pending sessions retrieved successfully",
  "data": [
    {
      "session_id": "4d7a…",
      "owner_username": "3f1c8a2b9d4e",
      "ephemeral_x25519_public": "base64…",
      "ephemeral_mlkem_public": "base64…",
      "submitted": false,
      "expires_at": "2026-07-26T12:30:00Z",
      "created_at": "2026-07-26T12:00:00Z"
    }
  ]
}
```

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /recovery/share/{session_id}` — 🔒 protected

Called by a guardian to retrieve **their own** stored share ciphertext for that session, so they can decrypt it with their private key and re-encrypt it to the session's ephemeral key pair. This response is where the guardian's device learns both ephemeral keys.

**`200 OK`**

```json
{
  "message": "Share retrieved successfully",
  "data": {
    "session_id": "4d7a…",
    "ephemeral_x25519_public": "base64…",
    "ephemeral_mlkem_public": "base64…",
    "pq_hybrid_encrypted_share": "opaque…"
  }
}
```

**Re-wrap with `usage = recovery-session`, whose `info` binds the session id in both address slots:**

```
info = "Cryple-PQXDH-v1|recovery-session|" ‖ session_id ‖ "|" ‖ session_id
```

Use the canonical lowercase hyphenated UUID exactly as returned above. This is the one usage label that does *not* carry `user_address` values — a device recovering a lost seed has no address it can prove. The server relays the blob and cannot check any of this, so a guardian client that formats `info` differently produces a share that fails only at reconstruction, with nothing to point at. Full rationale: [`.docs/crypto/pqxdh.md` § Exception](.docs/crypto/pqxdh.md#exception-recovery-session-binds-the-session-not-the-parties).

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (unknown session, caller is not an active guardian of that owner, or holds no share) · `409 CONFLICT` (session expired) · `500 INTERNAL_ERROR`.

### `POST /recovery/submit` — 🔒 protected

Signed with `recovery-share-submit` over `session_id` and `re_encrypted_share`. Binding the share itself stops a proxy swapping in a corrupt one; binding the session stops a signature being replayed into a different recovery.

> ⚠️ **This changed on 2026-07-29 and is breaking.** This is the call that actually hands over your piece of someone's seed — collect `k` of them and the REK is reconstructable — so it now needs the seed key, not just the token.

Guardian submits the re-encrypted share. When the `k`-th share lands, the session flips to `shares_collected` automatically.

**Request**

```json
{
  "session_id": "4d7a…-uuid",
  "re_encrypted_share": "opaque, PQXDH-wrapped to the session's two ephemeral keys",
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "the GUARDIAN's own 64-hex token, Paranoid Mode only"
}
```

**`204 No Content`** — no body.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`session_id` not a canonical UUID) · `400 BAD_REQUEST` (`re_encrypted_share` empty) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (bad signature or second-factor mismatch) · `404 NOT_FOUND` (not a guardian for that session) · `409 CONFLICT` (session expired) · `500 INTERNAL_ERROR`.

---

---

## 11. PIN Reset Endpoints

Recovers a **forgotten PIN** while the seed is still available. Flow: owner requests → guardians vote to quorum → a **contest period** (default 48h) during which the owner can revoke → status becomes `authorized` → owner confirms with a new token.

All five endpoints are **public** — the account is locked out and cannot mint a JWT — and are instead authenticated by [action signatures](./front-end-guide.md#53-action-signature-everything-destructive). Every one carries `challenge`, `timestamp` and `signature` inline in the body.

**The owner's three actions are the one place `password` is not required**, and cannot be: the whole flow exists because the owner lost their PIN. `POST /auth/pin-reset/vote` is the exception among the five — it is cast by a **guardian**, who has lost nothing, so that guardian's own second factor applies if _they_ are in Paranoid Mode.

### `POST /auth/pin-reset/request` — public

Signed by the **owner**, action `pin-reset-request`, argument `user_address`.

**Request**

```json
{
  "user_address": "3f1c…",
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64…"
}
```

If a reset is already open for the account, the existing one is returned instead
of creating a second — **and the status code tells you which happened**:
`201 Created` for a new request, `200 OK` for the pre-existing one. The body is
the same shape either way, so a client that ignores the distinction still works;
one that shows "reset requested" should read `votes` before claiming the tally
starts at zero.

**`201 Created`** (new) / **`200 OK`** (already open)

```json
{
  "message": "PIN reset requested successfully",
  "data": {
    "id": "b8e2…-uuid",
    "status": "pending_quorum",
    "votes": 0,
    "required_votes": 2,
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

**Errors:** `400 INVALID_BODY` · `400 BAD_REQUEST` (account has no active guardians) · `401 INVALID_CREDENTIALS` (unknown address, bad/stale/replayed signature) · `500 INTERNAL_ERROR`.

### `POST /auth/pin-reset/vote` — public

Signed by a **guardian**, action `pin-reset-vote`, argument `request_id`. Reaching quorum starts the contest period.

**Request**

```json
{
  "request_id": "b8e2…",
  "guardian_username": "alice1234abcd",
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64…",
  "password": "the GUARDIAN's own 64-hex token, Paranoid Mode only"
}
```

**`200 OK`**

```json
{
  "message": "Vote recorded successfully",
  "data": {
    "id": "b8e2…",
    "status": "contest_period",
    "votes": 2,
    "required_votes": 2,
    "contest_period_ends_at": "2026-07-28T12:00:00Z",
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`request_id` is not a canonical UUID) · `401 INVALID_CREDENTIALS` (unknown guardian, not an active guardian of that owner, bad signature) · `404 NOT_FOUND` (unknown `request_id`) · `409 CONFLICT` (request no longer in `pending_quorum`) · `500 INTERNAL_ERROR`.

### `PATCH /auth/pin-reset/revoke` — public

Signed by the **owner**, action `pin-reset-revoke`, argument `request_id`. This is the owner's veto against a colluding-guardian takeover.

**Request**

```json
{
  "request_id": "b8e2…",
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64…"
}
```

**`204 No Content`** — no body.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`request_id` is not a canonical UUID) · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `409 CONFLICT` (already `revoked` or `completed`) · `500 INTERNAL_ERROR`.

### `PATCH /auth/pin-reset/confirm` — public

Signed by the **owner**, action `pin-reset-confirm`, arguments `request_id` **and** `new_password` (the new token is part of the signed payload). Only accepted once the request has reached `authorized` — i.e. the contest period elapsed.

**Request**

```json
{
  "request_id": "b8e2…",
  "new_password": "new 64-hex Server_Auth_Token",
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64…"
}
```

**`204 No Content`** — no body.

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`request_id` is not a canonical UUID) · `400 BAD_REQUEST` (`new_password` is not a valid 64-hex token) · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `409 CONFLICT` (not yet `authorized`, or already spent) · `500 INTERNAL_ERROR`.

### `GET /auth/pin-reset/{id}` — public

Polled by the owner. **Reading it also settles the contest period**: if the deadline has passed, the status transitions `contest_period → authorized` on this call.

**`200 OK`**

```json
{
  "message": "PIN reset status retrieved successfully",
  "data": {
    "id": "b8e2…",
    "status": "authorized",
    "votes": 2,
    "required_votes": 2,
    "contest_period_ends_at": "2026-07-28T12:00:00Z",
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

**Errors:** `400 INVALID_PARAM` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `GET /auth/pin-reset/{id}/votes` — 🔒 protected

_Paginated — `?limit=` / `?cursor=`; `page` describes the nested `data.votes` array ([§3.1](#31-pagination))._

The evidence behind a request's vote count, readable only by the account the request belongs to — another account's request returns an empty list rather than an error.

Note this one **is** protected while the rest of the PIN-reset flow is public. The public endpoints have to be: an owner who lost their PIN cannot sign in. This one carries guardian usernames and public keys, so leaving it open would turn a request id into a guardian-set disclosure. Read it after the reset completes, once you can authenticate again.

**`200 OK`**

```json
{
  "message": "PIN reset votes retrieved successfully",
  "data": {
    "action": "pin-reset-vote",
    "request_id": "b8e2…",
    "votes": [
      {
        "guardian_username": "5bdf04be3bc6",
        "guardian_public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…",
        "signature": "base64…",
        "challenge": "2318ddae…",
        "timestamp": 1785345646,
        "voted_at": "2026-07-29T17:20:46Z"
      }
    ]
  }
}
```

Rebuild `challenge : timestamp : "pin-reset-vote" : request_id` and verify against `guardian_public_key`, exactly as for [`GET /succession/votes`](#get-successionvotes).

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /recovery/pin-reset/pending` — 🔒 protected

_Paginated — `?limit=` / `?cursor=`, `page` in the envelope ([§3.1](#31-pagination))._

The guardian's inbox of **open** PIN resets on the accounts they guard.

**`200 OK`**

```json
{
  "message": "Pending PIN resets retrieved successfully",
  "data": [
    {
      "request_id": "b8e2…",
      "owner_username": "3f1c8a2b9d4e",
      "status": "pending_quorum",
      "voted": false,
      "created_at": "2026-07-26T12:00:00Z"
    },
    {
      "request_id": "9c4f…",
      "owner_username": "7a2d5e1b8c3f",
      "status": "contest_period",
      "voted": true,
      "created_at": "2026-07-25T08:00:00Z"
    }
  ]
}
```

> ⚠️ **This is not only "awaiting your vote".** `status` is `pending_quorum` **or** `contest_period` — the list keeps a request visible after quorum is reached, so the guardian can see the outcome of their own vote. **Only `pending_quorum` rows accept a vote**; calling `POST /auth/pin-reset/vote` on a `contest_period` row returns `409 CONFLICT`. Gate the "vote" affordance on `status === "pending_quorum" && !voted`, and render `contest_period` rows as informational. `voted` tells you whether _you_ already voted, which is independent of `status`.

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

---

---

## 12. Succession Endpoints

🔒 All protected. Beneficiaries (heirs) are registered by username; each inherited item's key is wrapped to the beneficiary's hybrid public keys client-side. The server stores only ciphertext and an **encrypted label** — it never learns who inherits what, only that a relationship exists.

> **Most routes below are owner-scoped; the two vote routes are guardian-scoped; and the `/succession/inheritances/…` group is the heir's.** Read this before designing any part of the heir experience — the timing is the whole design.
>
> **Before a release, an heir gets nothing, and that will not change.** An heir is named **unilaterally**: there is no invite, no acceptance, no notification, and **no decline or opt-out endpoint**. An heir holds nothing and does nothing at setup time, so there is nothing for them to accept — and telling them would publish a relationship the owner chose to keep private. Do not render an "accept" or "decline" affordance for heirs, and do not build an "inheritances I am named in" inbox for the unreleased case: `GET /succession/inheritances` **omits an unreleased inheritance entirely**, so an empty array is what a named heir and a stranger both receive. This is the deliberate asymmetry with guardians, who _do_ accept ([§10](#10-recovery-endpoints)), because a guardian must actually hold a Shamir share before the owner can rely on them.
>
> **After a release, the heir claim path is built** — six routes under [`/succession/inheritances/…`](#the-heirs-read-path--successioninheritances). It is gated on the on-chain `Released` state, mirrored by the chain indexer (shipped 2026-08-16) and surfaced as `chain.status` on [`GET /succession/status`](#get-successionstatus). Verify the blob's SHA-256 against the on-chain `ProofRegistry` root **in your own client** before decrypting — never against a "verified" flag from this API, which does not have one.
>
> Note that `GET /succession/status` is owner-scoped: it reports *your* switch, never the switch of someone who named you. An heir learns that an owner released from `GET /succession/inheritances` and from nowhere else.

### `POST /succession/beneficiaries`

Registering the same beneficiary twice **updates** the existing record (upsert). Signed with `beneficiary-register` over `beneficiary_username`, so the four signature fields join the body below.

**Request**

```json
{
  "beneficiary_username": "carol9876ijkl",
  "encrypted_label": "opaque, e.g. encrypted \"my daughter\"",
  "public_key_x25519_snapshot": "base64…",
  "public_key_mlkem_snapshot": "base64…",
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
}
```

| Field                                 | Required      | Notes                                                                                                                                                                                          |
| ------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beneficiary_username`                | ✅            | Must exist and have encryption keys enrolled. Cannot be yourself.                                                                                                                              |
| `encrypted_label`                     | ✅            | Opaque, non-empty.                                                                                                                                                                             |
| `public_key_x25519_snapshot`          | ❌            | If sent, must **exactly match** the beneficiary's currently enrolled key. Send them to prove you wrapped keys against the current keys — a mismatch is rejected rather than silently accepted. |
| `public_key_mlkem_snapshot`           | ❌            | Same.                                                                                                                                                                                          |
| `challenge`, `timestamp`, `signature` | ✅            | The `beneficiary-register` action signature ([§5.3](./front-end-guide.md#53-action-signature-everything-destructive)).                                                                                             |
| `password`                            | Paranoid only | Your second factor.                                                                                                                                                                            |

The server always stores the **currently enrolled** keys, regardless of what you send. If a re-registration ever supersedes the stored snapshot, **all previously assigned inheritance shares are dropped** and `dropped_shares` reports how many — re-assign them. That cannot happen today: enrolment keys are immutable (see the box under `GET /succession/beneficiaries`), so the stored snapshot and the enrolled keys are always equal and **`dropped_shares` never appears in a response**. Handle it if you like, but do not build a flow that depends on receiving it.

**`201 Created`**

```json
{
  "message": "Beneficiary registered successfully",
  "data": {
    "id": "1a2b…-uuid",
    "user_uuid": "0f5c8b1e-…",
    "username": "carol9876ijkl",
    "user_address": "9f2c…64 lowercase hex",
    "encrypted_label": "opaque…",
    "public_key_x25519_snapshot": "base64…",
    "public_key_mlkem_snapshot": "base64…",
    "status": "active",
    "keys_rotated": false,
    "share_count": 0,
    "dropped_shares": 2,
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

`dropped_shares` is omitted when zero, which today means always — see above.

**`user_address` is the heir's, and you need it to assign anything.** `POST /succession/shares` carries a DEK wrapped with PQXDH, whose `info` string is `Cryple-PQXDH-v1|succession-dek|<your user_address>|<heir user_address>` — so without this field you can register an heir and never give them a single item. Do not try to derive it or reverse `GET /users/lookup`; that endpoint maps address → username only. Take it from here or from `GET /succession/beneficiaries`, and treat it as opaque: echo the exact string, never re-case or re-encode it, because it goes into a string that must match byte-for-byte on the heir's side years later.

> ⚠️ **`share_count` is always `0` on this response — it is a GET-only field.** The upsert returns the row it just wrote and never counts the beneficiary's shares, so `0` here means "not computed", not "no shares". Re-registering a beneficiary whose keys are _unchanged_ keeps every existing share and still reports `share_count: 0`. Do not cache this response as your share tally; read the real count from `GET /succession/beneficiaries`. (`keys_rotated` is always `false` here, and on this response that is not informative — a row you just registered by username always points at a live account.)

**Errors:** `400 INVALID_BODY` · `400 BAD_REQUEST` (`encrypted_label` empty, unknown username, self-registration, beneficiary has no encryption keys, or key snapshot mismatch) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `GET /succession/beneficiaries`

_Paginated — `?limit=` / `?cursor=`, `page` in the envelope ([§3.1](#31-pagination))._

**`200 OK`** — `data` is an array of the object above (without `dropped_shares`). This is the only place `share_count` and `keys_rotated` carry real values.

> ⚠️ **`keys_rotated: true` does not mean the heir rotated keys.** There is no key-rotation endpoint: `encryption_public_key_x25519` and `encryption_public_key_mlkem` are written once at enrolment and no route can change them (rotation is post-MVP — see [§14](./front-end-guide.md#14-client-implementation-notes-and-caveats) note 16). The "snapshot no longer matches the enrolled keys" half of this flag therefore cannot fire.
>
> The one way you will see `true` today is that **the heir deleted their account**. The beneficiary row survives with its link to the account severed, so `username`, `user_uuid` and `user_address` come back as **empty strings** and the key comparison has nothing to compare against.
>
> The remedy is the opposite of re-registration. Re-registering needs a username that no longer resolves, so `POST /succession/beneficiaries` answers `400 BAD_REQUEST`, and every `POST /succession/shares` against the row stays blocked with `400`. **`DELETE /succession/beneficiaries/{id}` is the only way to clear it.** Render it as "this heir closed their account — remove them and choose another", never as "re-register and re-assign".

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `DELETE /succession/beneficiaries/{id}`

Signed with `beneficiary-delete` over the path `{id}`. This is the most destructive call in the domain: it **cascades to every inheritance share** for that heir, and those wrapped DEKs can only be regenerated by re-wrapping each item from your client.

**Request** — the body is **required**; it carries the signature that authorizes the call. See [§5.3](./front-end-guide.md#53-action-signature-everything-destructive).

```json
{
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
}
```

**`204 No Content`** — no body.

**Errors:** `400 INVALID_PARAM` · `400 INVALID_BODY` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `POST /succession/shares`

Assigns one legacy item to one beneficiary by storing the item's key wrapped to that heir. Re-assigning the same `(beneficiary, item)` pair **updates** the stored key (upsert). Signed with `share-assign` over `beneficiary_id` and `item_id`, so the four signature fields join the body below.

**Request**

```json
{
  "beneficiary_id": "1a2b…-uuid",
  "item_id": "6b2f…-uuid",
  "item_type": "secret",
  "pq_hybrid_encrypted_item_key": "opaque, DEK wrapped to the heir's hybrid keys",
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only",
  "version": "v1"
}
```

| Field                          | Required | Notes                                                           |
| ------------------------------ | -------- | --------------------------------------------------------------- |
| `beneficiary_id`               | ✅       | UUID from `POST/GET /succession/beneficiaries`.                 |
| `item_id`                      | ✅       | UUID of one of **your** secrets or notes.                       |
| `item_type`                    | ❌       | Omit ⇒ `"secret"`. Accepted: `"secret"`, `"note"` ([§15](#15-notes-endpoints)), `"document"` ([§16](#16-documents-endpoints)). Send it explicitly for anything that is not a secret, or the default sends the server looking for a secrets row with your item's id and you get `404`. |
| `pq_hybrid_encrypted_item_key` | ✅       | Opaque, non-empty.                                              |
| `version`                      | ❌       | Omit/`""` ⇒ `"v1"`.                                             |

**`201 Created`**

```json
{
  "message": "Inheritance share stored successfully",
  "data": {
    "id": "7e3d…-uuid",
    "beneficiary_id": "1a2b…",
    "item_id": "6b2f…",
    "item_type": "secret",
    "pq_hybrid_encrypted_item_key": "opaque…",
    "version": "v1",
    "created_at": "2026-07-26T12:00:00Z"
  }
}
```

**Errors:** `400 INVALID_BODY` · `400 INVALID_PARAM` (`beneficiary_id`/`item_id` not canonical UUIDs) · `400 BAD_REQUEST` (unsupported `version` or `item_type`, empty key, or **stale key snapshot** — re-register the beneficiary first) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` (unknown beneficiary, or the item is not yours) · `500 INTERNAL_ERROR`.

### `GET /succession/beneficiaries/{id}/shares`

_Paginated — `?limit=` / `?cursor=`, `page` in the envelope ([§3.1](#31-pagination))._

**`200 OK`** — `data` is an array of the share object above.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `GET /succession/shares`

_Paginated — `?limit=` / `?cursor=`, `page` in the envelope ([§3.1](#31-pagination))._

Every share you have assigned, across **all** your heirs, in one listing. Same objects as the per-heir route; `beneficiary_id` on each row tells them apart.

Use this whenever you need the *union* of assigned items rather than one heir's list — building the anchored vault tree, or rendering how much of the vault is spoken for. Walking `GET /succession/beneficiaries/{id}/shares` once per heir returns the same rows and costs a paginated walk per heir.

**`200 OK`** — `data` is an array of the share object above.

**Errors:** `400 INVALID_PARAM` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

### `DELETE /succession/shares/{id}`

Signed with `share-delete` over the path `{id}`.

**Request** — the body is **required**; it carries the signature that authorizes the call. See [§5.3](./front-end-guide.md#53-action-signature-everything-destructive).

```json
{
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
}
```

**`204 No Content`** — no body.

**Errors:** `400 INVALID_PARAM` · `400 INVALID_BODY` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

### `PUT /succession/anchors/{epoch}` · `GET /succession/anchors` · `GET /succession/anchors/{epoch}`

The proof material behind an anchored vault root. **Without it your heirs cannot verify anything**, so this is not an optional companion to anchoring — it is half of it.

An inclusion proof needs the sibling hashes along the path, and an heir holds only the items assigned to them. Every other leaf belongs to an item they will never see, so the on-chain root alone gets them nowhere. These routes are where the sibling hashes live.

> ⚠️ **Upload the leaf set _before_ you submit the userOp, in the same pass.** A crash between the two must leave a leaf set with no root — harmless, it is overwritten by the real one at that epoch — and never a root with no leaf set, which is an anchor nobody can prove against and which you cannot repair, because the epoch is frozen on-chain.

**`PUT /succession/anchors/{epoch}`** — `{epoch}` is the anchor's epoch as a positive integer.

```json
{
  "root": "0x… 32 bytes of hex",
  "leaves": ["0x…", "0x…", "0x…"]
}
```

`leaves` are the leaf hashes **in tree order** — canonical order is `(item_type, item_id)`, the same order you built the root from. Order is part of the value: re-sorting produces a different root and the write is refused. Both fields accept upper or lower case, with or without the `0x` prefix, and come back normalized to lowercase with the prefix. Maximum 10,000 leaves.

**`201 Created`** on the first write for that epoch, **`200 OK`** when the identical set is already stored — retry freely, a repeat is a success.

```json
{
  "message": "Anchored leaf set stored successfully",
  "data": {
    "epoch": 20685,
    "root": "0x…",
    "leaf_count": 3,
    "leaves": ["0x…", "0x…", "0x…"],
    "created_at": "2026-08-20T12:00:00Z",
    "chain": { "root": "0x…", "matches": true }
  }
}
```

`chain` is **absent** until the indexer has seen the anchor on-chain, which is the normal state for the first few seconds after anchoring — absent means "not indexed yet", never "mismatch". Once present, `matches: false` means the stored set does not describe what is on-chain; an heir will fail verification against it, so re-anchor rather than leaving it.

**Errors:** `400 INVALID_PARAM` (epoch not a positive integer) · `400 INVALID_BODY` · `400 BAD_REQUEST` (root or a leaf is not a 32-byte hash, the set is empty or over 10,000, or **the leaves do not produce the declared root** — you re-sorted them, or they are not the set you anchored) · `401 UNAUTHORIZED` · `409 CONFLICT` (the chain already anchored a **different** root for this epoch) · `500 INTERNAL_ERROR`.

> **A retry after a failed anchor is fine, even with a different root.** Uploading before the userOp means a failed anchor leaves a set behind; if your vault changed before you retried, just upload the new set for the same epoch and it replaces the old one. What you cannot do is contradict the chain: once that epoch is anchored on-chain, only the root it actually holds is accepted, and `409` there is not retryable — recompute at the current epoch.

**`GET /succession/anchors/{epoch}`** returns the same object. `404` when nothing is stored for that epoch.

**`GET /succession/anchors`** — _paginated_ — lists epochs **newest first** with `epoch`, `root`, `leaf_count` and `created_at`, and **no `leaves`** (a listing of full sets would be megabytes). This is the lookup an heir's client makes: the newest epoch at or before the release moment, not the latest root.

> **This is a `PUT`, not a signed action**, unlike everything else in §12. Nothing is destroyed or replaced, so the JWT covers it, and the content proves itself — a set that does not rebuild the on-chain root fails in the heir's browser regardless of who uploaded it.

### The heir's read path — `/succession/inheritances/…`

Everything else in §12 is you acting on **your own** account. These six routes are the other side: reading an account that named **you** as an heir, after its dead man's switch has released on-chain. They are what makes an inheritance actually arrive.

`{owner}` in every path is the owner's `user_address` (64 lowercase hex; anything else is `400 INVALID_PARAM`). You get it from the listing below, and you need it anyway — your item keys were wrapped under `Cryple-PQXDH-v1|succession-dek|<owner user_address>|<your user_address>`.

> **Every failure is the same `404`.** Not named, named but the owner is alive, owner does not exist, item not assigned to you — one response for all of them. Do not try to distinguish them, and do not render "you may be an heir": you cannot know that, by design.

#### `GET /succession/inheritances`

Accounts that named you **and have released**. Unpaginated.

```json
{
  "message": "Inheritances retrieved successfully",
  "data": [
    {
      "owner_user_address": "9f2c…",
      "owner_username": "alice1234abcd",
      "smart_account_address": "0x…",
      "beneficiary_id": "1a2b…-uuid",
      "item_count": 3,
      "released_at": 1771200000
    }
  ]
}
```

> **An empty array is the normal answer, and it is not informative.** An account that named you but whose owner is alive is **omitted entirely** — not listed as pending, not counted. That is deliberate: an heir who knows they are named can watch the owner's public on-chain check-in cadence and infer their health. Never build a "you are an heir to N people" surface; this endpoint cannot answer it.

`smart_account_address` is there because **you** read `ProofRegistry` on-chain — see the verification note below.

#### `GET /succession/inheritances/{owner}/items`

One row per item left to you, in canonical `(item_type, item_id)` order — the same order the anchored leaves were built in.

```json
{
  "id": "share uuid",
  "beneficiary_id": "1a2b…-uuid",
  "item_id": "3f6b…-uuid",
  "item_type": "secret | note | document",
  "pq_hybrid_encrypted_item_key": "opaque…",
  "version": "v1",
  "created_at": "2026-07-26T12:00:00Z"
}
```

`pq_hybrid_encrypted_item_key` is the item's DEK, PQXDH-wrapped to the encryption keys you had enrolled when the owner assigned it. Unwrap it with your own seed-derived keys and `usage=succession-dek`.

#### `GET /succession/inheritances/{owner}/items/{id}`

The ciphertext.

```json
{
  "item_id": "3f6b…-uuid",
  "item_type": "secret",
  "version": "v1",
  "ciphertext": "opaque…",
  "snapshot_ciphertext": "opaque… (documents only)",
  "snapshot_seq": 7
}
```

A secret or a note carries `ciphertext`; a document carries `snapshot_ciphertext` and `snapshot_seq` instead. **The bytes are byte-identical to what the owner stored** — the leaf commits to `hex(SHA-256(blob))` of exactly these, so re-encoding them anywhere in your pipeline breaks a proof that is otherwise correct.

The owner's own `wrapped_dek` is **not** returned. It is sealed to their vault KEK and useless to you; your copy of the key is in the share.

#### `GET /succession/inheritances/{owner}/items/{id}/updates?since=`

_Paginated._ A document's delta log past `since` (default `0`). `400 INVALID_PARAM` for a negative or non-integer `since`. `404` for any item that is not a document.

> ⚠️ **Everything this returns is unverifiable, by construction.** The anchored leaf covers the **snapshot only**; these deltas were appended after the compaction that produced it. You need them — a document without its deltas is stale — but you must render the difference. "Verified as of the owner's last save, plus later edits that carry no proof" is the honest presentation; a single "verified ✓" over the merged document is not.

#### `GET /succession/inheritances/{owner}/anchors` and `…/anchors/{epoch}`

The owner's retained leaf sets, same shapes as [the owner's own routes](#put-successionanchorsepoch--get-successionanchors--get-successionanchorsepoch). The listing is newest-epoch-first and carries counts without leaves; fetch the one epoch you need.

**Pick the newest epoch at or before `released_at`**, not the latest one. Past epochs are frozen on-chain, so that root describes the vault as it stood while the owner was alive.

#### Verifying — this part is yours, not ours

```
1. GET the leaf set for your chosen epoch
2. Read latestRoot/rootAt(epoch) from ProofRegistry ON-CHAIN, using smart_account_address
3. Rebuild the root from the leaf set — it must equal the chain's
4. Compute your item's leaf: SHA-256("cryple.vault.leaf.v1|<item_type>|<item_id>|<hex(SHA-256(blob))>")
5. Verify its inclusion proof against that root
6. Only then: PQXDH-unwrap the DEK, AES-GCM-open the ciphertext
```

> **This API never tells you an item verified, and you must never ask it to.** There is no `verified` field on any response and there will not be one. Step 2 reads the chain directly — a root this server hands you proves nothing, because this server is exactly what the verification is meant to be independent of. If step 3 or 5 fails, show the failure; do not decrypt and hope.

### `POST /succession/votes`

Called by a **guardian** (their own JWT) to attest the owner is deceased/incapacitated. Reaching quorum moves the trigger from `monitoring` to `counting_down`. Signed action `succession-release-vote` with the **owner's `user_address`** and the **current `release_cycle`** as its arguments, in that order.

> **The cycle argument is required as of 2026-07-29 and is a breaking change.** A signature that omits it is refused with `401`. Read it as `owner_release_cycle` from [`GET /recovery/guardianships`](#get-recoveryguardianships--protected) immediately before signing — not from `GET /succession/status`, which is owner-scoped and reports _your_ switch, not theirs. Binding the cycle stops a vote cast in one countdown from being re-attributed to the next.

**Request**

```json
{
  "owner_username": "3f1c8a2b9d4e",
  "challenge": "7f3b…",
  "timestamp": 1785000000,
  "signature": "base64…",
  "password": "the GUARDIAN's own 64-hex token, Paranoid Mode only"
}
```

**`200 OK`**

```json
{
  "message": "Release vote recorded successfully",
  "data": {
    "status": "counting_down",
    "votes": 2,
    "required_votes": 2,
    "release_cycle": 1,
    "inactivity_threshold_days": 180,
    "trigger_started_at": "2026-07-26T12:00:00Z",
    "chain": { "...": "same shape as GET /succession/status" }
  }
}
```

**A quorum no longer guarantees `counting_down`.** Since Task 52a the countdown starts only when the chain agrees the owner has gone silent; a quorum reached while `chain.status` is `active` and the trigger deadline has not passed records the vote and leaves `status` at `monitoring`. Read `status` from the response rather than assuming the vote moved it.

**Errors:** `400 INVALID_BODY` · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (bad/stale/replayed action signature) · `404 NOT_FOUND` (unknown owner, or caller is not an active guardian) · `409 CONFLICT` (already released) · `500 INTERNAL_ERROR`.

### `GET /succession/status`

The **owner's own** dead-man's-switch state. Creates the trigger record on first read, so it never 404s for a valid account.

**`200 OK`**

```json
{
  "message": "Release status retrieved successfully",
  "data": {
    "status": "monitoring",
    "votes": 0,
    "required_votes": 1,
    "release_cycle": 1,
    "inactivity_threshold_days": 180,
    "chain": {
      "indexed": true,
      "smart_account_address": "0x4dcb2c4a8d8b42f58522ed7e116bb33fc75843b1",
      "status": "active",
      "last_check_in": 1771200000,
      "inactivity_period_seconds": 600,
      "contest_period_seconds": 300,
      "triggerable_at": 1771200600
    }
  }
}
```

> ⚠️ **`status` and `chain.status` are two different things, and merging them is a bug.** `status` is the *off-chain guardian countdown* and only ever reads `monitoring` or `counting_down`. `chain.status` is the contract's own state and is the only one that can say `released`. **Anything that gates on "can this inheritance be opened" reads `chain.status`.** See [§13](#13-enumerations).

> ⚠️ **`chain` timestamps are unix seconds (numbers); everything outside `chain` is RFC 3339 (strings).** That is deliberate — the chain values are block timestamps, and reformatting them would make this API disagree with the chain in a way nobody could see. Do not feed `chain.last_check_in` to a date parser expecting ISO 8601.

> ⚠️ **`trigger_started_at` and the optional `chain.*` timestamps are absent, not `null`.** The server **omits the key entirely** when unset — there is no `"trigger_started_at": null` in any response. Type them `| undefined` and test with `in` or `!== undefined`; a client typing them `| null`, or branching on `=== null`, takes the wrong path on every response.

**`chain.indexed: false` means "not configured on-chain", never "safe."** Every other `chain` field is then absent. It is the state of a smart account whose owner has not yet run `configure()` — or, rarely, one whose events the indexer has not read. `smart_account_address` is populated either way, because it is derived at sign-up and known long before the smart account exists on-chain.

> ⚠️ **`chain.status: "unknown"` is not the same as `unconfigured`, and it is not a contract state.** It means the API could not read the chain mirror at all — an infrastructure fault on our side, not a fact about the owner's switch. `indexed` is `false` in both cases, so **branch on `chain.status`, not on `indexed`, when the difference matters.** Render `unknown` as "chain status unavailable, retry", never as "not set up": an owner whose switch is genuinely in Contest can see `unknown` during an outage. Nothing that gates opening an inheritance may treat it as permission, and the API does not either.

> ⚠️ **"Account" and "smart account" are two different things in this API.** A bare **account** is the user's Cryple account, identified by `user_address` (64-char hex, the SHA-256 of their seed) — that is what `GET /users/me`, `DELETE /users` and the `account-delete` signed action all operate on. A **smart account** is their ERC-4337 contract on Arbitrum, identified by an Ethereum address, and every field naming it carries the `smart_` prefix. They are never interchangeable and never equal.

`chain.triggerable_at` is `last_check_in + inactivity_period_seconds`, present only while `chain.status` is `active`. It is what a countdown UI counts down to. It is derived per request rather than stored, because the contract recomputes it on every read and a stored copy would go stale on each check-in.

`required_votes` is clamped to the number of **active** guardians (minimum 1), so it can be lower than the configured quorum while guardians are still pending.

`votes` counts only approvals from guardians who are **still active** and were cast in the **current countdown attempt**. Revoking a guardian therefore lowers the tally — expect it to move after a `DELETE /recovery/guardians/{id}`, and re-read this endpoint rather than caching a previous count. (The per-attempt scoping matters once the chain indexer lands: an owner who cancels a countdown on-chain must not find the old quorum still standing when the switch returns to `monitoring`.)

`release_cycle` is the countdown attempt those votes are being counted in. A guardian must sign it as part of `succession-release-vote` — but **not from here**: this endpoint is owner-scoped and reports _your_ switch, not the switches you guard. Guardians read the value they must sign from `owner_release_cycle` on [`GET /recovery/guardianships`](#get-recoveryguardianships--protected). What this field is for is your own view of your own countdown.

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

> **Not in this API:** the heartbeat/check-in itself, and the switch's on-chain configuration. Both are **owner actions signed on the owner's device** — nothing server-side can check in on a user's behalf, and that is the invariant the whole product rests on. The chain indexer mirrors the results here; it cannot produce them.
>
> **The "I'm alive — cancel" button is a chain transaction, not a call to this API.** There is deliberately no `PATCH /succession/cancel`: a second exit the chain never witnessed could clear a countdown while the chain was genuinely in Contest. The button calls `DeadManSwitch.checkIn()`, the indexer sees `Revoked`, and `status` returns to `monitoring` with `release_cycle` incremented.
>
> `inactivity_threshold_days` at the top level is the owner's *preference* and is still API-configurable in principle; `chain.inactivity_period_seconds` is what actually fires the switch once the account is configured. When they disagree, the chain value is the true one.

### `GET /succession/votes`

_Paginated — `?limit=` / `?cursor=`; `page` describes the nested `data.votes` array ([§3.1](#31-pagination))._

The **owner's own** view of the evidence behind their vote count, for the current cycle. Guardians see only their own record here, not the owners they guard.

**`200 OK`**

```json
{
  "message": "Release votes retrieved successfully",
  "data": {
    "action": "succession-release-vote",
    "owner_user_address": "c259bee5…",
    "release_cycle": 1,
    "votes": [
      {
        "guardian_username": "5bdf04be3bc6",
        "guardian_public_key": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…",
        "release_cycle": 1,
        "signature": "base64…",
        "challenge": "2318ddae…",
        "timestamp": 1785345646,
        "voted_at": "2026-07-29T17:20:46Z"
      }
    ]
  }
}
```

`votes` is `[]` when nobody has voted, never `null`.

Each entry carries everything needed to check the approval independently: rebuild `challenge : timestamp : action : owner_user_address : release_cycle`, SHA-256 it, and verify against `guardian_public_key` (ECDSA P-256, IEEE P1363 — the same encoding you produce when signing). The response deliberately does **not** hand you a ready-made payload string: verifying a signature against the server's own account of what was signed proves nothing, so rebuild it from the labelled fields.

Like `GET /succession/status`, this read is scoped to **your own** record and to the **current** cycle. Votes from a previous cycle, and votes cast by guardians you have since revoked, are not listed — the list therefore matches `votes` on the status endpoint entry for entry.

**Errors:** `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` · `500 INTERNAL_ERROR`.

---

---

## 13. Enumerations

**Guardian status** (`GET /recovery/guardians`, `/recovery/guardianships`)

| Value            | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| `pending_invite` | Invited; must call `PATCH /recovery/guardians/{id}/accept`. |
| `active`         | Accepted; can hold shares and vote.                         |
| `revoked`        | No longer a guardian.                                       |

**Recovery session status** (`GET /recovery/session/{id}`)

| Value              | Meaning                                           |
| ------------------ | ------------------------------------------------- |
| `pending`          | Collecting guardian shares.                       |
| `shares_collected` | Threshold reached; `shares` are returned.         |
| `expired`          | TTL elapsed; further reads return `409 CONFLICT`. |

Those three are the only values the API ever emits. The database column also allows `completed`, which **no code path writes** — it survives only inside an internal guard clause. Do not write a `completed` branch; it is unreachable. A session that has served its shares stays `shares_collected` until it expires.

**PIN reset status** (`GET /auth/pin-reset/{id}`)

| Value            | Meaning                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `pending_quorum` | Awaiting guardian votes.                                                  |
| `contest_period` | Quorum reached; owner may still revoke until `contest_period_ends_at`.    |
| `authorized`     | Contest period elapsed; `PATCH /auth/pin-reset/confirm` will be accepted. |
| `revoked`        | Cancelled by the owner.                                                   |
| `completed`      | New second factor installed.                                              |

**Beneficiary status** (`GET /succession/beneficiaries`)

| Value    | Meaning                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `active` | Registered and usable. The API always writes this value; the schema also allows `pending_invite`, which no endpoint currently produces. |

**Release trigger status** — `data.status` on `GET /succession/status`

The **off-chain guardian countdown**, and only that. These two are the only values it can hold; a `CHECK` constraint enforces it in the database.

| Value           | Meaning                                       |
| --------------- | --------------------------------------------- |
| `monitoring`    | No guardian countdown running.                |
| `counting_down` | Quorum of guardians voted; countdown running. |

**Chain switch status** — `data.chain.status` on `GET /succession/status`

The `DeadManSwitch` contract's own state, mirrored by the chain indexer. **This is the one that decides whether an inheritance can be opened.**

| Value          | Meaning                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `unconfigured` | The owner has never called `configure()`. Also what you get when `indexed` is `false`. |
| `unknown`      | **Not a contract state.** The API could not read the chain mirror. Says nothing about the switch — retry rather than rendering it as a state. |
| `active`       | The switch is armed and the owner is checking in. Counts down to `triggerable_at`. |
| `contest`      | Someone called `trigger()` after the deadline. The owner can still cancel by checking in, until `releasable_at`. |
| `released`     | `finalize()` ran. **Terminal — there is no on-chain undo.**                     |

The two vocabularies are deliberately disjoint so that no code can confuse one for the other. **Nothing off-chain ever reads `released`**; if you are waiting for a release, watch `chain.status`.

**The old single-status shape is gone.** Before 2026-08-16 this field was documented as possibly reaching `released` or `cancelled`; it never could, and it now formally cannot — those two values were removed from the column and a `CHECK` enforces the remaining pair. Release lives on `chain.status`. If you have a client branching on `status === "released"`, it is dead code and always was.

---

## 15. Notes Endpoints

🔒 All protected. A "note" is one encrypted plain-text note — a letter, a set of instructions, anything the user types. The server stores the same three opaque strings a secret carries and never decrypts anything.

**Why this is not `/secrets`.** Notes get **edited**. `POST /secrets` is create-or-return and there is no `PUT /secrets`, because a seed phrase is written once. A letter is revised, so notes get their own resource with `PUT /notes/{id}`. Everything else deliberately matches the secrets contract: client-supplied `id`, the same idempotency rule, the same `{"code":…}` errors, the same `404` for "not yours".

**The 5000-character limit is yours to enforce.** The server never sees plaintext, so it cannot count characters. What it enforces is a ceiling on the base64 `ciphertext` string: **32,768 characters**. That is derived from the worst case — 5000 four-byte UTF-8 characters seal to 26,708 base64 characters — so a client that honours the 5000-character rule can never hit it. Exceeding it is `400 BAD_REQUEST`, indistinguishable on the wire from any other bad request. Enforce 5000 characters in your editor; treat the server ceiling as a backstop against your own bugs, not as the user-facing limit.

### `POST /notes`

Creates a note. **JWT only** — no challenge, no signature, no PIN.

**Request**

```json
{
  "id": "6b2f…-uuid, generated by you",
  "ciphertext": "base64 AES-256-GCM blob produced client-side",
  "wrapped_dek": "base64 DEK wrapped to the owner's key",
  "version": "v1"
}
```

| Field         | Required           | Notes                                                                                                                                     |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | ❌ but **send it** | A canonical UUID you generate. This is what makes the call safe to retry. Omit it and the server generates one, and the call stops being idempotent. Non-canonical ⇒ `400 INVALID_PARAM`. |
| `ciphertext`  | ✅                 | Opaque. Non-empty, at most 32,768 characters.                                                                                             |
| `wrapped_dek` | ✅                 | Opaque. Must be non-empty.                                                                                                                |
| `version`     | ❌                 | Omit or `""` ⇒ defaults to `"v1"`. Any other value is rejected.                                                                           |

**`201 Created`** when the note was stored — **`200 OK`** when you sent an `id` that was already stored. Same body either way:

```json
{
  "message": "Note added successfully",
  "data": {
    "id": "6b2f…-uuid",
    "ciphertext": "base64…",
    "wrapped_dek": "base64…",
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
  "version": "v1"
}
```

**`200 OK`** with the stored note. `created_at` does not move; `updated_at` advances.

> **⚠️ Re-seal under the same DEK. Do not generate a new one.**
>
> When you assign a note to an heir, the server stores that note's DEK wrapped to the heir's public keys. If you re-key the note on an edit, that stored value still unwraps to the **old** DEK, which no longer opens the new ciphertext. The heir's inheritance is broken, and **nothing reports it** — both fields are opaque, so the server cannot tell a re-seal from a re-key, and the failure only surfaces at release, when the owner is not around to fix it.
>
> Keep the item DEK, encrypt the new plaintext under it, and send back the **same** `wrapped_dek` you were given. If you must rotate a note's DEK, re-assign every affected share via `POST /succession/shares` in the same operation — `GET /succession/beneficiaries/{id}/shares` tells you which heirs hold it.

**This is a strict update, never an upsert.** A `PUT` to an id that does not exist returns `404` and creates nothing. If it created rows, a `PUT` arriving after a `DELETE` would resurrect a note whose heir assignments were already gone — the note back, the inheritance silently not.

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
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
}
```

The note id is signed as an argument, so a signature captured for one note cannot delete another.

**`204 No Content`** — no body.

**Errors:** `400 INVALID_PARAM` · `400 INVALID_BODY` (absent or not valid JSON) · `401 UNAUTHORIZED` · `401 INVALID_CREDENTIALS` (bad signature, or a second factor that does not match the account's mode) · `404 NOT_FOUND` · `500 INTERNAL_ERROR`.

> **Deleting a note also deletes what heirs inherited of it.** Every wrapped key assigned to that note is removed in the same transaction, so deleting one note silently shrinks the inheritance of every heir it was assigned to. Nothing else is affected. Warn before deleting a note that is assigned to someone (`GET /succession/beneficiaries/{id}/shares` tells you which), and treat any cached `share_count` from [§12](#12-succession-endpoints) as stale afterwards.

### `DELETE /notes` — batch

One `note-delete` signature covering a whole set, so a multi-select delete costs one seed prompt instead of N. **Sort the ids ascending and de-duplicate them**, then sign them as consecutive arguments — the server rebuilds the payload the same way, so the order you send them in does not matter, but the set must match.

**Request:**

```json
{
  "ids": ["3f6b…-uuid", "9b2e…-uuid"],
  "challenge": "64 lowercase hex characters",
  "timestamp": 1737676800,
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
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

> **This route deletes heir assignments too**, on exactly the same terms as the single-note delete above — every wrapped key for every note in the set, in one transaction.

### Notes and succession

A note is inheritable exactly like a secret. Assign one with `POST /succession/shares` and `"item_type": "note"` ([§12](#12-succession-endpoints)) — the server checks the note belongs to you before storing the wrapped key. Omitting `item_type` still defaults to `"secret"`, so **send it explicitly for notes**; the default would make the server look for a secrets row with your note's id and answer `404`.

---

## 16. Documents Endpoints

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

**Request:** `{ "id": "6b2f…-uuid, generated by you", "wrapped_dek": "base64", "version": "v1" }`

`id` is optional but **send it** — same idempotency contract as `POST /notes`: a replay returns `200` with the stored row instead of creating a second document. Ids are scoped to your account.

**`201 Created`** (or **`200 OK`** on replay):

```json
{
  "message": "Document added successfully",
  "data": {
    "id": "6b2f…-uuid",
    "wrapped_dek": "base64…",
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

Rotates the document's wrapped DEK. **JWT only.** Guarded by `expected_revision` → `409 CONFLICT` on a stale write.

> **Rotating the DEK invalidates the whole log, not one blob.** Every delta and the snapshot are sealed under the same document DEK. Compact first, then rotate, then re-assign every heir who holds this document via `POST /succession/shares` — otherwise their inheritance breaks silently and only surfaces at release.

### `DELETE /documents/{id}`

Deletes a document, its entire update log, and every heir assignment for it. **Requires a `document-delete` signed action**, unlike create, edit and compact.

**Request:** `{ "challenge": "…", "timestamp": 1737676800, "signature": "…", "password": "Paranoid Mode only" }`

**`204 No Content`** — no body.

### `DELETE /documents` — batch

One `document-delete` signature covering a whole set. **Sort the ids ascending and de-duplicate them before signing** — the server rebuilds the payload the same way.

**`200 OK`:** `{ "requested": 2, "deleted": 2 }`

`deleted` can be lower without being an error. An empty id set is `404 NOT_FOUND`, returned before the signature is checked so it cannot burn a challenge.

### Documents and succession

A document is inheritable. Assign one with `POST /succession/shares` and `"item_type": "document"` ([§12](#12-succession-endpoints)), using the document's `id` exactly as this section returns it.
