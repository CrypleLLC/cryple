# `lib/auth` — sign-up, sign-in and restore

The three entry points that turn an unlocked key tree into a JWT.

Task 10 of [tasks.md](../../../tasks.md). Endpoints per
[front-end-endpoints.md § 7](../../../front-end-endpoints.md).

## API

```ts
await signUp({ session, paranoid, tokens? });   // POST /sign-up
await signIn({ session, paranoid, tokens? });   // POST /sign-in
await restore({ session, paranoid, tokens? });  // POST /sign-up, read as a restore
signOut(tokens, session?);
```

All take an unlocked [`SessionKeystore`](../session/README.md) — the keys never pass through
a call site. Passing a `TokenStore` stores the returned token on success and leaves it
untouched on failure.

## Sign-up enrolls all three public keys, once and forever

```json
{
  "user_address": "…", "public_key": "…SPKI base64, 124 chars…",
  "encryption_public_key_x25519": "…", "encryption_public_key_mlkem": "…",
  "challenge": "…", "timestamp": 1785000000, "signature": "…", "password": "optional"
}
```

**Enrollment is immutable — there is no key rotation, and a mismatch is refused rather than
accepted.** Accepting one would silently orphan every DEK that guardians and heirs had
already wrapped to the old keys. This is what Task 3's fixture test protects, and it is why
that fixture gates every milestone.

`201` means the account was just created; `200` means it already existed and this was a
sign-in. **Both carry a usable token.** Branch first-time onboarding off the status code
rather than re-reading state — `AuthOutcome.created` carries it.

## Standard vs Paranoid

Chosen at sign-up by sending `password` or not. `paranoid: true` attaches the
`Server_Auth_Token` the keystore already holds; `false` omits it. **Sending it on a Standard
account fails exactly as hard as omitting it on a Paranoid one.**

After sign-up, the mode is read from `has_password` on `GET /users/me` — never guessed, never
taken from cached local state. Paranoid → Standard is not a supported transition and no
affordance for it exists.

## Restore on a new device

**Re-running `POST /sign-up` is the documented restore path.** It re-sends all three keys and
the server compares the two encryption keys against what it stored.

`RestoreOutcome.accountExisted` is `true` on a `200` (the account was there — this was a
restore) and `false` on a `201` (nothing existed for this seed, so a new account was just
created).

## The `404` is deliberately ambiguous

Unknown account, bad signature, malformed `password` and wrong second factor **all return
`404 NOT_FOUND`** from `/sign-up`, `/sign-in` and `/auth/verify`. That is anti-enumeration,
not a gap.

`AuthRejectedError` therefore carries exactly one `userMessage` —
*"We could not sign you in. Check your recovery phrase and PIN, then try again."* — and the
test suite asserts it never says "not found", "no such" or "exist".

It also carries a **`diagnostic`**, which is for developers and logs, never for the UI. On
`/sign-up` that diagnostic states the case worth knowing:

> A `404` on a re-run of `/sign-up` with a correct signature means **your derivation is
> wrong**, not that the account is missing. Check this build against `test-vectors.json`
> first. Nothing is overwritten by the rejected call.

Nothing else in this module distinguishes failure causes, because the server does not.

## Retry safety

All three calls are safe to retry — with a **fresh envelope**, which is automatic here since
each call signs its own. `/sign-up` reports `200` the second time. The challenge is consumed
before the signature is checked, so replaying a triple always fails; that is why
[`lib/api`](../api/README.md) has no retry logic at all.

## Sign-out

`signOut` deletes our copy of the token and locks the keystore. **That is the entire
operation** — there is no revocation endpoint, and a leaked token stays valid until its `exp`
no matter what the owner does. Do not build a "sign out all devices" affordance or a session
list; nothing server-side backs one.

Because nothing is sent, the *user-visible* difference between locking and logging out is
entirely local: what the device keeps. `sessionExits` in [`lib/app`](../app/README.md) is where
that distinction is drawn — `signOut` itself is the same call underneath both.

## Tests

`auth.test.ts` stubs `fetch` and asserts the enrolled keys match the fixture in wire encoding,
that the envelope signature verifies over `challenge:timestamp` with the derived public key,
that `201`/`200` map to `created`, that mode selection adds or omits `password`, that neither
the PIN nor the seed phrase nor the private key ever appears in a request body, that both
auth rejections render one generic message, and that two attempts never reuse a challenge.
