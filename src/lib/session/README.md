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
to avoid. So a tab the app opens asks **the tab that opened it**, and nobody else:

```ts
openWithSessionHandoff(url)  // the unlocked tab opens the window and remembers it
serveSession(() => …)        // …and answers requests from windows it remembers, while mounted
await requestSession()       // the new tab asks window.opener, and gives up after HANDOFF_TIMEOUT_MS
```

The offer carries the **64-byte seed** (hex), the `Server_Auth_Token` and the current JWT.
`adoptHandoff` rebuilds the tree with `deriveKeyTreeFromSeed` — no PBKDF2, no prompt. When nobody
answers within the window, the app falls through to the normal `Unlock` screen unchanged.

### Why not a `BroadcastChannel`

Until 2026-09-13 the handoff was a broadcast: an unlocked tab answered every `request` on a
same-origin channel. That made the seed available to **any script running on the origin that
asked** — an XSS, a compromised dependency, an extension's page script, or a `/docs` tab that was
never unlocked — without the PIN, and Paranoid Mode did not help because the reply carries the
second factor. "Same origin" was the whole boundary, and it is not one: one injection anywhere on
the origin became the account, permanently, since keys do not rotate.

### What the handoff checks now

An offer is sent only when all of these hold, and each is tested in `handoff.test.ts`:

- **The requester is a window this tab opened.** `HandoffServer.open` keeps the `WindowProxy` that
  `window.open` returned, and a request is answered only when `event.source` is one of them. A
  script in any other tab cannot make the unlocked tab open a window, so it has no request that
  can be served — even if it holds a reference to the unlocked tab.
- **The message comes from this origin**, and the reply is posted with this origin as the
  `targetOrigin`, so it cannot be delivered anywhere else if the window navigated away.
- **The requester accepts only its opener's reply, carrying its own nonce.** An offer from any
  other window, or for another request, is ignored.
- **A closed window is forgotten** the next time a request is checked.

**The cost, accepted:** a `/docs/[id]` tab that was not opened from the grid — the URL typed or
pasted, a bookmark, history, a tab restored after the browser restarts — asks for the PIN. A
reloaded document tab keeps its opener and still recovers without one.

**The document tab keeps a live `window.opener`.** That is what the handoff rides on, so
`openWithSessionHandoff` does not pass `noopener`. The opener is always this same origin, and
`Cross-Origin-Opener-Policy: same-origin` severs the relationship for any cross-origin page.

**Handing off less than the seed would not help.** The vault KEK alone opens every item, so any
material that lets the new tab work is the account.

`HandoffServer` and `requestSessionFromOpener` take a `HandoffHost` rather than touching `window`,
so the tests drive two fake windows through the whole exchange in the node environment.
`browserHandoffHost` is the one adapter to the real `window`.

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

`handoff.test.ts` runs the exchange between fake windows:
- A window the unlocked tab opened receives the offer.
- A same-origin window it did not open gets nothing, even one holding a reference to it.
- A foreign origin is ignored.
- A locked or stopped server answers nothing.
- A reply with another nonce is refused.
- A window with no opener asks nobody and leaves no listener behind.
- A closed window is forgotten.
