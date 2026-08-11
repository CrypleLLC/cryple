# `components`

Milestone 5 — Tasks 24 and 25. The React surface. Every decision that can be tested without a DOM
lives in [`src/lib/app`](../lib/app/README.md); these files render it and nothing more, because
the repo's Vitest setup is node-environment and matches `src/**/*.test.ts` only.

| File | Role |
| --- | --- |
| `CrypleProvider.tsx` | Session custody, phase machine, error translation |
| `Onboarding.tsx` | Task 24 — phrase, PIN, mode, enrolment |
| `Unlock.tsx` | PIN unlock and the 3-attempt device wipe |
| `AppShell.tsx` | Task 25 — the sidebar shell and navigation registry |
| `VaultScreen.tsx` | Vault index, add/delete secrets (Task 34) |
| `VaultReveal.tsx` | The vault's global show/hide-values state and its top-bar button |
| `GuardiansScreen.tsx` | Guardians, recovery setup, Recovery Kit |
| `GuardianInbox.tsx` | The merged guardian queue, 1-minute poll |
| `SuccessionScreen.tsx` | Release status, vote audit, heirs |
| `RecoveryKitCard.tsx` | The printable share-0 surface |
| `ui.tsx` | Card / Button / Field / TextArea / Badge / Notice primitives |
| `icons.tsx` | The stroke-icon set shared by navigation and primitives |

## Layout and design system

The shell is a Drive-style dashboard: a fixed left sidebar with the logo, the navigation and the
account summary, a sticky top bar carrying the current section's title and the session-exit
buttons, and a constrained content column. Below the `md` breakpoint the sidebar folds into a
sticky top header with a horizontally scrolling nav row.

Navigation is one registry, `NAV_ITEMS` in `AppShell.tsx`. Each entry is
`{ id, label, description, icon, screen, actions? }`; adding a section (notes and a document
editor are planned) means adding one entry and its screen component — the sidebar, the mobile
nav and the top-bar heading all render from the same array. `actions` is the optional slot for a
component rendered in the top bar beside Lock / Log out, for controls that belong to the whole
screen rather than to one panel; the Vault's global reveal toggle is the first of them. State
shared between such a control and its screen lives in a provider wrapping the shell, as
`VaultReveal.tsx` does, since the header sits outside the screen's tree.

Content panels follow the GCP/AWS console idiom rather than floating cards: the page background
matches the panel background, so a panel is delineated only by its 1px border and its header
strip, with no shadow and small corner radii. `Card` takes a `flush` prop for table and list
content, which then runs edge-to-edge inside the panel (rows carry their own horizontal padding),
the way console tables do. The content column is full-width with a small gutter, not a centered
column. Panels that do not need the full width sit inside a `PanelGrid` — a two-column grid from
`md` up, a single stacked column on mobile. Grid items stretch, so neighbours in the same row
share a height and their borders line up regardless of how much content each holds. A lone panel
occupies half the content width and two sit side by side. Guardians puts all four of its panels
in one grid; Succession keeps "Release status"
outside it at full width and grids the rest; Vault keeps its table full width and grids the form.
Wide tables and dashboards stay outside a grid.

The brand color is `#667eea`, defined once as the `brand` scale in
[`globals.css`](../app/globals.css) via Tailwind's `@theme`. It is used sparingly — primary
buttons, the active nav item, focus rings, the avatar and the Paranoid-mode badge — over a
neutral slate surface, in the manner of Drive/Proton. Destructive buttons are outlined rather
than solid so rows of actions stay calm. Every interactive primitive carries a
`focus-visible` brand ring. All colors have dark-mode variants keyed off
`prefers-color-scheme`.

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

One screen surfaces an unresolved backend spec gap rather than hiding or faking it:

- **Naming an heir is disabled** (`LabelKeyNotSpecifiedError`). Listing and removing heirs work.
  See [`src/lib/app`](../lib/app/README.md#the-blocked-heir-label) — Decision A's vault KEK
  explicitly does not cover this field, so it stays blocked even though the vault itself no
  longer is.

Vault items used to be blocked the same way (`KekNotSpecifiedError`) until Decision A landed
2026-08-08 and was wired in 2026-08-10. `VaultScreen` was built the same way while it was still
blocked — the real add/reveal/delete UI against the actual `@/lib/secrets` calls, rather than a
disabled placeholder — so once the seam stopped throwing, Add and Show started working with no
UI change.

## Why the vault list downloads every payload

**Names are ciphertext.** A secret's plaintext is one `{name, value}` JSON blob, so the server
holds no name field to list — `GET /secrets?fields=meta` returns sizes and timestamps and
nothing a person can read. Showing names in the index therefore means opening every item, and
the list loads through `listSecrets` — the single unpaginated `GET /secrets` the endpoint guide
calls "the heaviest response the API produces" — rather than the meta listing plus one
`GET /secrets/{id}` per row. One request beats N, and the values are then already in memory.

Hiding is consequently presentational only: the global toggle in the top bar flips a boolean,
never a fetch, so it is instant in both directions and costs nothing to use. Names stay visible
at all times; only values mask, and they mask to a fixed-width `MASKED_VALUE` so the rendering
does not leak the length. Copy stays available while values are hidden — the point of hiding is
shoulder-surfing, not withholding the value from its owner.

An item that will not decrypt is rendered as `UNREADABLE_SECRET_NAME` and keeps its row instead
of failing the whole list, since one blob written by another client must not blank the vault.
`buildVaultRows` in [`lib/app`](../lib/app/README.md) does that classification, so it is tested
without a DOM.
