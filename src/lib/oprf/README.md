# `lib/oprf` — both PINs over the OPRF

The client half of [pin-oprf.md](../../../../api-general/.docs/auth/pin-oprf.md): RFC 9497
base mode, suite `ristretto255-SHA512`, on `@noble/curves`.

## `pin-keys.ts` — the derivations

```
blinded  = the PIN's six ASCII digits, blinded (fresh random blind each time)
output   = Finalize(PIN, blind, evaluated)                                  64 bytes
argon    = Argon2id(PIN, salt, m = 65536 KiB, t = 3, p = 1, L = 32)
ikm      = output ‖ argon
leaf(l)  = HKDF-SHA256(ikm, salt = ∅, info = "Cryple-PIN-v1|" ‖ l, L = 32)
```

| Leaf | Salt | Is |
| --- | --- | --- |
| `device-wrap` | 32 random bytes kept in the device record | The AES key sealing the device's material |
| `device-confirm` | same | An Ed25519 seed; signs `Cryple-PIN-v1\|device-confirm\|<registration_id>\|<attempt_id>` |
| `account-proof` | `utf8(user_address)` | An Ed25519 seed; signs the SHA-256 digest a root action's signature covers |

**The tests check RFC 9497's own vectors first** (taken from `cloudflare/circl`'s copy, which the
server uses), then every value of `pin_oprf`, including both Ed25519 signatures byte for byte.
noble's `blind()` draws its own scalar, so the fixed-blind vectors go through
`blindInputWithScalar`, which hashes to the group with the RFC's DST and multiplies.

**Argon2id is `@noble/hashes` in plain JavaScript**, not WebAssembly, so the Content Security
Policy needs no `'wasm-unsafe-eval'`. Measured: **about 2.4 s per derivation in Node 24 on the
development laptop.** An unlock pays one; the Paranoid flows pay one per PIN typed. The
parameters must never be lowered here: the output would not match what the server registered.
**In Chrome 150 on the same laptop it takes about 2.8–3.0 s**, and a whole unlock (evaluate,
derive, open, confirm, sign in, keyrings) about 3 s. **Still to measure on a low-end phone**; if it is unbearable, the answer is a WASM build or a
spec change, raised against `pin-oprf.md`.

## `api.ts` — the routes

| Function | Route | Notes |
| --- | --- | --- |
| `registerDevicePin` | `POST /oprf/devices`, `/commit` | After sign-up or enrolment, and to change this browser's PIN. A commit replaces the previous registration |
| `evaluateDevicePin` | `POST /oprf/devices/{id}/evaluate` | Public. **`404` → `DeviceRegistrationGoneError`**: out of attempts, or the device was removed. A network failure → `OfflineError`, never "wrong PIN" |
| `confirmDevicePin` | `/confirm` | After every successful open: it gives every attempt back |
| `accountPinProof` | `POST /oprf/account/evaluate` | Root-signed `pin-evaluate`. **Always answers**; a wrong or throttled PIN only shows up as the root action failing |
| `enableParanoid` | `/oprf/account/begin`, `/enable` | Root-signed, no proof |
| `rotateAccountPin` | `/evaluate`, `/begin`, `/rotate` | Proof under the **current** PIN on `begin` and `rotate`, each over its own digest |

Nothing here auto-retries an evaluation: every one counts as an attempt.
