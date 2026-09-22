# `lib/signing` — challenge and action signatures

Builds the `{challenge, timestamp, signature}` envelope every authenticated and every
destructive request carries. **Built once, here — never per call site.** This is the single
hardest piece of the client and the most repeated.

Task 8 of [tasks.md](../../../tasks/tasks.md). Implements
[auth/challenge.md](../../../../api-general/.docs/auth/challenge.md) and
[auth/signed-actions.md](../../../../api-general/.docs/auth/signed-actions.md).

## The authorization rule

> **A device's JWT authorizes reads and additions within its scopes. Destroying data needs a
> full device's signature. Destroying or re-keying the account needs the root, plus the PIN
> proof on Paranoid accounts.**

## Who signs

Signing is behind a `Signer` (`signBytes(message) → 64-byte P1363`):

| Signer | Key | Signs |
| --- | --- | --- |
| `cryptoKeySigner(key)` | This device's non-extractable WebCrypto key | Sign-in, device actions, chain statements |
| `rawKeySigner(privateKey)` | The root, derived from the phrase for one flow | Sign-up, enrolment, root actions, root-signed chain statements |

Both hash with SHA-256 over the payload bytes and produce the same format, so the server verifies
either the same way.

## The two payload shapes

```
auth    = <challenge> ":" <timestamp>
action  = <challenge> ":" <timestamp> ":" <action> [":" <arg> …]
```

A sign-in payload has exactly two fields; an action payload has at least three, and the third is
a label from a closed set. A signature captured in one context never verifies in the other, in
either direction.

## API

| Export | Purpose |
| --- | --- |
| `createChallenge()`, `currentTimestamp()` | 64 lowercase hex; Unix **seconds** |
| `buildAuthPayload` / `buildActionPayload` | The strings above |
| `signPayload(payload, signer)` | → base64 of 64 raw bytes |
| `verifyPayload(payload, sig, publicKey)` | Accepts high-S signatures, which Go and WebCrypto produce |
| `signAuthEnvelope(signer)` | Sign-up (root) and sign-in (device) |
| `signActionEnvelope(action, args, device)` | Device actions only; refuses a root action |
| `signRootAction(action, args, root, pinProof?)` | Root actions; adds `pin_proof`, an Ed25519 signature over `payloadDigest(payload)`, the same SHA-256 digest the root signature covers. Refuses a proof on an action that never takes one |
| `ACTIONS`, `getActionSpec`, `normalizeActionArgs` | The action table as data |

## Things that silently break every signature

- **Do not pre-hash.** The signer hashes the payload once, like the server. Hashing first signs
  `SHA-256(SHA-256(payload))`.
- **IEEE P1363 only**, 64 bytes. `signPayload` asserts the length.
- **One challenge per request, always fresh.** It is consumed before the signature is checked,
  so every retry needs a new triple, and [`lib/api`](../api/README.md) never retries.
- **Freshness is ±300 s in both directions.** Never fake or round the clock.

## The action table

`ACTIONS` encodes [signed-actions.md § Actions](../../../../api-general/.docs/auth/signed-actions.md#actions)
as data: argument order, signer (`root` or `device`), whether a PIN proof applies, and whether it
is batchable. The count is asserted.

- **Root actions:** `chain-read`, `device-enrol`, `account-delete`, `second-factor-begin`,
  `enable-second-factor`, `rotate-second-factor`, `pin-evaluate`. A proof goes on all of them on
  a Paranoid account except `enable-second-factor` (no PIN exists yet) and `pin-evaluate` (it is
  how the proof is obtained). A Standard account never sends one.
- **The four deletes** (`secret-delete`, `note-delete`, `document-delete`, `file-delete`) are
  batchable: ids are sorted and de-duplicated before signing, and the single delete is the
  one-element case. They need a full device.
- **Sharing actions bind the counterparty or the item**: `connection-invite` binds the username,
  the blob and both key generations; `connection-keys` and `address-book-update` bind a digest
  of exactly what is stored.
- **`username-update` binds the normalised name**, which [`lib/users`](../users/README.md)
  applies before signing.

`normalizeActionArgs` enforces arity and rejects empty arguments and any containing `:`.

## Failure modes the UI must not try to distinguish

A bad signature and a wrong PIN proof both return `401 INVALID_CREDENTIALS` on root actions (or
the uniform `404` on enrolment). **Render one message**, and after two failures for a PIN the user
is sure of, suggest waiting (`lib/app` → `accountPinRefusal`).

## Tests

`signing.test.ts`: challenge and payload shapes, P1363 from both signers, verification against
the right key only, high-S acceptance, the non-extractable device key, binding to every payload
field, auth versus action separation, batch normalisation, the action table's signers and proof
rules, device-versus-root refusals, and a PIN proof that verifies over the root's digest.
