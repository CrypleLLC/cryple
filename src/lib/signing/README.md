# `lib/signing` — challenge and action signatures

Builds the `{challenge, timestamp, signature}` envelope every authenticated and every
destructive request carries. **Built once, here — never per call site.** This is the single
hardest piece of the client and the most repeated.

Task 8 of [tasks.md](../../../tasks.md). Implements
[auth/challenge.md](../../../../api-general/.docs/auth/challenge.md) and
[auth/signed-actions.md](../../../../api-general/.docs/auth/signed-actions.md).

## The authorization rule

> **The JWT authorizes reads and additions. Anything that destroys or replaces existing data
> needs the seed key — plus the second factor when the signer is in Paranoid Mode.**

So `GET` anything and `POST /secrets` need only the token. Every `DELETE`, plus
`POST /users/second-factor` and `PUT /users/password`, needs a signature from this module.

## The two payload shapes

```
auth    = <challenge> ":" <timestamp>
action  = <challenge> ":" <timestamp> ":" <action> [":" <arg> …]
```

A sign-in payload has exactly two colon-separated fields; an action payload has at least
three, and the third is always a label from a closed set. **That is why no version byte is
needed** — a signature captured from one context can never verify in the other, in either
direction. `signing.test.ts` asserts both directions.

## API

| Export | Purpose |
| --- | --- |
| `createChallenge()` | 32 random bytes → 64 lowercase hex |
| `currentTimestamp()` | Unix **seconds** |
| `buildAuthPayload` / `buildActionPayload` | The colon-joined strings above |
| `signPayload(payload, privateKey)` | → base64 of 64 raw bytes |
| `verifyPayload(payload, sig, publicKey)` | Client-side audit of a stored vote |
| `signAuthEnvelope(identity, { paranoid })` | Sign-up / sign-in envelope |
| `signActionEnvelope(action, args, identity, { paranoid })` | Everything destructive |
| `ACTIONS`, `getActionSpec`, `normalizeActionArgs` | The action table as data |

## Things that silently break every signature

**Do not pre-hash.** `p256.sign` applies SHA-256 to its message argument, exactly as
`crypto.subtle.sign` does. Hashing first signs `SHA-256(SHA-256(payload))` and the server —
which hashes once — rejects everything. The test suite pins this: a deliberately
double-hashed signature must fail to verify.

**IEEE P1363 only** — raw `r‖s`, exactly 64 bytes, base64. The ASN.1/DER fallback was
removed from the backend. `signPayload` asserts the 64-byte length rather than trusting the
library's default format.

**WebCrypto cannot sign here.** It cannot import a raw EC private scalar, and the key tree
produces exactly that — hence `@noble/curves`. The output is byte-compatible: the test suite
verifies a noble signature with `crypto.subtle.verify`.

**One challenge per request, always fresh.** It is consumed *before* the signature is
verified, so every retry — including automatic ones — needs a new triple. That is why
[`lib/api`](../api/README.md) never retries.

**Freshness is ±300s in both directions.** A future timestamp fails too. Never fake or round
the clock; if sign-in fails on a valid account, check the device clock first.

## The action table

`ACTIONS` encodes [signed-actions.md § Actions](../../../../api-general/.docs/auth/signed-actions.md#actions)
as data — label → argument order → second-factor flag → who signs. **A new action is one row,
not new code.** All 18 are present and the count is asserted.

`normalizeActionArgs` enforces arity, rejects empty arguments, and rejects any argument
containing `:` — the field separator.

### The second factor

`password` is attached exactly when **the table demands it** *and* **the account is
Paranoid**. Mode comes from `has_password` on `GET /users/me` — never a cached guess, because
local state does not survive a reinstall and "restore on a new device" is the normal path.

Sending a token on a Standard account fails exactly as hard as omitting it on a Paranoid one,
so both mistakes are prevented here rather than at the call site.

**The signer's own mode decides — the *signer's*, not the account owner's.** Every action in
`ACTIONS` today is signed by the account's own owner, so `signer` is `'owner'` on all six and the
distinction costs nothing. Keep it anyway: it is load-bearing the moment private sharing adds an
action one account signs against another's data, and it was load-bearing before, when guardians
signed against an owner's account.

**One carve-out takes no second factor, structurally** — do not "fix" it:

| Action | Why |
| --- | --- |
| `enable-second-factor` | None exists yet; that is what the call creates. |

Four more carve-outs existed until 2026-09-04, all belonging to the guardian-gated PIN reset:
that flow was for an owner who had **lost** the PIN, so demanding it would have defeated the
flow. It left with recovery, and with it the last route in this API that a caller could reach
without a token.

### `secret-delete` is the only batchable action

Its ids are **sorted ascending and de-duplicated** before the payload is built, because the
server rebuilds it the same way. `DELETE /secrets/{id}` is the one-element case of the same
label. Every other signature binds one target, so N deletions elsewhere means N signatures and
N challenges.

### Actions with their own gotchas

- **Both second-factor actions sign the new token itself**, not the intent, so nothing between
  the client and the server can substitute a value of its own on a validly-signed call. That
  matters more since 2026-09-04: with no reset path, an account that comes out of enrolment with
  the wrong PIN is finished.
- **Sign the value, not the intent** generalises. Nine retired actions all followed it, and the
  next action this table gains — a share addressed to a recipient — has to bind the recipient
  or a proxy can redirect it. The retired specs are live in `dms-shamir`.

## Failure modes the UI must not try to distinguish

A bad signature and a wrong PIN both return `401 INVALID_CREDENTIALS`, identically and by
design. **Render one generic message.** And because the challenge is spent before the second
factor is checked, a wrong PIN burns it — the retry needs a fresh triple, not the same one.

## Tests

`signing.test.ts` mirrors the backend's `service_test.go`: the signature is bound to its
challenge, timestamp, action label and every argument (each checked by mutating one field and
asserting the signature no longer verifies); a sign-in signature is refused as an action
signature and vice versa; `secret-delete` ids sort and de-duplicate to an order-independent
payload; the P1363 length holds across many signings; and the second-factor attachment matrix
covers Standard, Paranoid and all three carve-outs.
