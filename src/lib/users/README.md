# `lib/users` — the users domain

Account identity, the mode read, and the two one-way second-factor transitions.

Task 11 of [tasks.md](../../../tasks/tasks.md). Endpoints per
[front-end-endpoints.md § 8](../../../front-end-endpoints.md).

## API

| Function | Endpoint | Signed action |
| --- | --- | --- |
| `getMe` / `fetchAccountMode` | `GET /users/me` 🔒 | — |
| `lookupUsername` | `GET /users/lookup?address=` public | — |
| `getPublicKeys` | `GET /users/{uuid}/public-keys` 🔒 | — |
| `enableSecondFactor` | `POST /users/second-factor` 🔒 | `enable-second-factor` |
| `rotateSecondFactor` | `PUT /users/password` 🔒 | `rotate-second-factor` |
| `deleteAccount` | `DELETE /users` 🔒 | `account-delete` |

## `has_password` is the only source of truth for the mode

`GET /users/me` answers "who am I", and `has_password` is the one fact a client cannot derive
and must not cache across launches: local state does not survive a reinstall, and *restore on
a new device* is the normal path in a seed-phrase product, not an edge case.

`fetchAccountMode` maps it to the `paranoid` flag that
[`lib/signing`](../signing/README.md) needs. **Never guess it, never ask the user "did you set
a PIN?"** — that is exactly what someone restoring a lost device cannot answer.

Probing `/sign-in` instead burns a challenge, pays the 350 ms public floor, and returns the
same `404` for a wrong PIN, a wrong seed and a nonexistent account.

## Mode transitions are one-directional

| Transition | Function | Needs |
| --- | --- | --- |
| Standard → Paranoid | `enableSecondFactor` | JWT + signature over the **new** token |
| Paranoid → Paranoid (rotate) | `rotateSecondFactor` | JWT + the **current** token + signature over the new one |
| Paranoid → Standard | — | **Does not exist** |

**There is no "disable PIN" affordance and there never will be.** Nothing writes `NULL` back
to `users.password`. The asymmetry is deliberate: the PIN's whole threat model is a
compromised seed, so the seed key alone must never replace a PIN that is already set. A test
asserts this module exports nothing matching `/disable|removeSecondFactor|downgrade/`.

Both transitions **sign the new token itself**, not merely the intent. Without that, anything
between client and server could keep a valid signature and swap in a token of its own, and
the account would finish the upgrade with an attacker-known second factor.

Both call `session.rekeySecondFactor(newPin)` on success, so the keystore holds the new token
and the user is never re-prompted mid-session. On a Standard account that session held **no**
second factor at all until this call ([`lib/session`](../session/README.md)), which is exactly
what `rekeySecondFactor` is for.

**The upgrade is not complete when this function returns.** A Standard account also has no local
seed vault, because there was no PIN to wrap one under — so the caller must create it, and that
needs the recovery phrase, which the keystore deliberately does not retain. `SecurityScreen` asks
for the phrase alongside the new PIN, checks it derives to the signed-in `user_address` before
sending anything, then calls `createSeedVault` **after** this succeeds. Creating it first would
leave a Standard account holding a vault if the request failed.

### The one ambiguous retry in the whole API

`POST /users/second-factor` answers `401 INVALID_CREDENTIALS` for **both** "your signature was
wrong" and "enrolment already succeeded, so this retry is refused" — the already-enrolled
check runs after the signature check. Reporting "a PIN already exists" to a caller holding
only a seed key is precisely what Paranoid Mode refuses to do, so the API will not distinguish
them.

`enableSecondFactor` resolves it the documented way: on a `401` it reads
`GET /users/me` and returns `{ status: 'already-enabled' }` when `has_password` is now `true`,
otherwise it rethrows. That costs one unfloored request and no challenge. **Never retry
enrolment in a loop.**

## `DELETE /users`

Irreversible, and cascades to secrets, notes and documents. The body is
**required** — an absent body is `400 INVALID_BODY`, not a successful delete.

A retry answers `401 INVALID_CREDENTIALS` rather than `404`: the account row is gone, so the
call fails at the account lookup before anything else. `deleteAccount` treats that as success
— the token is useless either way — and clears the token and locks the keystore in a `finally`
so local state never outlives the account.

## Note on `lookupUsername`

Public and unauthenticated, so it takes no context. It validates the address shape locally
before sending, because the server's `400` carries no message to render.

## Tests

`users.test.ts` stubs `fetch` and verifies each signature against the fixture-derived public
key by rebuilding its payload, checks that `enable-second-factor` sends no `password` while
rotation presents the current one, exercises both branches of the ambiguous `401`, and
asserts the held token is replaced after each transition.
