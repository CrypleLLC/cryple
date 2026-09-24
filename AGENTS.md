# Cryple Web App — Agent Guide

Next.js 15 (App Router) client for the Cryple API. TypeScript, React 19, Tailwind v4.

## Read before writing code

| File                                               | What it is                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [front-end-guide.md](./front-end-guide.md)         | Base URL, auth model, who signs what, JWT, retry safety, client caveats. **§5 is mandatory.**         |
| [front-end-endpoints.md](./front-end-endpoints.md) | Every route, payload, response and error code. A synced copy of the API's; only link prefixes differ. |
| [tasks/tasks.md](./tasks/tasks.md)                 | The client task list. Work from it.                                                                   |

These describe the API **as implemented**, the wire contract, and win over the current source and
over anything you remember. The derivations and byte layouts are in `../api-general/docs/`:

| File                                                                     | What it settles                                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [crypto/ECDSA.md](../api-general/docs/crypto/ECDSA.md)                   | **The frozen key tree**: seed → `user_address`, the root P-256 key, the root wrap key                                         |
| [crypto/device-keys.md](../api-general/docs/crypto/device-keys.md)       | **The model**: the seed as a cold root, devices, scopes, keyrings and generations, the event chain, batches, sharing sub-keys |
| [auth/pin-oprf.md](../api-general/docs/auth/pin-oprf.md)                 | Both PINs over an RFC 9497 OPRF: derivations, the device record, the proofs                                                   |
| [auth/two-factor-PIN.md](../api-general/docs/auth/two-factor-PIN.md)     | The two modes, the one-way rule, the PIN format rules, "no reset, ever"                                                       |
| [auth/signed-actions.md](../api-general/docs/auth/signed-actions.md)     | **The authoritative action table**: argument order, root or device signer, PIN proof                                          |
| [auth/challenge.md](../api-general/docs/auth/challenge.md)               | Challenge generation, timestamp binding, replay rules                                                                         |
| [crypto/pqxdh.md](../api-general/docs/crypto/pqxdh.md)                   | Hybrid X25519 + ML-KEM wrapping, usages `item-share` and `device-keyring`                                                     |
| [crypto/test-vectors.json](../api-general/docs/crypto/test-vectors.json) | Machine-checkable vectors for all of the above                                                                                |

**Precedence**: for a byte layout or a KDF constant, the spec wins over the guide. For a status
code, a field name or a retry rule, the guide wins.

**The API's own tests are executable contract.** When a doc leaves wire behaviour ambiguous, the
Go suites in `../api-general/internal/` decide.

## The model in one screen

```
BIP39 phrase → seed ──┬─ SHA-256(seed)                          → user_address
  (typed, never       ├─ SLIP-0010 P-256 m/9027'/0'/0'          → ROOT signing key  (users.public_key)
   stored)            └─ HKDF "Cryple-Key-v1|vault-kek"          → ROOT wrap key

Each browser (a device) generates its own keys:
  P-256 signing key   non-extractable CryptoKey in IndexedDB     signs sign-in, actions, chain events
  X25519              non-extractable where supported            receives keyring wraps (PQXDH)
  ML-KEM-768 seed     sealed under the device PIN key            receives keyring wraps (PQXDH)

Each keyring scope (passwords, secrets, notes, documents, files, sharing) has generations:
  scope KEK[g]        random 32 bytes, wrapped to the root and to every device holding the scope
  item wrapped_dek    = sealed(scope KEK[key_generation], item DEK)
```

- **The seed is never stored.** It is typed to sign up, to add this browser, to remove another
  device, and for account-level actions, then zeroed. `lib/session` holds keys, never the phrase.
- **Sign-in is the device signing `challenge:timestamp`** with `device_id`. The JWT names the
  device; `401 UNAUTHORIZED` means sign in again, and a refused re-sign-in means the device was
  removed.
- **A device PIN** unlocks the device record through the server's OPRF, which rations guesses and
  deletes the registration after the last one. **The account PIN** (Paranoid) is a proof on the
  actions the root signs. The raw PIN never leaves the device.
- **Every write carries `key_generation`**, the scope's current one. `409 STALE_KEY_GENERATION`
  means re-read the keyrings, re-wrap, retry once.
- **After a rotation, re-wrap what it left behind** — `lib/rekey`, `PUT /<scope>/keys`, signed by a
  full device like a delete. Items already stored keep the generation they were written with until
  something does this.
- **The client verifies what the server returns**: its own chain from the root key, and every
  contact's proof path from their pinned root key.
- **Phase 1**: every browser is a full device with every scope. Build scope-aware UI anyway.

The modules are `lib/keys`, `lib/scopes`, `lib/chain`, `lib/keyrings`, `lib/device`, `lib/oprf`,
`lib/session`, `lib/signing`, `lib/auth`, `lib/account`, `lib/rekey`, and the item and sharing
domains. Each has a README.

**`lib/credentials` is the password store**, and it is `lib/secrets` in a different shape: an edit
is an **append** of a new revision, never a `PUT`. `GET /credentials` is the vault listing the
Passwords tab draws, `GET /credentials/sync` is the browser extension's feed, and
`GET /credentials?fields=meta` names **revision ids** for a rotation. `passwords` is in `DEK_SCOPES`
but **not in `ITEM_SCOPES`**: `lib/rekey` does walk it, by revision id rather than item id.

**Reproduce `test-vectors.json` before this client touches real data.** The fixture copy is in
`src/test/fixtures/`. No Go test consumes the file, so this client's tests are the cross-client
check. Regenerating it is a backend operation (`go run ./tools/cryplevectors` in
`../api-general`); this client only reads it.

