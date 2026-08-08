# `lib/api` — the HTTP layer

The one place that knows how to talk to the Cryple API: base URL, envelopes, status rules,
error codes, pagination and the JWT. Nothing above this layer builds a URL or reads a raw
`Response`.

Tasks 7 and 9 of [tasks.md](../../../tasks.md). Governed by
[front-end-guide.md](../../../front-end-guide.md) §2 and §5.5 and
[front-end-endpoints.md](../../../front-end-endpoints.md) §3–4.

## Base URL

`NEXT_PUBLIC_BASE_API_URL` points at the API root; default `http://localhost:8080`. Trailing
slashes are stripped once, here.

**There is no version segment.** Route constants are written exactly as the endpoint reference
writes them (`/sign-up`, `/users/me`) and concatenated onto the base — a future prefix is the
thing you will want to change in one place, so it belongs in the base URL and nowhere else.
`GET /health` and `GET /ready` sit at the same root and are not called by this client.

## `request()`

```ts
const { status, message, data, page } = await request<T>({
  method, path, body?, token?, query?, timeoutMs?, signal?
});
```

- **Headers are only `Content-Type` and `Authorization`.** CORS allows nothing else, so a
  custom header fails preflight. `Content-Type` is set only when there is a body.
- **`credentials` is never set.** The API uses a bearer token, not cookies, and with
  `Access-Control-Allow-Origin: *` the browser would reject a credentialed response.
- **Timeouts floor at 2s** (`MIN_TIMEOUT_MS`), default 30s. Public endpoints have a **350 ms
  response floor**, so a short timeout would fail healthy calls. Never treat response time as
  a signal.
- **Bodies over 1 MiB throw `RequestTooLargeError` before sending.** The server answers
  `400 INVALID_BODY` for both oversized and malformed bodies, so checking locally is the only
  way to tell the user which it was. Budget ~700 KiB of plaintext per secret.
- **Transport failures become `NetworkError`**, so callers never see a bare `TypeError`.

### Status handling is by response, never by verb

| Code | Meaning |
| --- | --- |
| `201` | Something was created **by this call** |
| `200` | A read, a transition, or a create-or-return that returned |
| `204` | Succeeded, nothing to say — **no body at all** |

`DELETE /recovery/guardians/{id}` and `DELETE /secrets` (batch) answer `200` **with a body you
must read**. The rule is *"`204` or a body"*, never *"`DELETE` means `204`"*.

### Errors

`ApiError` carries `code`, `status`, `endpoint` and (on a `405`) `allow`. **There is no
`message` or `error` field on the wire** — the server drops human-readable text deliberately,
so all user-facing copy is built here from `code` + endpoint by `userMessageFor()`.

Three predicates matter more than the raw code:

| Predicate | Means |
| --- | --- |
| `isSessionOver` | `401 UNAUTHORIZED` — token missing/expired. **Sign in again from scratch.** |
| `isCredentialFailure` | `401 INVALID_CREDENTIALS` — token is fine, the account or second factor is not. Reachable on a plain `GET`. **Not an expiry signal.** |
| `isAuthEndpointRejection` | `404` from `/sign-up`, `/sign-in`, `/auth/verify` — deliberately ambiguous |

A URL matching no route at all returns `404` as `text/plain`; that is parsed into a
`NOT_FOUND` `ApiError` rather than crashing the JSON reader.

**Never render "user not found" for an auth `404`.** Unknown account, wrong signature and
wrong PIN are all the same code, by design — see [`lib/auth`](../auth/README.md).

## Optional fields

Optional fields are **absent, never `null`**. Types use `?` / `| undefined`, and checks use
`!== undefined` or `in`. Typing one `| null` takes the wrong branch on every response.

## UUIDs

`isCanonicalUuid` / `assertCanonicalUuid` / `canonicalizeUuid`. The only accepted spelling is
36-character lowercase hyphenated; the four others some libraries emit are `400 INVALID_PARAM`.

This matters beyond tidiness: **an id is part of the signed payload**, so "what you send" and
"what you sign" must be the same bytes. Convert once at the edge — `canonicalizeUuid` — and
otherwise echo back exactly the string the API gave you.

## Pagination

`collectPages(fetchPage)` follows `next_cursor` until `has_more === false`.

- **A short page is not the last page.** Only `has_more` ends the loop.
- **Cursors are opaque** — never built, parsed or persisted. What they encode is allowed to
  change without notice.
- Eight endpoints paginate. **`GET /secrets` does not**, in either form.
- On the two vote reports, `page` describes `data.votes`, not `data`.
- `maxPages` (default 1000) is a runaway guard, not a limit anyone should hit.

## JWT lifecycle

`TokenStore` holds the token in memory, `decodeJwtClaims` / `jwtExpiresAt` / `isJwtExpired`
read the `exp` claim without verifying it (the client cannot — it has no HMAC key).

- Default lifetime **24 hours**. `get()` self-clears an expired token.
- **There is no refresh, revocation or logout endpoint.** Deleting our copy *is* logout.
  `signOut` in [`lib/auth`](../auth/README.md) does that and locks the keystore.
- **Never tell the user that changing their PIN signed out their other devices.** It did not.
  Do not build a session or device list — nothing server-side backs one.
- `401 UNAUTHORIZED` anywhere means the session is over; clear and restart the challenge flow.

The store is in-memory by default. A token in `localStorage` is readable by any injected
script and stays valid until `exp` no matter what the owner does afterwards.

## No retries

**This layer never retries anything.** Retry policy lives with the signer, because every
retry needs a fresh `{challenge, timestamp, signature}` triple — the challenge is consumed
*before* the signature is verified, so replaying a triple always fails. See
[front-end-guide.md § Retry safety](../../../front-end-guide.md) for which calls tolerate a
retry at all: `POST /secrets` without a client-generated `id` and `POST /recovery/request`
each create a second row, and `POST /users/second-factor` returns a `401` you cannot
distinguish from failure — resolve that one with `GET /users/me`.

## Tests

`api.test.ts` stubs `fetch` and covers header discipline, the body cap, all three success
codes, the plain-text router `404`, the two distinct `401`s, UUID canonicalization of every
rejected spelling, cursor-following including the short-page case, and the token store.
