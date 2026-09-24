# `lib/device` — this browser's own keys

A browser is a **device**: it generates keys of its own at sign-up or enrolment and never stores
the seed ([device-keys.md § Devices](../../../../api-general/docs/crypto/device-keys.md#devices)).

## `keys.ts`

| Key               | How it is held                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-256 signing key | A WebCrypto `CryptoKey`, **`extractable: false`**. Signs sign-in, device actions and chain statements                                                |
| X25519            | A non-extractable WebCrypto `CryptoKey` where the browser supports X25519 (Chrome, Brave, Node). Elsewhere a raw key, sealed with the material below |
| ML-KEM-768        | Always the 64-byte `(d ‖ z)` seed, sealed. No platform keystore supports ML-KEM                                                                      |

`x25519Agreement` gives PQXDH either key form, so opening a keyring wrap never needs to export
the X25519 key.

## `record.ts` — the device record

```
{ device_id, registration_id, salt, sealed,
  user_address, root_public_key, scopes,
  signing_key, signing_public_key, x25519_key?, x25519_public_key, mlkem_public_key }
```

- `sealed` is the sealed-blob envelope, under the `device-wrap` key (`lib/oprf`), of the ML-KEM
  seed, plus the raw X25519 key when the browser could not hold it non-extractable.
- `salt` is the device's Argon2id salt. It never leaves the device, so even a server compromise
  cannot test PINs against this record without it.
- The public fields are public. `root_public_key` is kept so the chain can be verified from the
  root at every unlock.
- **There is no seed, no phrase and no root key in it.** A test and the e2e suite both check it.
- `openDeviceRecord` refuses the record if the opened material does not rebuild the public keys
  it lists.

## `store.ts` — where the record lives

**IndexedDB** (`cryple-device` → `device` → `current`), because only IndexedDB can store a
non-extractable `CryptoKey`. It is one of the two exemptions to the IndexedDB lint rule, beside
unfinished upload handles. `memoryDeviceStore` is the same interface in memory, for tests and for
Node.

### `discardAbandonedLocalStorage`

Runs once when the app boots (`CrypleProvider`) and removes what earlier deployments left in
`localStorage`. **Nothing in this repository writes any of it**, and `localStorage` outlives the
deployment that filled it, so a browser that ran an older build still holds it.

| What                           | Why it must go                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `encrypted_seed`               | The seed, wrapped under the device PIN. A 6-digit PIN in front of an offline blob is a few minutes of guessing. [Task 128](../../../../tasks-closed.md#task-128) ended the shape; this removes what it left |
| `cryple_mode_hint`             | Names the account's mode to anything that can read the origin                                                                                                                                               |
| `cryple.sharing.fingerprint.*` | The plaintext root-key pins 40.11 replaced with the sealed address book. A stale pin is also a stale answer to "has this contact's key changed?"                                                            |

The prefixed pins are swept by prefix, not by name: there is one per contact, and how many a given
browser holds is unknowable from here. Removing them is the whole fix, so the function takes no
account of what it finds and reports nothing.

It is the only reason this module reaches `localStorage`, and the second half of the lint
exemption in `eslint.config.mjs`. It never reads a value, only enumerates keys and deletes. It is
given the store rather than reaching for the global, so a test can drive it, and it gives up
silently where the accessor throws — a private window or blocked site data must not fail the boot.

**What someone with the browser profile holds:** the signing key can still sign, so a thief can
sign in and read ciphertext. They cannot open the keyrings without the ML-KEM seed, which needs
the PIN, and the server allows `OPRF_DEVICE_MAX_ATTEMPTS` guesses before deleting the
registration. Removing the device from another device ends the sign-ins too.
