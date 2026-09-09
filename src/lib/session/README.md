# `lib/session` — session key custody

Holds the derived key material for one session in memory, so the user unlocks **once** and
never sees a PIN prompt again for the rest of that session.

Task 6 of [tasks.md](../../../tasks/tasks.md).

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
- the `Server_Auth_Token` as **raw bytes** — only when a PIN was supplied
- `user_address` and the three public keys in wire encoding

## API

```ts
const keystore = new SessionKeystore({ idleTimeoutMs, storage });

await keystore.unlock(pin);                       // from the local PIN-wrapped vault
await keystore.unlockWithMnemonic(mnemonic, pin); // restore / Paranoid sign-up, before a vault exists
await keystore.unlockWithMnemonic(mnemonic);      // Standard Mode — there is no PIN to derive from
keystore.lock();
keystore.onLock(() => …);                         // returns an unsubscribe function
```

**A Standard Mode session holds no second factor**, because a Standard account has no PIN at
all — nothing derives a `Server_Auth_Token` and nothing is written to the local vault. The PIN
argument is therefore optional, and `serverAuthToken()` returns `undefined` rather than throwing
when there is none. It still throws while **locked**: "no session" and "no second factor" are
different answers and must not be conflated.

Returning `undefined` rather than throwing is what lets every call site keep passing
`serverAuthToken: session.serverAuthToken()` unconditionally. The decision to *send* it stays
where it belongs — the signed-request helper, which refuses a Paranoid request with no token and
says so ([`lib/signing`](../signing/README.md)).

`unlock` returns the vault's outcome unchanged (`invalid-pin` with `attemptsRemaining`,
`wiped`, `no-vault`) or `{ status: 'unlocked', userAddress }`. It does not throw on a wrong
PIN — see [`lib/pin`](../pin/README.md) for why that is a union.

Accessors (`userAddress`, `identityPrivateKey`, `x25519PrivateKey`, `mlkem768SecretKey`,
`vaultKek`, `enrollmentPublicKeys`, `serverAuthToken()`, …) throw while locked.
`enrollmentPublicKeys` returns the three values `POST /sign-up` enrolls, already in the encoding
the wire wants. `vaultKek` is what [`lib/secrets`](../secrets/README.md) wraps the per-item DEK
with by default — it is never sent to the server.

A module-level `sessionKeystore` singleton is exported for app use; construct your own
instance in tests.

## Why the token is derived at unlock time

The account's mode (`has_password` on `GET /users/me`) is not known at unlock — there is no
JWT yet. Rather than re-prompting for the PIN later once the mode is known, `unlock` always
derives the `Server_Auth_Token` whenever a PIN is in hand, and holds it.

This still applies on the vault path (`unlock(pin)`), because a local vault only ever exists on
a Paranoid account now. It does not apply to `unlockWithMnemonic(mnemonic)` with no PIN: there is
nothing to derive from, and there never will be for that account until it enables a second factor
via `rekeySecondFactor`.

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

## Cross-tab handoff — `handoff.ts`

Key material lives in memory, per JS context. A **new browser tab is therefore always locked**,
even on the same origin, and that is the ordinary case now that documents open in their own tab
(`/docs/[id]`).

Prompting for a PIN in every document tab would be the wrong answer twice over: it costs a
600,000-iteration PBKDF2 each time, and it re-introduces the per-prompt design this module exists
to avoid. So a fresh tab asks the tabs that are already unlocked:

```ts
serveSession(() => …)   // an unlocked tab answers requests, for as long as it is mounted
await requestSession()  // a new tab asks, and gives up after HANDOFF_TIMEOUT_MS
```

The offer carries the **64-byte seed** (hex), the `Server_Auth_Token` and the current JWT.
`adoptHandoff` rebuilds the tree with `deriveKeyTreeFromSeed` — no PBKDF2, no prompt. When nobody
answers within the window, the app falls through to the normal `Unlock` screen unchanged.

Two properties make this safe to do at all:

- **`BroadcastChannel` is same-origin.** Only pages on this origin can join, so the material never
  crosses an origin boundary and never touches the network. This is the same blast radius an XSS
  on this origin already has; it is not a new one.
- **Nonce-matched.** A reply is accepted only against the `crypto.randomUUID()` the requester
  broadcast, so a stale offer on the channel cannot be adopted.

The JWT in the offer is an optimization, not the authority. `adoptHandoffSession`
([`lib/app/boot.ts`](../app/README.md)) confirms the account with `GET /users/me` and falls back
to a full signature sign-in if the token is expired or refused — the account's mode is always read
from `has_password`, never from the offering tab's cached state.

## Never

- Nothing here touches `localStorage` or `sessionStorage`. The only persisted artifact in
  the whole flow is the PIN-wrapped vault record owned by [`lib/pin`](../pin/README.md).
- Nothing here is logged. Never add a `console.log` of a keystore instance — its fields are
  private keys.
- The mnemonic is deliberately **not** retained. `unlock` derives from it and drops it. The one
  flow that needed the seed phrase itself — recovery setup, retired 2026-09-04 — called
  `unlockSeedVault` directly for that one-off rather than having the keystore hold a plaintext
  mnemonic all session. **Keep that shape**: a flow needing the phrase re-opens the local vault,
  it does not get the keystore to keep one.

## Tests

`session.test.ts` checks that one unlock reproduces every fixture value, that the token
matches the vector, that `lock()` actually zeroes the buffers a caller was handed, that
re-unlocking zeroes the prior session, that the idle timer re-arms on access, and that the
only thing written to storage is the vault record — asserting that the PIN, the token, the
identity private key and the mnemonic appear nowhere in it.
