# `lib/session` — session key custody

Holds the derived key material for one session in memory, so the user unlocks **once** and
never sees a PIN prompt again for the rest of that session.

Task 6 of [tasks.md](../../../tasks.md).

> Design target: **"unlock once per session", never "prompt per action".** Unlocking costs
> two 600,000-iteration PBKDF2 runs (~1s on a laptop, several seconds on a low-end phone).
> Anything that forces a re-derivation per request is a broken UX, and anything that forces
> a re-*prompt* per request is the wrong design — see
> [auth/signed-actions.md](../../../../api-general/.docs/auth/signed-actions.md), where many
> ordinary actions need the second factor.

## What it holds

After `unlock`, in memory only:

- the P-256 identity private key (signs every challenge and action)
- the X25519 and ML-KEM-768 private keys (PQXDH unwrap, Milestone 3+)
- the `Server_Auth_Token` as **raw bytes**
- `user_address` and the three public keys in wire encoding

## API

```ts
const keystore = new SessionKeystore({ idleTimeoutMs, storage });

await keystore.unlock(pin);                      // from the local PIN-wrapped vault
await keystore.unlockWithMnemonic(mnemonic, pin); // restore / first sign-up, before a vault exists
keystore.lock();
keystore.onLock(() => …);                        // returns an unsubscribe function
```

`unlock` returns the vault's outcome unchanged (`invalid-pin` with `attemptsRemaining`,
`wiped`, `no-vault`) or `{ status: 'unlocked', userAddress }`. It does not throw on a wrong
PIN — see [`lib/pin`](../pin/README.md) for why that is a union.

Accessors (`userAddress`, `identityPrivateKey`, `x25519PrivateKey`, `mlkem768SecretKey`,
`enrollmentPublicKeys`, `serverAuthToken()`, …) throw while locked. `enrollmentPublicKeys`
returns the three values `POST /sign-up` enrolls, already in the encoding the wire wants.

A module-level `sessionKeystore` singleton is exported for app use; construct your own
instance in tests.

## Why the token is derived at unlock time

The account's mode (`has_password` on `GET /users/me`) is not known at unlock — there is no
JWT yet. Rather than re-prompting for the PIN later once the mode is known, `unlock` always
derives the `Server_Auth_Token` while the PIN is in hand and holds it.

Whether to actually **send** it is a per-request decision made by the signed-request helper
(Task 8) from the action table plus `has_password` — never a guess, and never cached local
state. Holding a token that turns out to be unused on a Standard account costs one PBKDF2
run and leaks nothing.

## Zeroing

`lock()` zeroes every private buffer in place (`zeroKeyTree` plus the token bytes), drops
the state, and notifies `onLock` listeners once. Unlocking again zeroes the previous
session first, so two `unlock` calls never leave an orphaned copy of key material.

The `Server_Auth_Token` is stored as a `Uint8Array` and hexed on demand by
`serverAuthToken()` precisely so the long-lived copy is zeroable. **JavaScript strings
cannot be zeroed** — each `serverAuthToken()` call creates a short-lived string that becomes
garbage, which is the best available bound on its lifetime.

`identityPrivateKey` and friends return the **live buffer**, not a copy. Callers must not
retain them across a `lock()`; after locking, a retained reference reads as zeros. That is
intentional — a stale reference should fail loudly rather than keep working.

## Idle timeout

`idleTimeoutMs` (default 15 minutes) auto-locks after inactivity. Every accessor re-arms the
timer, so "activity" means "used a key". Pass `0` to disable — which is what the tests do,
except the one that exercises the timeout.

The timer is `unref`'d where the runtime supports it, so it never holds a Node process open.

This is a **local** lock only. It does not end the API session: the JWT's own 24h `exp` is
the session and there is no revocation endpoint. Re-unlocking after an idle lock does not
require a new sign-in unless the JWT has also expired.

## Never

- Nothing here touches `localStorage` or `sessionStorage`. The only persisted artifact in
  the whole flow is the PIN-wrapped vault record owned by [`lib/pin`](../pin/README.md).
- Nothing here is logged. Never add a `console.log` of a keystore instance — its fields are
  private keys.
- The mnemonic is deliberately **not** retained. `unlock` derives from it and drops it. The
  one flow that needs the seed phrase itself (recovery setup, Task 16, which encrypts it
  under the REK) calls `unlockSeedVault` directly for that one-off, rather than the keystore
  holding a plaintext mnemonic for the whole session.

## Tests

`session.test.ts` checks that one unlock reproduces every fixture value, that the token
matches the vector, that `lock()` actually zeroes the buffers a caller was handed, that
re-unlocking zeroes the prior session, that the idle timer re-arms on access, and that the
only thing written to storage is the vault record — asserting that the PIN, the token, the
identity private key and the mnemonic appear nowhere in it.
