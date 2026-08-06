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
| `encrypted_seed` — [`lib/recovery`](../recovery/README.md) | the REK | the seed phrase |
| `wrapped_dek` — *pending* | the vault KEK | the item DEK |

## ⚠️ This layout is provisional

**It is not specified anywhere.** The API takes these fields as opaque base64 strings, and the
backend docs name the algorithm without fixing the byte layout:

- `front-end-endpoints.md` — `ciphertext` is *"base64 AES-256-GCM blob produced client-side"*
- `recovery-flow.md:477` — `encrypted_seed` is *"AES-GCM encrypted seed phrase"*

Neither says where the 12-byte IV sits. Both blobs are **cross-client**: an heir parses the
item ciphertext after a PQXDH `succession-dek` unwrap, and `encrypted_seed` is written by one
device and read by a different one during recovery.

A drafted proposal to ratify this is in
[proposals/opaque-blob-layouts.md](../../../proposals/opaque-blob-layouts.md). Until it lands,
treat the layout as unratified and **do not** rely on it interoperating with another client.

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

Exercised through its consumers — `secrets.test.ts` and `recovery.test.ts` both cover the
round-trip, the fresh IV per encryption, rejection of an unknown version byte, rejection of a
blob too short to hold an IV and tag, and failure under the wrong key.
