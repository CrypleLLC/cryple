# `app`

Milestone 5 — the product logic behind the shell. Everything here is framework-free `.ts` so it
can be unit-tested under the existing node-environment Vitest setup; the React components in
[`src/components`](../../components/README.md) are thin renderers over it.

| Module | What it owns |
| --- | --- |
| `onboarding.ts` | The onboarding state machine, PIN/mnemonic validation copy, backup verification |
| `boot.ts` | Sign-in when the mode is not known yet, and account enrolment |
| `mode-hint.ts` | The locally remembered Standard/Paranoid hint |
| `inbox.ts` | Merging the two guardian queues into one list |
| `vault.ts` | The vault index view model and received-ciphertext integrity check |
| `succession-view.ts` | Release status, vote audit and heir view models |
| `recovery-kit.ts` | The printable share-0 Recovery Kit |
| `label.ts` | The heir-label sealing seam (blocked, see below) |

## Onboarding

The flow is a reducer, not scattered `useState` — every guard that matters is testable without
rendering. Order: **origin → (backup → verify | import) → PIN → mode → enrolling → done.**

**The PIN step comes before the mode choice and applies to both modes.** This is easy to get
backwards: the PIN is not only the second factor. It always wraps the seed in the local vault at
rest ([`pin`](../pin/README.md)), and only *additionally* becomes the `Server_Auth_Token` in
Paranoid Mode. A Standard-mode user still sets one.

The reducer refuses to advance on a failed checksum or a rejected PIN, so a bad value cannot
reach a derivation. `MODE_COPY.oneWayDoor` states that Paranoid → Standard does not exist; a test
asserts the copy never contains the words "disable" or "remove the PIN", because
[no such affordance may ever exist](../../../AGENTS.md).

`buildVerificationChallenge` picks distinct word positions and takes an injectable `pick` so the
test is deterministic. `verifyBackup` is tolerant of case and whitespace — a user copying from
paper should not fail on capitalisation — but rejects a short answer list rather than passing on a
prefix match.

## Signing in without knowing the mode

Sending the `password` on a Standard account fails exactly as hard as omitting it on a Paranoid
one, and both return the same anti-enumeration `404`. Since the mode lives in `has_password` on
`GET /users/me`, which needs a token, there is a bootstrap problem on a fresh unlock.

`signInWithModeDetection` resolves it: try the locally hinted mode, and on an `AuthRejectedError`
try the other. **Each attempt builds its own `{challenge, timestamp, signature}`** — the challenge
is consumed before the signature is checked, so the second attempt cannot reuse the first's.
A test asserts the two challenges differ.

Two things it deliberately does **not** do:

- It does not treat the hint as the answer. After a successful sign-in it reads `has_password`
  from `/users/me` and reports that — the hint is only an ordering optimisation, and
  `writeModeHint` corrects it from the authoritative value.
- It does not swallow real failures. Only `AuthRejectedError` triggers the fallback; a `500` or a
  transport error propagates, so an outage is never mis-rendered as "wrong mode". A test pins this.

The hint in `localStorage` is not a secret and not a credential — it is one of `standard` /
`paranoid`, and an unrecognised value reads as absent.

## The guardian inbox

Both guardian queues — pending recovery sessions and pending PIN resets — are one list, because to
a guardian they are one job. `buildInbox` sorts **actionable first, then newest**, so the thing
needing a response is never below a completed one.

- A `contest_period` PIN reset is **informational, never a vote prompt**. Only `pending_quorum`
  rows accept a vote; the API answers `409` otherwise. `canVoteOn` from the recovery domain is the
  single source of that rule.
- An already-submitted recovery share stays visible, marked done, rather than vanishing.
- Recovery sessions carry a 30-minute `expires_at` and `hasExpired` gates the action. PIN resets
  have no expiry here — their clock is the 48h contest period.
- The poll interval is the recovery domain's `GUARDIAN_INBOX_POLL_INTERVAL_MS` (60s), not a new
  constant. There are no webhooks; polling faster buys nothing.

## The vault index

`buildVaultIndex` renders the unpaginated `GET /secrets?fields=meta` listing, newest first.

`checkIntegrity` **hashes the ciphertext you actually received** and compares it to
`ciphertext_sha256` rather than trusting the reported digest — a server-reported hash of
server-held bytes proves nothing.

`VAULT_SEALED_NOTICE` and `isVaultSealed` exist because item bodies cannot be opened in this
build: `unwrapDek` rejects with `KekNotSpecifiedError` until Decision A lands. The index is real
data from the server; only the contents are sealed. The UI says so rather than showing a crash.

## The Recovery Kit

Share 0 — the user's own copy of the Shamir share — needs a durable, retypeable form.
`encodeRecoveryKitShare` produces `CRK1-` followed by grouped uppercase hex with a 2-byte SHA-256
checksum; `decodeRecoveryKitShare` is tolerant of case, spaces and dashes and **rejects a
mistyped character instead of returning a wrong share**. A silently wrong share fails at
reconstruction, months later, which is exactly the failure mode the checksum removes.

> This encoding is a **local presentation format, not a protocol constant.** It never reaches the
> server, no other party parses it, and the share bytes inside it are the SSS library's own format
> (which *is* durable). The `CRK1` prefix is there so a future change is detectable rather than
> silently misparsed — the same discipline as the versioned blob layouts, applied to paper.

`renderRecoveryKit` states the k-of-n scheme, the guardians it was split among, and that Cryple
cannot reissue it.

**Sequencing note:** share 0 only exists once recovery setup runs, and setup needs guardians, so
the kit is surfaced from the Guardians screen rather than during first-run onboarding. Onboarding
covers phrase, PIN and mode; there is nothing to put in a kit before a guardian exists.

## The blocked heir label

`registerBeneficiary` needs a non-empty `encrypted_label` — the owner's private note about an
heir, which the zero-knowledge rule says must be sealed on this device.

**There is no key specified to seal it with.** `label.ts` therefore ships the same shape as the
DEK seam: an interface plus `unspecifiedLabelSealer`, which rejects with
`LabelKeyNotSpecifiedError`. Naming an heir is disabled in the UI with `LABEL_SEALED_NOTICE`;
listing and removing existing heirs work normally.

Substituting an existing key here — the X25519 private key, the identity key, the
`Server_Auth_Token` — would be the exact invention `storage-plan.md` §3.1.1 forbids, and worse,
reusing a credential or an asymmetric secret as a symmetric wrapping key. Decision A's
`Cryple-Key-v1|vault-kek` is the natural key; when it lands, implement `LabelSealer` and delete
the notice. No call site changes.
