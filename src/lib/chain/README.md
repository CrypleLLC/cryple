# `lib/chain` — the on-chain heartbeat

The first chain code in this client. It builds, signs and submits the ERC-4337 user operation
that proves the owner is alive, and nothing else. Task 51 of [tasks.md](../../../tasks.md);
the sponsorship half it consumes is backend Task 50.

**The security rule this module exists to enforce:** the heartbeat is signed by the owner's
P-256 key, on the owner's device. The backend must never be able to check in on a user's
behalf — if it could, the impartial-judge property of the whole product is void. Nothing here
sends a private key, a signature input, or a signed operation to the Cryple API. The only
network peers are the Arbitrum RPC node, the bundler, and the paymaster.

## No new dependencies

`@noble/curves` (already present for API auth) signs, `@noble/hashes` supplies keccak-256, and
`fetch` carries JSON-RPC. There is no viem, ethers or wagmi — the operation needs one hash, one
signature and four RPC methods, and a chain library would have been the largest dependency in
`package.json` for that.

The ABI encoder in [`abi.ts`](./abi.ts) covers exactly the shapes used here: static words,
dynamic `bytes`, tuples, and arrays of tuples. It is pinned byte-for-byte against `cast` output
in [`calldata.test.ts`](./calldata.test.ts) and [`userop.test.ts`](./userop.test.ts) rather than
trusted.

## The three traps, all of which fail silently or late

**1. `@noble/curves` re-hashes by default, and the contract does not.**
`P256Account._rawSignatureValidation` calls OpenZeppelin's `P256.verify(hash, r, s, qx, qy)`,
which verifies the 32 bytes it is given as *the* message hash. `p256.sign(digest, key)` on
nist curves applies SHA-256 first, so the naive call signs `SHA-256(userOpHash)` and every
operation is rejected on-chain with `AA24`. `signUserOpHash` passes **`prehash: false`**, and
two tests pin the semantics in both directions — one asserts the signature verifies against the
raw digest, the other asserts it does *not* verify when the digest is hashed again.

**2. Low-s is a consensus rule, not a preference.** OZ's `P256.verify` rejects a high-s
signature as malleable. noble emits low-s by default; `signUserOpHash` asserts it anyway and
throws `SignatureMalleabilityError` rather than paying gas to learn it.

**3. The gas estimate needs a balance state override.** At estimation time the operation has no
paymaster attached, so the bundler simulates it as self-paying and answers
`AA21 didn't pay prefund` for any account that cannot cover the declared limits — including
every account sponsorship exists to serve. `measureGasLimits` sends
`{ [sender]: { balance: 1 ETH } }` as the third `eth_estimateUserOperationGas` parameter.

## The address derivation is frozen, and it is checked against the chain

`smartAccountAddress` reproduces `api-general/pkg/chain/address.go` exactly: CREATE2 over
the factory, a salt of `keccak256(qx ‖ qy ‖ guardianRoot ‖ threshold ‖ recoveryDelay ‖ salt)`,
and the EIP-1167 proxy code hash built from the implementation address. Four of the six salt
inputs are fixed at zero for the MVP because `GuardianRecovery` is not called until Task 63.

`FACTORY_ADDRESS`, `IMPLEMENTATION_ADDRESS` and those four zeros are **frozen in the same sense
as the key tree** — changing any one of them moves every address ever quoted to a user, with no
migration. `address.test.ts` pins the derivation against an address the deployed factory
actually returned (`0xaE7E393F…737DEe`), so a divergent constant fails the suite instead of
producing a plausible wrong account.

`assertSmartAccountMatches` compares the locally derived address against the one
`GET /succession/status` reports and refuses to sign on a mismatch. The server's copy is a
convenience; this device's derivation is the authority.

## The flow

`planHeartbeat` reads chain state and decides which of four operations is due, then measures,
then prices it:

| Account state | Operation | What one user operation does |
| --- | --- | --- |
| no code | `deploy-and-configure` | deploys the account through the factory **and** calls `configure()` |
| deployed, `statusOf == 0` | `configure` | starts the switch |
| deployed and configured, `reconfigure: true` | `reconfigure` | calls `configure()` again with new periods |
| deployed and configured | `check-in` | `checkIn()` |

**`reconfigure` is opt-in and must be, because it is not a check-in with extra steps.**
`configure()` overwrites `inactivityPeriod` and `contestPeriod`, resets `lastCheckIn` to now,
**and revokes a running contest** — so calling it by default would silently change a user's
settings every time they meant to say "I'm alive". The caller sets `reconfigure: true` only when
the periods are actually being changed; everything else still routes to `checkIn()`.

