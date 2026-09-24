# `lib/secrets` — the vault domain

Per-item encryption and the `/secrets` endpoints. Tasks 12 and 13 of
[tasks.md](../../../tasks/tasks.md).

## Wrapping the item DEK

Each item has its own random DEK. The DEK is wrapped under the **`secrets` scope KEK of the
current generation**, and the row records which generation:

```
wrapped_dek    = sealed(secrets_kek[key_generation], dek)
key_generation = the scope's current generation when the item was written
```

`wrapper(context)` is `scopeDekWrapper(context, 'secrets')` from [`lib/keyrings`](../keyrings/README.md):
`wrapDek(dek)` returns `{ wrapped_dek, key_generation }`, and `unwrapDek(row)` picks the KEK by
the row's `key_generation`, so items written before a rotation keep opening. `createSecret` runs
inside `withCurrentGeneration`, which re-wraps and retries once on `409 STALE_KEY_GENERATION`.
`context.dek` is an optional override, used by tests to exercise the transport on its own.

## The ciphertext byte layout (Decision B)

`storage-plan.md` describes an item as separate `encrypted_payload`, `nonce` and `auth_tag`
columns, but the **actual API takes one opaque `ciphertext` string**, and how the 12-byte IV
packs into that string used to be unspecified anywhere — a cross-client contract, exactly like
the KEK, since a recipient's device unwraps the DEK via PQXDH and must then
parse the same ciphertext.

`codec.ts` shipped a provisional layout ahead of ratification, chosen to match the house style
of the frozen PQXDH blob:

```
ciphertext = base64( 0x01 ‖ iv(12) ‖ AES-256-GCM(dek, iv, plaintext) ‖ tag(16) )
```

**Ratified 2026-08-08** as `crypto/ECDSA.md` § Sealed Blob Format (Decision B) — byte-for-byte
what was already here, so `codec.ts` and `@/lib/sealed` needed no changes, only confirmation
against the regenerated `sealed_blob` test vector. The same envelope also now covers
`notes.ciphertext` and the document snapshot.

It still leads with a **version byte**, and `openPayload` still **rejects an unknown one** rather
than guessing — a future layout change stays detectable instead of silently misparsed.

## Per-item flow

```
random 256-bit DEK → AES-256-GCM the payload → wrap under the current secrets KEK → POST /secrets with key_generation
```

The DEK is fresh per item and zeroed in a `finally` on every path.

## API

| Function | Endpoint | Notes |
| --- | --- | --- |
| `createSecret` | `POST /secrets` | Client-generated `id`; `201` created / `200` already stored |
| `listSecretsMeta` | `GET /secrets?fields=meta` | The vault index |
| `listSecrets` | `GET /secrets` | Full payloads — the heaviest response the API produces |
| `getSecret` | `GET /secrets/{id}` | |
| `openSecret` | — | `unwrapDek` + decrypt |
| `deleteSecret` | `DELETE /secrets/{id}` | `secret-delete`, one-element case |
| `deleteSecrets` | `DELETE /secrets` | `secret-delete`, batch |
| `hashReceivedCiphertext` | — | See below |

`SecretsContext` extends the shared `AuthedContext` with an optional `dek: DekWrapper`. Omitted,
it defaults to the `secrets` scope wrapper. Deletes are signed by **this device's** key, and need
a full device.

## Rules this domain is built to

**Always send a client-generated `id`.** That is the *only* thing that makes `POST /secrets`
retry-safe: replay the identical body and you get `200` with the stored item byte-for-byte.
Without an `id`, a retried timeout leaves **two items** that only you can tell apart, because
only you can read either, and nothing dedupes them.

It is **create-or-return, not an upsert**: replaying an id with different `ciphertext` keeps
the stored row and silently discards the new payload. To change an item, delete it and create
a new one.

**Render the index from `?fields=meta`.** Neither listing is paginated, in either form, and
the full one ships every blob.

**Hash the ciphertext *you* received.** `ciphertext_sha256` is the server's description of
bytes the server holds — fine for change detection, worthless as verification. Anything
checking a vault root uses `hashReceivedCiphertext`.

**`secret-delete` is the one batchable action.** Ids are sorted ascending and de-duplicated
before signing, because the server rebuilds the payload the same way; the single delete is the
one-element case of the same label. Both routes need a **JSON body** — an absent one is
`400 INVALID_BODY`.

`deleted` coming back lower than `requested` is not an error: an id that is not yours simply
does not match.

**Budget ~700 KiB of plaintext per item** against the 1 MiB body cap; `createSecret` refuses
more locally, because the server returns the same `400 INVALID_BODY` for oversized and
malformed bodies.

## Tests

`secrets.test.ts`: the sealed-blob vector opens; a DEK round-trips under the current generation
with a fresh IV each time; an old generation still opens after a rotation while new items use the
new one; a DEK wrapped for one scope does not open under another; `createSecret` sends
`key_generation`; on `STALE_KEY_GENERATION` it re-reads the keyrings and retries once, and a
second refusal is surfaced; deletes are device-signed over sorted, de-duplicated ids and send no
password or PIN proof.
