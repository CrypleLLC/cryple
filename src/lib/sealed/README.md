# `lib/sealed` — the symmetric sealed-blob envelope

One AES-256-GCM envelope, used everywhere this client encrypts something **under a key it
already holds** (as opposed to wrapping *for someone else*, which is
[`lib/pqxdh`](../pqxdh/README.md)).

```
sealed(key, plaintext) = base64( 0x01 ‖ iv(12) ‖ AES-256-GCM(key, iv, plaintext) ‖ tag(16) )
```

| Consumer | Key | Plaintext |
| --- | --- | --- |
| `ciphertext` — [`lib/secrets`](../secrets/README.md) | that item's DEK | the item payload |
| `wrapped_dek` — [`lib/secrets`](../secrets/README.md) | the vault KEK | the item DEK |
| the note and document payloads | that item's DEK | the item payload |

## The layout is ratified

**Ratified 2026-08-08** as
[`crypto/ECDSA.md` § Sealed Blob Format](../../../../api-general/.docs/crypto/ECDSA.md)
(Decision B), byte-for-byte as written above, and pinned by the `sealed_blob` vector in
`test-vectors.json`. An earlier revision of this file called the layout provisional and pointed
at a proposal document; that proposal landed.

It stayed a cross-client contract even though this is the only client today: the API takes these
fields as opaque base64, so a divergent choice fails **silently, per item, forever**. A third
row used to sit in that table — `encrypted_seed`, sealed under the recovery key — and it left
with guardian recovery on 2026-09-04.

## Why it exists as one module

The three fields had begun to grow a copy of the layout each. Centralising it means the
ratified version replaces **one** implementation, and the version byte is enforced once.

## The version byte earns its place

`0x01` leads every blob and `openBlob` **rejects an unknown value** with
`UnsupportedSealedVersionError` rather than attempting a best-effort parse. Length is checked
against the layout before any decryption is attempted.

This is the part worth keeping even if the rest of the layout is rejected: it is the difference
between a future change being **detectable** and being a silent misparse. The frozen PQXDH blob
leads with a version byte for the same reason.

## API

```ts
sealBlob(plaintext: Uint8Array, key) => Promise<string>
openBlob(blobBase64, key)            => Promise<Uint8Array>
sealText(plaintext: string, key)     => Promise<string>
openText(blobBase64, key)            => Promise<string>
```

The text helpers zero their intermediate byte buffers in a `finally`.

**No AAD**, matching PQXDH — there is no second party to bind context with, and each key here
is already single-purpose. A fresh random IV per call; never reuse one with the same key.

## Tests

Exercised through its consumers — `secrets.test.ts` and the fixture test cover the
round-trip, the fresh IV per encryption, rejection of an unknown version byte, rejection of a
blob too short to hold an IV and tag, and failure under the wrong key.