### The periods, and the floors the deployment fixes

`configure(uint32 inactivityPeriod, uint32 contestPeriod, …)` takes both as seconds, and
`HeartbeatOptions` carries them through as `inactivityPeriodSeconds` / `contestPeriodSeconds`.
They default to `MVP_INACTIVITY_PERIOD_SECONDS` (600) and `MVP_CONTEST_PERIOD_SECONDS` (300).

`DeadManSwitch` rejects anything under `minInactivityPeriod` / `minContestPeriod` with
`PeriodTooShort`. Both are **`immutable` constructor arguments**, so they cannot be raised or
lowered after deployment — a shorter period needs a *new* contract, not a transaction.

| Deployment | `minInactivityPeriod` | `minContestPeriod` |
| --- | --- | --- |
| Arbitrum Sepolia, `0x6951a65C…` (current) | 300 (5 minutes) | 120 (2 minutes) |
| `Deploy.s.sol` production floor | 30 days | 7 days |

`fetchSwitchLimits()` reads both getters off the live contract rather than hardcoding them, so a
redeployment with different floors needs no client change. **Read the floors; never assume them** —
a period below the floor does not fail at submission, it reverts inside the userOp, which surfaces
as a generic AA failure well after the user pressed the button.

`submitHeartbeat` then hashes via `entryPoint.getUserOpHash` (an `eth_call`, not a local EIP-712
reimplementation — v0.8 changed the hashing and the contract is the only authority worth
trusting for it), signs, sends, and polls for the receipt.

`simulateHandleOps` is the free pre-flight: an `eth_call` of `handleOps` against the live
deployment. A wrong key reverts, so a clean result is discriminating rather than vacuous.

## Gas limits are measured, never constants

The EntryPoint demands the **declared** limits × `maxFeePerGas` in hand before it runs anything,
and the paymaster prices its spend cap off the same declared figure. A flat declaration is
therefore expensive in both directions.

`measureGasLimits` estimates per operation and applies two different headroom factors, because
the refund rules differ:

- **`verificationGasLimit` / `callGasLimit` are refunded when unused** — headroom costs only a
  larger prefund requirement. `EXECUTION_GAS_HEADROOM_PERCENT`, 125.
- **`preVerificationGas` is charged in full as declared** — every unit of headroom is spent.
  `PRE_VERIFICATION_GAS_HEADROOM_PERCENT`, 115.

It also **cannot be hardcoded on Arbitrum**: it embeds the L1 data-availability fee and was
observed between 51,802 and 147,188 for the same operation. A constant tuned to a quiet L1
becomes a rejected operation on a busy one.

Measured on EntryPoint v0.8 and confirmed in production on 2026-08-19, decoded from the
transactions themselves. Declared totals move with the L1 fee because `preVerificationGas` does:

| Operation | declared gas | actually billed | sponsored cost |
| --- | --- | --- | --- |
| deploy + `configure()` | 526,123 | 320,026 | 0.0000384 ETH |
| `checkIn()` | 192,821 | 126,967 | 0.0000153 ETH |

Billed is below declared because verification and call gas are refunded when unused, while the
declared `preVerificationGas` is charged whole. Under the old flat 3,300,000 declaration the same
deploy was billed 654,529.

## Sponsorship is an optimisation, and self-payment is a safety requirement

`requestSponsorship` runs the ERC-7677 `pm_getPaymasterStubData` → `pm_getPaymasterData`
exchange when a paymaster URL is configured. **When it is absent, declines, or errors, the plan
falls back to self-payment rather than failing** — and `HeartbeatPlan.payer` carries which one
happened so the UI can say so. That fallback is limitation **L7**: if sponsorship stops and the
account holds no ETH, the user cannot check in and the switch fires on a living owner.

An account that cannot cover the prefund raises `InsufficientPrefundError`, which carries
`requiredWei`, `balanceWei` and `shortfallWei` — the shortfall against the **declared limits**,
never against the operation's actual cost. Funding for the cost fails with `AA21` while holding
several times enough ETH. Whatever the operation does not spend becomes the account's EntryPoint
deposit, withdrawable and spendable on later check-ins.

## Anchoring the vault root

`anchor.ts` submits `ProofRegistry.anchor(uint64 epoch, bytes32 root)` through the same
`planOperation`/`submitOperation` machinery the heartbeat uses — the two differ only in their
calldata. The root itself comes from [`lib/vaultmerkle`](../vaultmerkle/README.md); this module
never computes one.

