# Cryple API — Endpoint Reference

Every HTTP endpoint the server exposes: the exact request payload it accepts, the success response it returns, and every error response it can produce.

This describes the API **as implemented**, not as specified. Where the implementation and `.docs/` disagree, this file follows the code.

**Read [front-end-guide.md](./front-end-guide.md) first.** It carries what you need before any call here will work: the base URL, CORS and transport limits, how to build the challenge and action signatures that most of these endpoints require in their request body, JWT usage, and the client caveats. This file assumes all of it. Paths below are served exactly as written — the API has no version prefix.

Section numbers are **not contiguous** — they are the original numbering from before this file was split out of the guide, kept so that every `§N` reference in `.docs/` and the module READMEs still resolves. §1, §2, §5 and §14 live in the guide. §12 (Notes) and §16 (Documents) were added after the split and took free numbers rather than topical ones, for the same reason: renumbering would break every existing reference. §10 and §11 held recovery and PIN reset, and are kept as a single removal notice rather than reused.

> **This file is a synced copy.** The authoritative original is
> `front-end-endpoints.md` in the `api-general` repository, which is where the API is
> implemented. The only differences between the two copies are relative link prefixes —
> a path that reads `.docs/…` there reads `../api-general/.docs/…` here. Re-sync by
> copying the file across and rewriting those prefixes. **Check them by hand** — the script
> that used to catch a prefix that did not get rewritten was removed on 2026-09-06.

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
| 401  | `UNAUTHORIZED`        | Missing, malformed, expired or invalid `Authorization: Bearer` token.                                                                                                                                                                                                              |
| 401  | `INVALID_CREDENTIALS` | Second factor (`password`) wrong, an action signature failed to verify, **or the JWT is valid but its account no longer exists**.                                                                                                                                                  |
| 404  | `NOT_FOUND`           | Resource does not exist, is not yours, **or** authentication failed on an auth endpoint.                                                                                                                                                                                           |
| 405  | `METHOD_NOT_ALLOWED`  | The path exists but does not accept this verb.                                                                                                                                                                                                                                     |
| 409  | `CONFLICT`            | The resource is not in a state that accepts the request.                                                                                                                                                                                                                                                                                                                               |
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
| `encryption_public_key_x25519` | ✅       | Stored as-is, for other accounts to fetch and encrypt to.          |
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
| `username`     | The auto-assigned username ([§8](#8-users-endpoints)); this is how one account addresses another. |
| `uuid`         | Your public identifier — feed it to `GET /users/{uuid}/public-keys`.                                             |
| `has_password` | **`true` = Paranoid Mode**, `false` = Standard Mode. Always present, never omitted.                              |
| `created_at`   | Account creation.                                                                                                |

**Call this on first launch after a restore.** `has_password` is the one fact a client cannot derive and cannot safely cache: it decides whether to prompt for a PIN, and a reinstall wipes local state. The alternative — probing `/sign-in` and reading the `404` — burns a challenge, costs the 350 ms floor, and returns the same `404` for a wrong PIN, a wrong seed and a nonexistent account. See [§5.4](./front-end-guide.md#54-standard-mode-vs-paranoid-mode).

It is also how you confirm a `POST /users/second-factor` that timed out actually landed: that call's retry is ambiguous by design, and this is the read-back it was missing.

**Deliberately not here:** anything the account has configured. This endpoint answers "who am I", not "what have I set up".

**Errors:** `401 UNAUTHORIZED` (missing or invalid token) · `404 NOT_FOUND` (the token is valid but the account no longer exists — it was deleted; treat it as signed out) · `500 INTERNAL_ERROR`.

### `GET /users/lookup?address={user_address}` — public

Resolves an address to its auto-assigned username.

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

Fetches a user's hybrid encryption keys so the client can PQXDH-wrap a DEK for them.

**No client calls this today.** Its two callers — heir DEK wrapping and guardian share wrapping — left with inheritance and with recovery. It is the endpoint private sharing (Task 102) is built on, and the reason `user_keys` is still written at sign-up.

**Before sharing ships, note the gap:** these keys come from the server, and a client has no way today to distinguish an account's real keys from keys the server substituted. Task 104 owes at least a comparable fingerprint.

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

> The "already has a second factor" case returns the same `401` as a bad signature, so this endpoint is never an oracle for which mode an account is in. Changing an existing PIN needs `PUT /users/password` and the current token. **If you do not have the current token there is no path at all** — see §10–11.

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

Deletes the account and, by cascade, its secrets, notes and documents. **Irreversible.**

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

> **Storing a note rather than a secret?** Notes are a separate resource with the same shape plus an edit route — see [§12](#12-notes-endpoints). Use `/notes` for anything the user types and later revises; use `/secrets` for material written once, like a seed phrase.

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
  and so is a forgotten PIN on a Paranoid account — `PUT /users/password` changes
  a PIN the user still knows and is the only way a PIN ever changes.
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

🔒 All protected. Editable encrypted plain text.

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
  "signature": "base64 P1363 signature",
  "password": "64-hex token, Paranoid Mode only"
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

> **Rotating the DEK invalidates the whole log, not one blob.** Every delta and the snapshot are sealed under the same document DEK, so compact first and then rotate.

### `DELETE /documents/{id}`

Deletes a document and its entire update log. **Requires a `document-delete` signed action**, unlike create, edit and compact.

**Request:** `{ "challenge": "…", "timestamp": 1737676800, "signature": "…", "password": "Paranoid Mode only" }`

**`204 No Content`** — no body.

### `DELETE /documents` — batch

One `document-delete` signature covering a whole set. **Sort the ids ascending and de-duplicate them before signing** — the server rebuilds the payload the same way.

**`200 OK`:** `{ "requested": 2, "deleted": 2 }`

`deleted` can be lower without being an error. An empty id set is `404 NOT_FOUND`, returned before the signature is checked so it cannot burn a challenge.
