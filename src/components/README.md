# `components`

Milestone 5 — Tasks 24 and 25. The React surface. Every decision that can be tested without a DOM
lives in [`src/lib/app`](../lib/app/README.md); these files render it and nothing more, because
the repo's Vitest setup is node-environment and matches `src/**/*.test.ts` only.

| File | Role |
| --- | --- |
| `CrypleProvider.tsx` | Session custody, phase machine, error translation |
| `Onboarding.tsx` | Task 24 — phrase, PIN, mode, enrolment |
| `Unlock.tsx` | PIN unlock and the 3-attempt device wipe |
| `AppShell.tsx` | Task 25 — the three-tab shell |
| `VaultScreen.tsx` | Vault index from the meta listing |
| `GuardiansScreen.tsx` | Guardians, recovery setup, Recovery Kit |
| `GuardianInbox.tsx` | The merged guardian queue, 1-minute poll |
| `SuccessionScreen.tsx` | Release status, vote audit, heirs |
| `RecoveryKitCard.tsx` | The printable share-0 surface |
| `ui.tsx` | Card / Button / Field / Notice primitives |

## Session custody

`CrypleProvider` owns the one `SessionKeystore` and the one `TokenStore` for the app. Its phase is
`loading → onboarding | locked → ready`, decided by whether a local seed vault exists.

**Unlock once, sign from memory.** The 600k-iteration PIN stretch is paid at unlock; the derived
signing key and `Server_Auth_Token` stay in the keystore for the session. Nothing prompts for the
PIN per action.

The provider subscribes to `session.onLock()`, so the keystore's own idle timeout drives the UI
back to `locked` rather than the two drifting apart.

`reportError` is the single funnel for failures: it renders `userMessageFor(error)` — copy built
client-side from the `code`, since the API sends no message — and drops the token on
`401 UNAUTHORIZED`, which is the only 401 meaning "sign in again". `401 INVALID_CREDENTIALS`
renders as one generic message, because a bad signature and a wrong PIN are indistinguishable by
design.

**Logout is deleting our own copy of the token.** There is no revocation endpoint, no session
list, and no "sign out all devices" — none of that is rendered anywhere.

## Onboarding

`enrol` writes the local seed vault **after** `POST /sign-up` succeeds, so a rejected enrolment
does not leave a vault for an account that was never created. On any failure the keystore is
locked, zeroing what was derived.

The mode step states the one-way door before either button. There is no "disable PIN" control and
there never will be.

## Recovery setup asks for the PIN again

`SessionKeystore` holds the derived key tree, not the mnemonic — deliberately. Splitting a REK
needs the seed **phrase**, so the Guardians screen re-opens the local vault with
`unlockSeedVault(pin)` for that one operation. That is a real re-prompt, and the field says why.

It also asks for each active guardian's 64-hex **account address**, because
`GET /recovery/guardians` returns usernames and encryption keys but no address, and PQXDH's `info`
string binds one. Each entry is checked with `GET /users/lookup` and refused unless it resolves to
that guardian's username — wrapping a share to the wrong address produces a blob the guardian can
never open, and nothing server-side would catch it. The same check exists on the succession side
as `resolveRecipient`.

Quorum is shown as `min(configured, active)` alongside the guardian count, with an explicit
warning when the configured threshold exceeds the number of guardians who can actually answer.
The k=1 sole-guardian warning is rendered verbatim from the spec.

## Product boundaries this shell respects

Taken from [AGENTS.md § Product boundaries](../../AGENTS.md); each of these is an absence, so it is
recorded here rather than being visible in the code:

- **No heir-facing screens.** Nothing lets a named heir discover, accept, decline or claim an
  inheritance. Before release that is permanent by design; after release the routes do not exist.
- **No session list or "sign out all devices".**
- **No key-rotation flow.** `keys_rotated: true` renders "this heir closed their account — remove
  them and choose another", never a re-wrap prompt.
- **No UI waiting on `released`, `cancelled` or `completed`.** The succession dashboard renders
  only `monitoring` and `counting_down`, and `last_check_in` is labelled as a record-creation date,
  not a live "last seen".
- **No check-in or dead-man's-switch configuration.** Both are on-chain owner actions; the screen
  says so instead of offering controls that would silently do nothing.

## What is visibly blocked

Two screens surface unresolved backend spec gaps rather than hiding or faking them:

- **Vault items cannot be opened or created** (`KekNotSpecifiedError`). The index is real; the
  contents are sealed.
- **Naming an heir is disabled** (`LabelKeyNotSpecifiedError`). Listing and removing heirs work.

Both resolve with Decision A. See [`src/lib/app`](../lib/app/README.md#the-blocked-heir-label).
