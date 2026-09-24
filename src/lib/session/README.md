# `lib/session` — the keys of an unlocked browser

`SessionKeystore` holds, in memory, what an unlocked browser works with:

- the device's keys (`lib/device`): its non-extractable signing `CryptoKey`, its X25519 key and
  its opened ML-KEM key;
- the unwrapped **scope KEKs**, by scope and generation, and the current generation of each;
- the sealed sharing material of each `sharing` generation, opened on first use;
- the account's `user_address` and root public key, this device's id, its scopes and its PIN
  registration id.

**The phrase, the seed and the root keys are never in it.** They exist only inside a sign-up,
an enrolment or a root action (`lib/account`), and are zeroed right after.

## API

```ts
session.open(keys)                        // after unlock, sign-up or enrolment
session.signer()                          // the device key, for sign-in, actions and statements
session.currentKek(scope)                 // { generation, kek }: every write wraps under this
session.kek(scope, generation)            // for reading a row by its key_generation
session.addKeyrings(entries, current)     // after a rotation or a keyring refresh
session.sharingKeys(generation)           // opens that generation's sharing material once
session.holds(scope), session.isFullDevice
session.lock(), session.onLock(listener)
```

- **A scope the device does not hold** throws `ScopeNotHeldError`.
- **A generation of a held scope with no KEK** throws `MissingGenerationError`. Every generation
  is wrapped to every device holding the scope, so this is a bug to report, not a state to hide.

## Two ways to leave

- **Lock** zeroes every KEK, the sharing material and the device material, and drops the token.
  The device record stays, so the PIN brings the browser back.
- **Remove this browser** (`lib/account` → `removeThisBrowser`) is a self `device-remove` batch:
  the server stops accepting the device at once, and the record is deleted. Coming back needs
  the phrase.

The keystore also locks itself after 15 minutes idle (`DEFAULT_IDLE_TIMEOUT_MS`). Each access
re-arms the timer.

## Cross-tab handoff — `handoff.ts`

Key material lives in memory, per JS context, so a new tab is always locked. A document opened
from the grid goes to its own tab (`/docs/[id]`), and asking for the PIN there would cost an
OPRF round trip and an Argon2id derivation each time. So a tab the app opens asks **the tab that
opened it**, and nobody else:

```ts
openWithSessionHandoff(url)  // the unlocked tab opens the window and remembers it
serveSession(() => …)        // …and answers requests from windows it remembers
await requestSession()       // the new tab asks window.opener, and gives up after HANDOFF_TIMEOUT_MS
```

The offer is `exportForHandoff()` plus the current JWT: **keys, never a phrase.** The signing and
X25519 keys travel as `CryptoKey`s, which `postMessage` structure-clones even though they are
non-extractable, so the new tab signs with the same device key without being able to export it.
The KEKs and the ML-KEM seed travel as copies, so locking one tab never zeroes the other.
`adoptHandoff` opens the keystore with them. With no answer, the tab shows the normal unlock
screen.

An offer is sent only when all of these hold, and each is tested in `handoff.test.ts`:

- **The requester is a window this tab opened.** `HandoffServer.open` keeps the `WindowProxy` that
  `window.open` returned, and only a request whose `event.source` is one of them is answered. A
  script in any other tab has no request that can be served, even with a reference to this tab.
- **The message comes from this origin**, and the reply is posted with this origin as the
  `targetOrigin`.
- **The requester accepts only its opener's reply, carrying its own nonce.**
- **A closed window is forgotten** the next time a request is checked.

**The cost, accepted:** a `/docs/[id]` tab not opened from the grid (typed, bookmarked, restored)
asks for the PIN. A reloaded document tab keeps its opener and recovers without one.

The document tab keeps a live `window.opener`, which is what the handoff rides on. The opener is
always this origin, and `Cross-Origin-Opener-Policy: same-origin` severs it for any cross-origin
page.

`HandoffServer` and `requestSessionFromOpener` take a `HandoffHost` rather than touching `window`,
so the tests drive two fake windows through the whole exchange. `browserHandoffHost` is the one
adapter to the real `window`.

## Never

- Nothing here touches `localStorage` or `sessionStorage`. The only persisted artifact is the
  device record in IndexedDB, owned by [`lib/device`](../device/README.md).
- Nothing here is logged. Never add a `console.log` of a keystore: its fields are keys.
- Never add the phrase or the root to the keystore. A flow that needs them takes the phrase from
  the user for that one flow.

## Tests

`session.test.ts`: what it holds and never holds, the non-extractable signing key, scope and
generation refusals, lazy sharing material, rotation adding generations, zeroing and listeners
on lock, the idle timer, and a handoff that survives structured cloning and still signs.
`handoff.test.ts`: every rule of the handoff above.
