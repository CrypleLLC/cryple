# `lib/keys` — the frozen key tree

Derives every key a Cryple account has from its BIP39 seed phrase. This is the trust root:
a wrong constant here does not throw, it produces a **different account**, and the failure
surfaces long after the mistake was made.

Implements [crypto/ECDSA.md](../../../../api-general/.docs/crypto/ECDSA.md) — a **FROZEN**
spec. Task 3 of [tasks.md](../../../tasks.md).

> Nothing in this module may be changed to "fix" a mismatch. Every path, label and length
> below is part of account identity. If a value disagrees with the spec, the code is wrong;
> if the spec itself must change, that is a backend change plus regenerated vectors, and it
> breaks every existing user's keys.

## The tree

```
BIP39 mnemonic (12 or 24 words)
  │  PBKDF2-HMAC-SHA512(NFKD(mnemonic), "mnemonic"+passphrase, 2048, 64B) → seed
  │
  ├─ SHA-256(seed)                                                  → user_address (64-char lowercase hex)
  ├─ SLIP-0010 P-256, m/9027'/0'/0'                                  → ECDSA P-256 (API auth + ERC-4337 signer)
  ├─ HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|x25519",    L=32)  → X25519
  ├─ HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|mlkem768",  L=64)  → ML-KEM-768 (d‖z for FIPS 203 keygen)
  └─ HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|vault-kek", L=32)  → vault KEK (AES-256, symmetric)

  RESERVED, NEVER DERIVED:  m/44'/60'/…   — Cryple has no secp256k1 key and no EOA.
```

The vault KEK leaf (Decision A) landed 2026-08-08, after the other four — it wraps the per-item
DEK for [`lib/secrets`](../secrets/README.md) and nothing else. See that module's README for
scope and the sealed-blob envelope it wraps into.

## API

| Export | Purpose |
| --- | --- |
| `deriveKeyTree(mnemonic, passphrase?)` | Mnemonic → the whole tree. Validates the checksum first. |
| `deriveKeyTreeFromSeed(seed)` | Same, from 64 raw seed bytes. Used by the tests. |
| `deriveUserAddress(seed)` | `SHA-256(seed)` as lowercase hex. |
| `deriveIdentityKey` / `deriveX25519Key` / `deriveMlKem768Key` / `deriveVaultKek` | Individual leaves. |
| `zeroKeyTree(tree)` | Zeroes every private buffer in the tree in place. |
| `mnemonicToSeed` / `isValidMnemonic` / `generateMnemonic` | BIP39 layer, see below. |
| `deriveHardenedPath` / `deriveMasterNode` / `deriveHardenedChild` | SLIP-0010 primitives. |

`CrypleKeyTree` carries the private material *and* the wire encodings, so no call site has
to remember which encoding an endpoint wants:

- `identity.publicKeySpkiBase64` — the `public_key` field (124 chars)
- `x25519.publicKeyBase64` — `encryption_public_key_x25519` (44 chars)
- `mlkem768.publicKeyBase64` — `encryption_public_key_mlkem` (1580 chars)

## The traps this module exists to avoid

**`user_address` hashes the 64 raw seed bytes**, not the mnemonic and not the seed's hex
string. Hashing the hex string was the bug in the pre-rewrite `src/lib/crypto.ts` (deleted in
Task 26); it yields a valid-looking address for a different account. `keys.test.ts` asserts
both values and that they differ.

**SLIP-0010, not BIP32.** The HMAC key is `"Nist256p1 seed"` and the retry rules validate
against **P-256's** order (`p256.Point.Fn.ORDER`). Deriving with a secp256k1 BIP32 library
and reinterpreting the bytes is the exact mistake
[ECDSA.md § Why Not BIP32](../../../../api-general/.docs/crypto/ECDSA.md#why-not-bip32-at-m4460)
exists to prevent: secp256k1's order is larger, so its retry rule never fires for the curve
actually in use.

**Every level of the path is hardened** — `9027'`, `0'`, `0'`. `deriveHardenedPath` only
does hardened derivation; there is deliberately no non-hardened code path to reach for.

**X25519 uses the 32 HKDF output bytes as the scalar directly.** RFC 7748 clamping happens
inside the X25519 function, so this module does not pre-clamp. The vector's
`private_key_or_seed_hex` is the *unclamped* HKDF output, which is what is stored.

**ML-KEM needs 64 bytes** because FIPS 203 keygen consumes `(d‖z)`. That is why this leaf is
HKDF with `L=64` and not a 32-byte HD node — there is no client-invented expansion step.
`mlkem768.seed` is the 64-byte HKDF output; `mlkem768.secretKey` is the 2400-byte expanded
decapsulation key that `@noble/post-quantum` returns.

## Implementation notes

- **HKDF with an empty salt.** RFC 5869 says an absent salt means `HashLen` zero bytes.
  WebCrypto is passed `new Uint8Array(0)`; HMAC zero-pads any key shorter than its block
  size, so an empty salt and a 64-zero-byte salt produce identical output. This matches the
  Go generator's `nil` salt. The fixture test is what confirms it.
- **WebCrypto does the hashing, `@noble` does the curves.** SHA-256, HKDF, PBKDF2 and
  HMAC-SHA512 come from `crypto.subtle`; `@noble/curves` and `@noble/post-quantum` cover
  what WebCrypto cannot do (P-256 point multiplication from a raw scalar, X25519,
  ML-KEM-768). This split is why the whole module is `async`.
- **The seed is derived with WebCrypto, not `bip39.mnemonicToSeed`.** Byte-identical result,
  but it keeps `Buffer` out of the derivation path. `bip39` is still used for
  `validateMnemonic` / `generateMnemonic`, as [ECDSA.md](../../../../api-general/.docs/crypto/ECDSA.md)
  names them.
  ⚠️ **Known integration item for Task 24**: every `bip39` entry point touches `Buffer`, so
  the onboarding screens will need a `Buffer` polyfill in the browser bundle, or these two
  functions replaced with a local wordlist implementation. The derivation path itself is
  already `Buffer`-free.
- **Word count is restricted to 12 or 24.** `bip39.validateMnemonic` also accepts 15, 18 and
  21; `isValidMnemonic` narrows to what the spec states.

## Zeroing

`zeroKeyTree` zeroes `seed`, the P-256 private key and chain code, the X25519 private key, both
ML-KEM secrets, and the vault KEK. It does **not** zero public keys or the `userAddress` string.
Callers that hold a tree for a session should use [`lib/session`](../session/README.md),
which owns the lifecycle rather than leaving it to each call site.

## Tests

`keys.test.ts` reproduces **every value** in
[`test-vectors.json`](../../test/fixtures/test-vectors.json): seed, `user_address`, the
P-256 private key / chain code / public key in all three encodings, both encryption key
pairs, and the vault KEK. No Go test consumes that file, so this is the only cross-client check
of the derivations that exists anywhere — it is not optional, and it gates every other milestone.

The suite also pins the constants themselves (`Nist256p1 seed`, the path, all three HKDF labels)
against the fixture, so a typo in a label fails as a named assertion rather than as an
unexplained key mismatch, and confirms the three HKDF leaves stay domain-separated from one
another.