## Signed requests

```
auth    = <challenge> ":" <timestamp>
action  = <challenge> ":" <timestamp> ":" <action> [":" <arg> …]     SHA-256, P-256, IEEE P1363
```

- **Device actions** (deletes, username, sharing) are signed by the device, never with a PIN.
  Deletes need a full device.
- **Root actions** (`chain-read`, `device-enrol`, `account-delete`, `second-factor-begin`,
  `enable-second-factor`, `rotate-second-factor`, `pin-evaluate`) are signed by the root. On a
  Paranoid account, `pin_proof` is an Ed25519 signature over the same SHA-256 digest. A Standard
  account never sends one.
- The four deletes are batchable: ids sorted ascending and de-duplicated before signing.
- **A bad signature and a wrong PIN proof are indistinguishable by design.** Render one message.

## API rules that will bite you

- **One challenge per request, always fresh.** It is consumed before the signature is checked, so
  every retry needs a new triple.
- **Do not pre-hash.** The signer hashes the payload once, like the server.
- **IEEE P1363 only**, 64 bytes. **Freshness is ±300 s** in both directions.
- **Every signed `DELETE` requires a JSON body.** An absent body is `400 INVALID_BODY`.
- **Errors carry no message.** Copy is built client-side from `code` + endpoint. Every `404` from
  `/sign-up`, `/sign-in`, `/devices/enrol` and `/devices/enrol/chain` is one generic message.
- **`429` is never an authentication failure.** Wait `Retry-After` and say so; a `429` on
  `POST /files` pauses the upload queue.
- **Optional fields are absent, never `null`.**
- **UUIDs are canonical lowercase hyphenated**, in paths and bodies. What you send and what you
  sign must be the same bytes.
- **Status codes**: `201` created, `204` nothing to say, `200` everything else.
- **Retries are not uniformly safe** (guide § Retry safety). Always send a client-generated `id`
  on creates. Never auto-retry an OPRF evaluation: each is an attempt.
- **Public endpoints have a 350 ms response floor.** Never use timings as a signal; never set
  timeouts below ~2 s.
- **No custom request headers**, and never `credentials: "include"`.
- **1 MiB body cap** (8 MiB on documents). Budget ~700 KiB of plaintext per secret.
- **Follow `next_cursor` until `has_more` is `false`.** Cursors are opaque. Hash the ciphertext
  you received rather than trusting `ciphertext_sha256`.

## Product boundaries — do not build these

- **No guardians, no seed recovery, no PIN reset.** A forgotten account PIN is terminal, and the
  UI says so before Paranoid is turned on.
- **No "disable Paranoid".** The mode change is one-way.
- **No "sign out all devices" button.** Removing a device is the devices screen; it rotates
  what the device held.
- **Nothing on-chain.**

## Conventions

- **No comments in code.** Documentation belongs in a `README.md` per module; names carry the
  meaning.
- The server is zero-knowledge. Every `ciphertext`, `wrapped_dek`, `wrapped_key`,
  `sealed_material` and PQXDH blob is produced and consumed exclusively here.
- Never log, persist unencrypted, or send: the phrase, the seed, private keys, KEKs, DEKs, the
  PIN. Zero secrets after use.
- **The browser is a network client too.** Build text entry from `Field` / `TextArea`, or spread
  `PRIVATE_TEXT_PROPS` (`PRIVATE_TEXT_ATTRIBUTES` for TipTap). **A PIN is always a `PinField`**
  and a secret value a `SecretField` — never a `Field` with `type="password"`, which is what makes
  a browser offer to save it. Never put decrypted content in `document.title`. Copy secrets only
  through `CopyButton`. See `src/lib/app/README.md`.
- **Every response carries a Content Security Policy** from `src/lib/security-headers`. A new
  host goes into it deliberately, never as a wildcard.
- Path alias `@/*` → `./src/*`. TypeScript `strict` is on.
- `NEXT_PUBLIC_BASE_API_URL` points at the API root, with no version prefix; default
  `http://localhost:8080`.
- **Free vs Premium gating: do not build any.** The API has no tier concept.

## Commands

```bash
npm run dev       # next dev --turbopack
npm run build     # a production build needs CSP_OBJECT_STORE_ORIGINS
npm test          # vitest run, src/**/*.test.ts
npm run test:e2e  # vitest against a running API (CRYPLE_E2E_API, default http://localhost:8081)
npm run lint      # eslint, flat config
```

CI runs typecheck, lint (`--max-warnings 0`) and tests.

**Lint rules that exist because of the threat model**, each carrying its reason in
`eslint.config.mjs`:

- **`no-console` is an error, with no exemptions.**
- **`localStorage`, `sessionStorage` and `indexedDB` are blocked**, as globals and through
  `window`, `globalThis` and `self`. The exemptions:
  - `src/lib/app/icon-size.ts` — one of four words naming how large a grid draws its icons;
  - `src/lib/device/store.ts` — the device record, in IndexedDB because only IndexedDB can store
    a non-extractable `CryptoKey`; it also _removes_ two `localStorage` keys an earlier deployment
    left behind, and never reads or writes them;
  - `src/lib/files/handles.ts` — one file handle per unfinished upload.

  A new exemption needs an argument in the module's README.

Tests are Vitest in the node environment. `.tsx` component tests are deliberately not set up, so
keep testable logic in framework-free modules, as `src/lib/app` does. `src/test/session.ts` opens a
keystore with real device keys and generation-1 KEKs for tests.
