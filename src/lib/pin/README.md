# `lib/pin` — the second factor and the seed at rest

Two **different** PBKDF2 usages, both driven by the user's 6-digit PIN. Conflating them is
the single easiest way to lock a user out of their account, so they live in separate
modules and never share a salt-building code path.

Implements [auth/two-factor-PIN.md](../../../../api-general/.docs/auth/two-factor-PIN.md) — a
**FROZEN** spec. Task 5 of [tasks.md](../../../tasks/tasks.md).

## The two derivations

```
Server_Auth_Token = hex(PBKDF2-HMAC-SHA256(PIN, salt=utf8(user_address), 600_000, 32))  → the `password` field
localWrapKey      = PBKDF2-HMAC-SHA256(PIN, salt=32 random bytes,        600_000, 32)   → never leaves the device
```

|                         | `Server_Auth_Token`                                                                           | Local wrap key                        |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| Module                  | `server-auth-token.ts`                                                                        | `seed-vault.ts`                       |
| Salt                    | UTF-8 bytes of the 64-char hex `user_address` — **64 bytes, not the 32 raw bytes it encodes** | 32 random bytes, fresh **per device** |
| Reproducible elsewhere? | Yes — any device, from the seed alone                                                         | No, and deliberately so               |
| Leaves the device?      | Yes, as `password`, and only on Paranoid accounts                                             | Never                                 |

`kdf.ts` holds the one shared primitive, `stretchPin(pin, salt)`. It takes the salt as a
required argument and knows nothing about `user_address` or about random local salts, so
neither caller can accidentally receive the other's salt. That is the whole reason it is
shaped that way — do not add a convenience wrapper that builds a salt internally.

**The salt is the most likely place for a client to diverge.** `pin.test.ts` asserts both
that the token matches the fixture and that salting with the 32 _raw_ bytes produces a
different value.

## API

### Format rules — `rules.ts`

`validatePin` returns a discriminated result so the UI can name the problem;
`assertValidPin` throws. Enforced at PIN creation, per the spec:

- exactly 6 ASCII digits (`٢`-style Unicode digits are rejected)
- no strict ascending or descending run (`123456`, `012345`, `654321`)
- no all-repeating digit (`111111`)

A run is strict: every step is exactly `+1` or `-1`. `112233` and `123457` are allowed.

### `Server_Auth_Token` — `server-auth-token.ts`

- `deriveServerAuthToken(pin, userAddress)` → 64-char lowercase hex, the `password` field.
- `deriveServerAuthTokenBytes(pin, userAddress)` → the raw 32 bytes, for
  [`lib/session`](../session/README.md) to hold in a zeroable buffer.

Both reject a `user_address` that is not 64 lowercase hex characters, because the salt is
the literal string — an uppercase address silently derives a different token.

This is **not** the user's PIN and **not** a local unlock password. Send it only on Paranoid
accounts, read from `has_password` on `GET /users/me`; sending it on a Standard account
fails exactly as hard as omitting it on a Paranoid one.

### Local seed vault — `seed-vault.ts`

```jsonc
localStorage["encrypted_seed"] = { "v": 1, "salt": "…", "iv": "…", "ct": "…" }
```

- `createSeedVault(seedPhrase, pin, storage?)` — validates the PIN, generates a fresh
  32-byte salt and 12-byte IV, AES-256-GCM-encrypts the **mnemonic string**.
- `unlockSeedVault(pin, storage?)` — returns a discriminated `UnlockResult`.
- `hasSeedVault` / `wipeSeedVault`.

`v` is the KDF version marker. It is checked on read and an unknown version **throws**
rather than being guessed at — a future move off PBKDF2 needs it to re-wrap old blobs.

**Every account has a vault, in both modes.** The spec's § Local Seed Encryption is headed
"Both Modes" and this client matches it: the PIN is always set, and `paranoid` decides only
whether that same PIN is _also_ the server's second factor
([`lib/app` § Every account has a PIN](../app/README.md#every-account-has-a-pin)). A Standard
device stores a vault too, so the app's `locked` phase and the PIN-entry `Unlock` screen are
reached by every account.

**`hasSeedVault()` does not mean "this device is Paranoid".** It did once, when a Standard
account had no PIN and therefore nothing to wrap the seed under. That equivalence is dead and
must not be reintroduced: the function answers only _does this device remember a phrase_. The
account's mode is `has_password` from `GET /users/me` — the same flag that decides whether
`Server_Auth_Token` is sent at all.

`UnlockResult` is a union rather than a thrown error because the caller must render four
different outcomes:

| `status`      | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| `unlocked`    | carries `seedPhrase`                                        |
| `invalid-pin` | carries `attemptsRemaining`                                 |
| `wiped`       | the third failure just destroyed the local copy             |
| `no-vault`    | nothing stored on this device — offer restore-from-mnemonic |

### The 3-attempt wipe

Product policy, not a
suggestion. Three consecutive failed unlocks delete the record. A successful unlock clears
the counter.

The counter is persisted as a `failed` field **inside** the vault record, so it survives a
page reload — a counter held in memory would reset on every refresh and defeat the policy
entirely. This is a local-only extension to the record shape shown in the spec; the record
never leaves the device, so it carries no wire-contract risk. A local attacker with
devtools can still edit it, so the wipe is a speed bump against a casual on-device attack
rather than a defence against someone holding the device. What costs such an attacker is
`stretchPin`'s 600,000 iterations over a **per-device random salt**: every candidate PIN pays
it in full, and no work carries from one device to another.

**Paranoid mode adds nothing against a stolen device**, and the old claim that it did was
wrong. The same PIN opens the local vault and derives `Server_Auth_Token`, so an attacker who
brute-forces the vault learns the PIN itself and now holds both factors. Paranoid's threat
model is a stolen **phrase** — someone who has the words but not this device — which is
exactly the case where the server-side factor is the wall.

Wiping the vault does not delete the account. The user restores with their seed phrase.

## Storage injection

Every function takes an optional `VaultStorage` (`getItem`/`setItem`/`removeItem`) and falls
back to `localStorage`. This keeps the module testable in Node and safe under Next.js
server rendering, where `localStorage` does not exist — the default accessor throws a clear
error instead of a `ReferenceError`.

## Cost

600,000 iterations is 0.3–1s on a laptop and several seconds on a low-end phone. Pay it
**once per session** and hold the result in memory — that is what
[`lib/session`](../session/README.md) is for. A per-request derivation is broken UX and a
per-request _prompt_ is the wrong design.

## Never

- Never log or persist the PIN, the derived token, or the seed phrase.
- Never send the raw PIN to the server in either mode.
- Never build a "disable PIN" affordance. **Paranoid → Standard does not exist** — nothing
  writes `NULL` back to `users.password`. The PIN's threat model is a compromised seed, so
  the seed key alone must never be able to replace a PIN that is already set.

## Tests

`pin.test.ts` covers the fixture token (`pin 428193` → recorded value), the raw-vs-UTF-8
salt divergence, every format rule, the full 3-strike wipe sequence including persistence
across reloads and reset after success, per-device salt independence, and that neither the
PIN nor the plaintext seed ever appears in what is written to storage.
