# `lib/credentials` — the password store

[Task 134](../../../../tasks.md#task-134). The client of `api-general`'s `credentials` domain.
Design: [password-manager.md](../../../../api-general/docs/password-manager.md).

**It is [`lib/secrets`](../secrets/README.md) with three differences**, and all three come from the
store being append-only. Everything else — a per-item DEK, the sealed envelope, signed actions on
the destructive calls, `withCurrentGeneration` on writes — is the same module in the same shape,
deliberately, because the app manages passwords the way it manages secrets.

| | `lib/secrets` | here |
| --- | --- | --- |
| Writing | `createSecret`, and a `PUT` would replace | `writeCredential` **always appends a revision** |
| The payload | `{name, value}` | `{site, username, password, note?}` |
| Rekeying | by item id | by **revision id**, so it is not in `lib/rekey` yet |

## An edit is an append

`writeCredential` posts a new revision. Passing `credentialId` makes it an edit of that credential;
omitting it starts a new one. A `revision_id` is always sent, so a retry over a flaky connection
produces one row and not two — the server answers `200` instead of `201` and `created` is `false`.

**There is no update call and there will not be one.** A replacement needs authority the browser
extension deliberately lacks, so making an edit an addition is what keeps writing a credential free
of any signature at all. Password history falls out of the same shape.

## Two listings, because there are two readers

| Function | Route | For |
| --- | --- | --- |
| `listCredentials` | `GET /credentials` | The vault screen: one row per credential, at its current value |
| `listCredentialsMeta` | `GET /credentials?fields=meta` | Finding what a rotation left behind, without ciphertext |
| `syncCredentials` | `GET /credentials/sync?cursor=` | The extension's incremental feed, tombstones included |

`listCredentials` is the one the UI uses. The server folds the revision history to the current
value in SQL, so this client never computes it — see the domain README's
[§ Two readers, two listings](../../../../api-general/internal/domain/credentials/README.md).

`syncCredentials` exists here because the contract is the same for both clients and testing it once
is cheaper than testing it twice. **Nothing in `web-app` calls it.**

## The passwords KEK

`scopeDekWrapper(context, 'passwords')`. That scope is in `DEK_SCOPES` but **not in `ITEM_SCOPES`**,
which is what keeps [`lib/rekey`](../rekey/README.md) from walking it with the wrong route:
`PUT /credentials/keys` names **revision ids**, and a credential edited for years has many.
`lib/rekey` covers it since 2026-09-24, so a rotation re-wraps every revision of every credential.

A device without the `passwords` scope holds no key here and never sees the tab
([ADR 00007](../../../../api-general/docs/adr/00007_scopes_limit_devices.md)).

## What never leaves this module in the clear

The site, the username, the password and the note are all inside `ciphertext`. **The server is never
told which site a credential is for**, and there is no route that would answer it — a server that
could would hold the user's browsing history under another name. `MAX_PLAINTEXT_BYTES` is 24 KiB,
checked before sealing.

## Tests

`credentials.test.ts`, against a stubbed `fetch` and a real test session: a credential DEK wrapped
under `passwords` does not open under `secrets`; a write is a `POST` carrying both ids; a replay
reads as not created; an edit reuses the credential id and mints a new revision id; an oversized
payload is refused before any request; the three listings hit three different URLs; and each
destructive call's signature verifies against the device key over exactly what it destroys —
including `keep_last`, which `credential-prune` binds alongside the id.

The payload codec and the row builder are framework-free in
[`lib/app/passwords.ts`](../app/README.md) and tested there.
