# `lib/encoding`

Byte-level conversions shared by every crypto module. No key derivation lives here — this
module only changes the representation of bytes that another module produced.

Task 4 of [tasks.md](../../../tasks/tasks.md).

## Why this module exists

The same P-256 public key travels in **three different encodings**, and mixing them is the
most common Cryple integration bug ([crypto/ECDSA.md § Public Key Encodings](../../../../api-general/.docs/crypto/ECDSA.md#public-key-encodings)):

| Encoding | Where it is used | Size |
| --- | --- | --- |
| SPKI DER, base64 | `users.public_key` on the wire — **always 124 chars** | 91 bytes |
| Raw `(X, Y)` | On-chain ERC-4337 / RIP-7212 signer pair | 2 × 32 bytes |
| Uncompressed point `0x04‖X‖Y` | Intermediate between the two | 65 bytes |

Routing every conversion through one module is what keeps a call site from sending an
uncompressed point where the API expects SPKI.

## API

### Hex

`bytesToHex` emits **lowercase** — `user_address`, `Server_Auth_Token` and every signed
payload argument are specified as lowercase hex, so this is a correctness property, not a
style choice. `hexToBytes` accepts either case and rejects odd-length or non-hex input
rather than silently truncating.

### Base64

`bytesToBase64` / `base64ToBytes` are standard base64 with padding, built on `btoa`/`atob`
so they behave identically in the browser and in Node. Both encryption public keys go over
the wire this way: X25519 → 44 chars, ML-KEM-768 → 1580 chars.

### UTF-8

`utf8ToBytes` / `bytesToUtf8`. Note that `utf8ToBytes` is what produces the **64-byte**
`Server_Auth_Token` salt from the 64-character `user_address` string — see
[`lib/pin`](../pin/README.md) for why that distinction matters.

### P-256 point encodings

- `uncompressedPointToSpkiDer` / `spkiDerToUncompressedPoint`
- `uncompressedPointToSpkiBase64` / `spkiBase64ToUncompressedPoint`
- `uncompressedPointToXY` / `xyToUncompressedPoint`

The SPKI header is a fixed 26-byte prefix (`SEQUENCE`, `id-ecPublicKey`, `prime256v1`,
`BIT STRING`) followed by the 65-byte point. Because both the curve and the point format
are fixed, the encoder is a concatenation and the decoder is a length check plus a prefix
comparison — there is no general-purpose DER parser here, and there should not be one.
Anything that is not a 91-byte uncompressed-P-256 SPKI blob is rejected.

`P256_SPKI_BASE64_LENGTH` is exported as `124` and asserted in the tests: the API column is
`VARCHAR(128)`, so a different length means the encoding is wrong.

### Byte helpers

- `concatBytes` — order-preserving concatenation, used to build signed payloads and PQXDH
  wire blobs.
- `bytesEqual` — length-then-content comparison with no early exit on the content loop.
- `zeroBytes` — fills buffers with zeros in place and ignores `undefined`, so cleanup paths
  do not need null checks.

## Constraints

- `zeroBytes` only works on `Uint8Array`. **JavaScript strings cannot be zeroed**, which is
  why key material is held as bytes for as long as possible and converted to hex/base64
  only at the moment it is needed. See [`lib/session`](../session/README.md).
- `bytesToBase64` builds an intermediate binary string. That is fine at Cryple's sizes (the
  largest value is a 1580-char ML-KEM key) but it is not the right tool for file-sized data.

## Tests

`encoding.test.ts` round-trips every encoding against
[`test-vectors.json`](../../test/fixtures/test-vectors.json) rather than against
self-generated values — the fixture is the only cross-client check that exists.
