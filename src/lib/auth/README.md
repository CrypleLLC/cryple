# `lib/auth` — the routes that grant a token

The three ways a browser gets a JWT, per [front-end-endpoints.md § 7 and § 19](../../../front-end-endpoints.md#7-auth-endpoints).
Each answers `{ access_token, device_id }`: the token names the device.

```ts
await signUpWithGenesis({ userAddress, rootPublicKey, root, batch, tokens? })  // POST /sign-up
await signInDevice({ deviceId, signer, tokens? })                              // POST /sign-in
await readChainWithRoot({ userAddress, root, pinProof? })                      // POST /devices/enrol/chain
await enrolWithRoot({ userAddress, root, batch, pinProof?, tokens? })          // POST /devices/enrol
signOut(tokens, session?)
```

The flows that call these, and what they do around them, are [`lib/account`](../account/README.md).

| Route | Signed by | Payload |
| --- | --- | --- |
| `/sign-up` | the root | `challenge:timestamp`, plus the root-signed genesis batch (`lib/keyrings`) |
| `/sign-in` | the device | `challenge:timestamp`, and `device_id`. No account field, no PIN |
| `/devices/enrol/chain` | the root | action `chain-read` over `user_address`, with the PIN proof on Paranoid |
| `/devices/enrol` | the root | action `device-enrol` over `user_address` and `batchDigest(batch)`, with the PIN proof on Paranoid |

**Sign-up is retry-safe only with the same genesis.** A retry of the same batch answers `200`
with a token for the same device; a new genesis for an existing address is refused.
`lib/account` keeps the drafted batch until an answer arrives, for that reason.

## The `404` is deliberately ambiguous

Every rejection on these routes is `404 NOT_FOUND`: an unknown or removed device, a bad
signature, a stale challenge, no account for the phrase, a wrong or missing PIN proof.
`AuthRejectedError` carries exactly one `userMessage` —
*"We could not sign you in. Check your recovery phrase and PIN, then try again."* — and never
says "not found". Its `diagnostic` is for developers only.

**A `429` is never one of these.** [`lib/api`](../api/README.md) maps it to a wait, not to an
authentication failure.

## Sign-out

`signOut` drops the token and locks the keystore. It sends nothing. Removing this browser from
the account, which does reach the server, is `removeThisBrowser` in `lib/account`.

## Tests

`auth.test.ts` stubs `fetch` and checks: the root key and a root signature over
`challenge:timestamp` on sign-up, with a genesis that replays from the root key; `201` as
created and `200` as a retry; no phrase, seed or private key on the wire; sign-in carrying only
the device id and a device signature; a fresh challenge per attempt; the token store untouched
on refusal; `device-enrol` and `chain-read` signed over their exact arguments, with a PIN proof
over the same digest on Paranoid; and one generic message for every enrolment `404`.
