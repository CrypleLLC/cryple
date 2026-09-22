# `lib/sealed` — the symmetric sealed-blob envelope

One AES-256-GCM envelope, used everywhere this client encrypts something **under a key it
already holds** (as opposed to wrapping *for someone else*, which is
[`lib/pqxdh`](../pqxdh/README.md)).

```
sealed(key, plaintext) =         0x01 ‖ iv(12) ‖ AES-256-GCM(key, iv, plaintext) ‖ tag(16)
                        base64( … ) for anything that goes in a TEXT column
```

| Consumer | Key | Plaintext | Encoding |
| --- | --- | --- | --- |
| `ciphertext` — [`lib/secrets`](../secrets/README.md) | that item's DEK | the item payload | base64 |
| `wrapped_dek` — every item domain | the item scope's KEK of `key_generation` ([`lib/keyrings`](../keyrings/README.md)) | the item DEK | base64 |
| a root keyring wrap, the sharing material, a stored share sub-key | the root wrap key, the `sharing` KEK, the item scope's KEK | a scope KEK, sharing keys, a sub-key | base64 |
| the device record's `sealed` — [`lib/device`](../device/README.md) | the `device-wrap` PIN key | the device's ML-KEM seed | base64 |
| the note and document payloads | that item's DEK | the item payload | base64 |
| a drive chunk — [`lib/files`](../files/README.md) | that file's DEK | `u32be(index) ‖ u32be(count) ‖ payload` | **raw** |

## Base64 is an encoding, not part of the envelope

`sealBytes` / `openBytes` are the envelope. `sealBlob` / `openBlob` are the same thing base64-encoded
and delegate to them, and `sealText` / `openText` add a UTF-8 step on top of that.

**The base64 exists for `TEXT` columns and for nothing else.** Every field this client sends the API
is one, which is why it was the only form here until the drive arrived — an R2 object is not a text
column, and base64-ing a multi-gigabyte file would inflate it by a third for no reason. The raw pair
was added in 2026-09-09 for [`lib/files`](../files/README.md); the layout is identical either way,
and there is one implementation of it.

## The layout is ratified

**Ratified 2026-08-08** as
[`crypto/ECDSA.md` § Sealed Blob Format](../../../../api-general/.docs/crypto/ECDSA.md)
(Decision B), byte-for-byte as written above, and pinned by the `sealed_blob` vector in
`test-vectors.json`. An earlier revision of this file called the layout provisional and pointed
at a proposal document; that proposal landed.

It stayed a cross-client contract even though this is the only client today: the API takes these
fields as opaque base64, so a divergent choice fails **silently, per item, forever**.

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