**An epoch is one UTC day.** `currentEpoch()` is `floor(now / 86400)`, verified against the
deployed registry's own `currentEpoch()` and its `EPOCH_SECONDS` constant.

**A closed epoch is frozen, and the midnight rollover is a normal event, not an error.** An anchor
planned at 23:59:59 and mined after midnight lands in an epoch that may already hold a root, and
the registry reverts with `EpochAlreadyAnchored`. `anchorVaultRoot` catches that, re-plans at the
now-current epoch and resubmits once.

**That error is matched by selector, `0xab455a25`, not by name.** A bundler returns raw revert
data rather than a decoded string, so name-matching alone would miss the rollover and surface it
to the user as a failure. Tests assert `AA24` and `EmptyRoot` are *not* swallowed by the retry.

`fetchLatestRoot` returns `undefined` rather than a zero root for an account that has never
anchored, so "never protected" and "protected with an empty root" cannot be confused — the latter
is impossible anyway, since `anchor` reverts on `bytes32(0)`.

## Configuration

All optional; the defaults reach Arbitrum Sepolia through public endpoints.

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CHAIN_RPC_URL` | Arbitrum Sepolia public RPC | read-only calls, no API key involved |
| `NEXT_PUBLIC_BUNDLER_URL` | `/api/aa` | override only to bypass the proxy |
| `NEXT_PUBLIC_PAYMASTER_URL` | `/api/aa` when a policy id is set, else *unset* | unset means **every heartbeat is self-paid** |
| `NEXT_PUBLIC_SPONSORSHIP_ENABLED` | *unset* | `true` turns sponsorship on. The policy **id** is server-side (`SPONSORSHIP_POLICY_ID`) and pinned by the proxy — the client never names a policy. |

**Bundler and paymaster calls go through `/api/aa`, not straight to Pimlico.** The API key lives in
the server-only `PIMLICO_API_KEY` and never reaches the bundle; see
[`../aa-proxy/README.md`](../aa-proxy/README.md). `getBundlerUrl()` and `getPaymasterUrl()` return a
**relative path**, which is why every chain call must originate in the browser — there is no host to
resolve it against during SSR.

Setting `NEXT_PUBLIC_PAYMASTER_URL` or `NEXT_PUBLIC_BUNDLER_URL` to a full Pimlico URL still works
and bypasses the proxy, which puts the key back in the bundle. Do that only against a throwaway
key.

**Do not run against the public bundler.** It is rate limited, and it does not fail cleanly when
it is: it answers `eth_estimateUserOperationGas` with **`verificationGasLimit: 0`**. Declaring that
produces an operation whose account validation runs out of gas instantly, which surfaces as
`AA23 reverted` with empty revert data — a failure that reads like a broken signature and is
intermittent, so it looks like flakiness rather than configuration. `getBundlerUrl()` therefore
defaults to the paymaster URL when one is configured, since Pimlico's authenticated endpoint serves
both bundler and paymaster methods.

`measureGasLimits` refuses an estimate below `MIN_VERIFICATION_GAS_LIMIT` / `MIN_CALL_GAS_LIMIT` /
`MIN_PRE_VERIFICATION_GAS` with `ImplausibleGasEstimateError` rather than substituting the probe
ceiling. Falling back to the ceiling was the first fix and it was wrong: a 2,000,000 declaration is
priced by the paymaster, blows past a sane policy cap, and turns a retryable estimate glitch into a
refused sponsorship. Failing loudly lets the caller retry against a working endpoint.

**An earlier revision of this file claimed the key is public in the bundle "by construction" and is
"a spend authorisation, not a secret". That was only half right, and it no longer describes the
code.** It holds for paymaster methods, which the sponsorship policy bounds. It does not hold for
the same key's bundler methods and account APIs, which no policy governs — and `getBundlerUrl()`
routes bundler traffic to the authenticated endpoint precisely because the public one is unusable,
so the exposed key necessarily carried both. The key is now server-side behind `/api/aa`.

Scoping the policy to this factory and these targets is still required. The proxy protects the key;
only the policy caps the spend.

## Tests

`address.test.ts`, `calldata.test.ts` and `userop.test.ts` are offline and run in CI. Every
encoding is compared against `cast`/foundry output or against a value the live chain returned.

`live.test.ts` talks to Arbitrum Sepolia and is **skipped unless** `CRYPLE_LIVE_CHAIN_TESTS=1`
and `CRYPLE_LIVE_OWNER_P256_KEY` are set. It plans a sponsored operation, signs it, simulates
`handleOps` against the live deployment, and asserts a foreign key is rejected. It never
broadcasts.
