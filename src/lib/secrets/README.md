# `lib/secrets` — the vault domain

Per-item encryption and the `/secrets` endpoints. Tasks 12 and 13 of
[tasks.md](../../../tasks.md).

## The vault KEK (Decision A)

`wrapDek` / `unwrapDek` used to ship as a stub that threw `KekNotSpecifiedError`: the owner-side
KEK that produces `wrapped_dek` was unspecified, and three sources agreed it had to stay that
way rather than be invented here — the frozen key tree derived no symmetric wrapping key,
[`storage-plan.md` §3.1.1](../../../../api-general/.docs/storage-plan.md) said outright *"do
not invent a KEK path here,"* and the server treats `wrapped_dek` as fully opaque, so a
divergent client choice would fail silently, per item, forever.

**Resolved 2026-08-08** in `crypto/ECDSA.md` § Step 5 (backend Task 64): another HKDF leaf under
the existing `Cryple-Key-v1|…` scheme.

```
vault_kek = HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|vault-kek", L=32)
```

`deriveVaultKek` lives in [`lib/keys`](../keys/README.md) alongside the other two HKDF leaves,
and is exposed on the session as `SessionKeystore.vaultKek`. `vaultKekDekWrapper(vaultKek)` in
`dek.ts` is the real `DekWrapper`: `wrapDek`/`unwrapDek` seal/open the DEK through the existing
sealed-blob codec (`sealPayload`/`openPayload`, i.e. `@/lib/sealed`'s `sealBlob`/`openBlob`).

**Scope stays narrow, per the ratified spec text.** The vault KEK "only ever wraps other keys...
[and] never encrypts application data directly." That is why it wraps the per-item DEK and
nothing else — in particular, it is **not** the key for `beneficiaries.encrypted_label`
(`succession`'s pass-through field), which has its own key — `Cryple-Key-v1|heir-label`, a fifth
leaf rather than a reuse of this one; see
[`lib/succession` § Beneficiaries](../succession/README.md#beneficiaries) and
[`lib/app` § The heir label](../app/README.md#the-heir-label).

`wrapper(context)` (in `index.ts`, and its mirror in
[`lib/succession/shares.ts`](../succession/README.md)) defaults to
`vaultKekDekWrapper(context.session.vaultKek)`. `context.dek` is still an optional override —
kept as a test seam, not because production ever needs a second implementation.

## The ciphertext byte layout (Decision B)

`storage-plan.md` describes an item as separate `encrypted_payload`, `nonce` and `auth_tag`
columns, but the **actual API takes one opaque `ciphertext` string**, and how the 12-byte IV
packs into that string used to be unspecified anywhere — a cross-client contract, exactly like
the KEK, since an heir's device unwraps the DEK via PQXDH (`usage=succession-dek`) and must then
parse the same ciphertext.

`codec.ts` shipped a provisional layout ahead of ratification, chosen to match the house style
of the frozen PQXDH blob:

```
ciphertext = base64( 0x01 ‖ iv(12) ‖ AES-256-GCM(dek, iv, plaintext) ‖ tag(16) )
```

**Ratified 2026-08-08** as `crypto/ECDSA.md` § Sealed Blob Format (Decision B) — byte-for-byte
what was already here, so `codec.ts` and `@/lib/sealed` needed no changes, only confirmation
against the regenerated `sealed_blob` test vector. The same envelope also now covers
`recovery_vaults.encrypted_seed`.

It still leads with a **version byte**, and `openPayload` still **rejects an unknown one** rather
than guessing — a future layout change stays detectable instead of silently misparsed.

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

`SecretsContext` extends the shared `AuthedContext` with an optional `dek: DekWrapper`. Omitted,
it defaults to `vaultKekDekWrapper(context.session.vaultKek)` — the real wrapper. Tests still use
the override to exercise the transport/signing paths independently of the vault KEK.

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

`secrets.test.ts` asserts: the vault KEK matches the fixture's `hkdf_info_label` and
`vault_kek_base64`; `vaultKekDekWrapper` unwraps the fixture `sealed_blob` vector and round-trips
a fresh DEK with a fresh IV each call; `createSecret` without a `context.dek` override produces a
`wrapped_dek` in the sealed-blob layout; an explicit `context.dek` override still takes
precedence; the codec's version byte and its rejection of unknown versions; fresh IVs; that the
plaintext never appears in a request body; `201`/`200`; the plaintext budget; canonical-id
enforcement; and that the batch signature is over the sorted de-duplicated set.
