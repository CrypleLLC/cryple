# `lib/users` — the users domain

Account identity, the mode read, usernames, contacts' published keys, and account deletion.
Endpoints per [front-end-endpoints.md § 8 and § 19](../../../front-end-endpoints.md#8-users-endpoints).

## API

| Function | Endpoint | Signed by |
| --- | --- | --- |
| `getMe` / `fetchAccountMode` | `GET /users/me` 🔒 | — |
| `lookupUsername` | `GET /users/lookup?address=` public | — |
| `resolveUsername` | `GET /users/resolve?username=` 🔒 | — |
| `updateUsername` | `PUT /users/username` 🔒 | this device (`username-update`) |
| `getPublicKeys` | `GET /users/{uuid}/public-keys` 🔒 | — |
| `deleteAccount` | `DELETE /users` 🔒 | the **root** (`account-delete`), plus the PIN proof on Paranoid |

Turning Paranoid on and changing the account PIN are [`lib/oprf`](../oprf/README.md).

## `paranoid` is the only source of truth for the mode

`GET /users/me` answers "who am I", and `paranoid` is the one fact a client cannot derive and
must not cache: a browser added with the phrase knows nothing about the account yet. **Never
guess it, never ask the user "did you set a PIN?"** Where the mode must be known before any
token exists (adding a browser), `lib/account` tries without a proof and then with one; the
account PIN evaluation always answers, so the attempt reveals nothing.

**There is no "disable Paranoid" affordance and there never will be.** A test asserts that
neither this module nor `lib/oprf` exports anything matching `/disable|removeSecondFactor|downgrade/`.

## `getPublicKeys`

Returns the contact's `user_address`, `root_public_key`, current `sharing_keys` with their
generation, and the `proof` path from the root to their announcement. **Never trust the keys
without verifying the path against the pinned root** — [`lib/sharing`](../sharing/README.md)
does, before every invitation and every send.

## `DELETE /users`

Irreversible, and cascades to every device, keyring, item, connection and share. **It is signed
by the root**, so the phrase must be typed: a stolen device alone can never delete the account.
On a Paranoid account the account PIN's proof goes with it. `deleteAccount` sends the request and
surfaces any refusal; `lib/account` → `deleteAccountWithPhrase` derives the root, gets the proof,
calls it, and then forgets everything local.

## Usernames

An account holds a **set** of usernames and displays one. The wire contract is
[front-end-endpoints.md § 8](../../../front-end-endpoints.md#8-users-endpoints), and the server's
own account of why is
[`users/README.md § Usernames`](../../../../api-general/internal/domain/users/README.md). The three
facts that shape this module: a rename **adds** a name and never releases one, only the **current**
name resolves, and a collision is one answer whoever holds the string.

### Normalise before signing, not after

`updateUsername` lowercases and trims, signs **that**, and sends **that**. The server normalises
again and checks the signature against its own result, so a client that signs the raw input
produces a request that looks valid and fails authentication. `normalizeUsername` is exported
because `resolveUsername` and the rename screen have to apply the same rule before they compare
anything.

`USERNAME_PATTERN` mirrors `utils.IsUsername` — `^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$`, so 3 to 64
ASCII characters. It is checked locally first, which keeps the ordinary typo off the network;
`MalformedUsernameError` carries `USERNAME_MALFORMED` as its `userMessage` so the provider's
`reportError` renders it without a second mapping. The server's own `400 INVALID_PARAM` on this
route maps to the same string, for the request that gets past the local check.

### The `422` says one thing and must keep saying one thing

`422 USERNAME_UNAVAILABLE` is returned identically whether the string is another account's current
name or one it reserved — that uniformity is what stops the claim route becoming a rename oracle.
`userMessageFor` therefore renders one message and **no copy anywhere may narrate a difference the
server did not report**. A test asserts both cases produce the same string.

### `resolveUsername` returns `undefined`, it does not throw

A `404` here means *no account uses this name right now* and nothing more: it is the same answer
for a name nobody ever held and for one somebody renamed away from. Returning `undefined` for both
makes that structural rather than careful — there is no branch in which a caller could render
"this user does not exist", which would claim something the server did not say. A malformed name
returns `undefined` too, without a request, so the local check cannot be distinguished from a miss.
Anything that is not a `404` propagates, so an outage is never mis-rendered as "no such name".

**Never call it to repair a connection.** A stored username can outlive the account that held it —
deleting an account releases its whole set — so re-resolving one to heal a lost connection would
silently attach to whoever holds the name now. That rule belongs to sharing (Task 104) but it is
the reason this wrapper exists at all, and the reason it has no caching.

### What this module cannot show

The API exposes no route for an account's **own** set of names, so a user who forgets a name they
used before cannot be shown it. Switching back is just claiming the name again; there is no
separate reclaim call. `GET /users/usernames` would disclose only the caller's own set and is
defensible, but it is API surface Task 118 did not specify.

## Note on `lookupUsername`

Public and unauthenticated, so it takes no context. It validates the address shape locally
before sending, because the server's `400` carries no message to render.

## Tests

`users.test.ts` stubs `fetch` and verifies each signature against the fixture-derived public
key by rebuilding its payload, pins that `username-update` signs the normalised form of a
mixed-case input with surrounding space and that the collision and format failures render their
own copy, pins that a reserved and an unknown name resolve to the same `undefined`, checks that `enable-second-factor` sends no `password` while
rotation presents the current one, exercises both branches of the ambiguous `401`, and
asserts the held token is replaced after each transition.
