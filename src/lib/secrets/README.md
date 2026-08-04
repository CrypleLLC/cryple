# `lib/secrets` — the vault domain

Per-item encryption and the `/secrets` endpoints. Tasks 12 and 13 of
[tasks.md](../../../tasks.md).

> ## ⚠️ This domain cannot round-trip yet
>
> **The owner-side KEK that produces `wrapped_dek` is unspecified**, so `wrapDek` /
> `unwrapDek` ship as a stub that throws `KekNotSpecifiedError`. Everything else — id
> generation, payload sealing, transport, signing, the batch delete — is built and tested, and
> the derivation slots into one module without touching a call site.
>
> **Task 13 is not complete and must not be checked off** until the KEK lands.

## Why the seam is empty, and must stay empty

Three sources agree, and none of them is a matter of taste:

- The frozen key tree derives exactly four things — `user_address`, P-256, X25519, ML-KEM —
  and **no symmetric wrapping key**. PQXDH scopes itself to wrapping *for someone else*.
- [`storage-plan.md` §3.1.1](../../../../api-general/.docs/storage-plan.md) says it outright:
  *"do not invent a KEK path here — if the vault needs a dedicated wrapping key, its
  derivation belongs in that spec [`crypto/ECDSA.md`], with test vectors."*
- The server treats `wrapped_dek` as **fully opaque** ("Must be non-empty"), so nothing
  server-side will ever catch a divergent client derivation. **It fails silently, per item,
  forever** — and surfaces at inheritance release, years later.

The resolution is a one-paragraph addition to `crypto/ECDSA.md` plus regenerated test vectors,
made **in the backend repo**. The obvious shape is another HKDF leaf under the existing
`Cryple-Key-v1|…` labelling scheme, but **the label and construction are the backend spec's to
choose, never this client's.**

When it lands: implement `DekWrapper` in `dek.ts`, make it the default, add the vectors to the
fixture test. Nothing else changes.

## The second, related gap — read before shipping

`storage-plan.md` describes an item as separate `encrypted_payload`, `nonce` and `auth_tag`
columns, but the **actual API takes one opaque `ciphertext` string**. How the 12-byte IV packs
into that string is therefore **not specified anywhere**.

That matters beyond this client: an heir's device unwraps the DEK via PQXDH
(`usage=succession-dek`) and must then parse the ciphertext, so the layout is a **cross-client
contract**, exactly like the KEK.

`codec.ts` implements a provisional layout, chosen to match the house style of the frozen
PQXDH blob:

```
ciphertext = base64( 0x01 ‖ iv(12) ‖ AES-256-GCM(dek, iv, plaintext) ‖ tag(16) )
```

- It leads with a **version byte** and `openPayload` **rejects an unknown one** rather than
  guessing — so if the backend ratifies a different layout, old blobs are detectable instead
  of being silently misparsed.
- **This is a local choice awaiting ratification, not a protocol decision.** It belongs in the
  same backend spec change as the KEK. Until then, treat it as provisional.

## Per-item flow

```
random 256-bit DEK → AES-256-GCM the payload → wrapDek(DEK) → POST /secrets
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

`SecretsContext` extends the shared `AuthedContext` with an optional `dek: DekWrapper`.
Omitted, it is the throwing stub — production code gets the throw, and the tests inject a
clearly-named fake to exercise everything around it.

## Rules this domain is built to

**Always send a client-generated `id`.** That is the *only* thing that makes `POST /secrets`
retry-safe: replay the identical body and you get `200` with the stored item byte-for-byte.
Without an `id`, a retried timeout leaves **two items**, each separately assignable to heirs —
a duplicate quietly widens what an heir inherits, and nothing dedupes them.

It is **create-or-return, not an upsert**: replaying an id with different `ciphertext` keeps
the stored row and silently discards the new payload. To change an item, delete it and create
a new one.

**Render the index from `?fields=meta`.** Neither listing is paginated, in either form, and
the full one ships every blob.

**Hash the ciphertext *you* received.** `ciphertext_sha256` is the server's description of
bytes the server holds — fine for change detection, worthless as verification. Anchoring or
checking a vault root uses `hashReceivedCiphertext`.

**`secret-delete` is the one batchable action.** Ids are sorted ascending and de-duplicated
before signing, because the server rebuilds the payload the same way; the single delete is the
one-element case of the same label. Both routes need a **JSON body** — an absent one is
`400 INVALID_BODY`.

`deleted` coming back lower than `requested` is not an error: an id that is not yours simply
does not match.

**Both deletes also destroy what heirs inherited of that item.** Every wrapped key assigned to
it goes in the same transaction. Warn before deleting an assigned item
(`GET /succession/beneficiaries/{id}/shares` says which), and treat any cached `share_count`
as stale afterwards — the response does not report how many assignments went with it.

**Budget ~700 KiB of plaintext per item** against the 1 MiB body cap; `createSecret` refuses
more locally, because the server returns the same `400 INVALID_BODY` for oversized and
malformed bodies.

## Tests

`secrets.test.ts` asserts the seam throws a named error naming the spec, that a secrets call
with no wrapper hits it, the codec's version byte and its rejection of unknown versions, fresh
IVs, that the plaintext never appears in a request body, `201`/`200`, the plaintext budget,
canonical-id enforcement, and that the batch signature is over the sorted de-duplicated set.
