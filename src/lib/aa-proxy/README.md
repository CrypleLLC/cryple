# `aa-proxy` — server-side relay for Pimlico bundler and paymaster calls

`src/lib/chain` speaks JSON-RPC to a bundler and a paymaster. Both are Pimlico endpoints
authenticated by an API key in the URL query string. This module is the request-validation half of
the route handler at `src/app/api/aa/route.ts` that holds that key server-side.

## Why the key cannot be a `NEXT_PUBLIC_` variable

Pimlico issues one class of API key. There is no publishable/secret split of the kind Stripe or
Firebase have, so a key placed in a `NEXT_PUBLIC_` variable is inlined into the client bundle and
readable by anyone who loads the app.

Pimlico's own guidance lists four protections — key restrictions by IP, user agent and origin;
per-key feature toggles for bundler, paymaster and account methods; sponsorship policies; and a
proxy server. Only the last removes the key from the bundle. The first is not a boundary for a
browser client: `Origin` is spoofable outside a browser and IP restriction is meaningless when the
caller *is* the public.

## What the proxy does and does not defend

It defends the **key**. It does not defend the **spend** — that is the sponsorship policy's job, and
the policy remains the real ceiling on abuse. Scope it to `FACTORY_ADDRESS`,
`DEAD_MAN_SWITCH_ADDRESS` and `PROOF_REGISTRY_ADDRESS` from `src/lib/chain/config.ts`, with per-user
and global caps, exactly as if the key were still public.

There is deliberately **no caller authentication**. Gating on the Cryple JWT would make
`src/lib/chain` — today dependent only on `@/lib/encoding` — depend on the auth layer, and the API
has no token-introspection endpoint to check one against (`POST /auth/verify` is an alias for
`/sign-in`, not a validator). The method allowlist plus the sponsorship policy carry that weight
instead.

## The allowlist

`allowlist.ts` names the five methods `src/lib/chain` actually calls:

| Method | Called from |
| --- | --- |
| `eth_estimateUserOperationGas` | `userop.ts` `measureGasLimits` |
| `eth_sendUserOperation` | `userop.ts` `sendUserOperation` |
| `eth_getUserOperationReceipt` | `userop.ts` `getUserOperationReceipt` |
| `pm_getPaymasterStubData` | `userop.ts` `requestSponsorship` |
| `pm_getPaymasterData` | `userop.ts` `requestSponsorship` |

Everything else is refused with `-32601`, including Pimlico's account APIs. Node reads —
`eth_call`, `eth_getCode`, `eth_getBalance` — are **not** in the list and must not be added: they go
to the public Arbitrum RPC through `getRpcUrl()` and never touch the key.

**Batch requests are refused** rather than filtered. A JSON-RPC array would otherwise let one
accepted method carry a denied one alongside it, and `src/lib/chain` never batches.

## Responses

Client-side rejections come back as **HTTP 200 with a JSON-RPC `error` member**, because
`jsonRpc()` in `src/lib/chain/rpc.ts` turns any non-`ok` status into `ChainUnreachableError` and
only reads `body.error` on a 200. Returning 400 would erase the reason. The two exceptions are
deliberate: `413` for an oversized body and `429` for rate limiting, where the transport-level
status is the useful signal and `Retry-After` is meaningful.

Upstream status and body are otherwise passed through verbatim. The URL is never echoed in any
error, because it contains the key.

The rule for which failures keep a non-200 status: **non-200 is reserved for conditions the caller
should back off from and retry** — `429` rate limited, `413` oversized, `502` upstream unreachable.
`ChainUnreachableError` is the right client outcome for all three.

**Upstream `401` and `403` are deliberately *not* in that set.** They are permanent configuration
errors, and a bad key surfacing as `ChainUnreachableError: HTTP 401` reads as "the chain is down"
and invites a retry that can never succeed. `describeUpstreamRejection` maps them to `-32002` at
HTTP 200 so `jsonRpc()` raises a `JsonRpcError` carrying the reason. Pimlico's own auth failure body
is REST-shaped (`{"statusCode":401,"error":"Unauthorized",…}`), not JSON-RPC, so passing it through
would strand the client with no `error` member to read either way.

The split between the two codes reflects the two ways a key fails: `401` observed for a revoked or
invalid key, `403` reserved for a key that is valid but lacks the method — which is what the
dashboard's bundler / paymaster / account-API toggles control. Only the `401` mapping has been seen
against the live endpoint; the `403` branch is a defensive guess at Pimlico's shape for a disabled
method.

## Sponsorship policy pinning

`context.ts` rewrites the context argument of `pm_getPaymasterStubData` and `pm_getPaymasterData` so
the **policy is chosen by the server, never by the caller**. A caller-supplied
`sponsorshipPolicyId` is overwritten when `SPONSORSHIP_POLICY_ID` is set, and stripped when it is
not. Other context fields the caller sent are preserved, and the userOp, entry point and chain id
are passed through untouched.

The policy id is **not a secret** — knowing `sp_…` grants nothing without a working key. It moved
server-side because it is an *authorization* parameter: it names which spending rule applies. While
the client chose it, anyone reaching this route could name any policy on the account. With one
scoped policy that changes little; the moment a second, looser policy exists — a dev or staging one
with high caps is the usual way — an unpinned caller could name that instead and the production
policy would stop being the ceiling.

This is the one place the proxy is not a faithful forwarder. That is deliberate and confined to two
methods; everything else is relayed byte for byte.

Because the client no longer holds the policy id, it can no longer infer whether sponsorship is
configured. `NEXT_PUBLIC_SPONSORSHIP_ENABLED` carries that one bit instead — it is a UI-behaviour
flag, not config, and it decides whether `requestSponsorship()` attempts a wrap or returns
`undefined` and lets the operation self-pay.

## Rate limiting

A fixed 60-second window per client IP, `AA_PROXY_REQUESTS_PER_MINUTE` (default 120). The default is
sized for one heartbeat: `RECEIPT_POLL_ATTEMPTS = 40` polls at `RECEIPT_POLL_INTERVAL_MS = 3000`,
plus estimation and submission, is ~43 requests.

**The counter is per instance and in memory.** On Vercel each serverless instance keeps its own map,
so the effective limit is the configured number multiplied by the number of live instances, and it
resets on cold start. That is a speed bump, not a quota. A real quota needs shared state — Vercel KV
or Upstash — and neither is a dependency today.

## Configuration

| Variable | Scope | Default | Notes |
| --- | --- | --- | --- |
| `PIMLICO_API_KEY` | **server only** | *unset* | Never prefix with `NEXT_PUBLIC_`. Unset means the public endpoint — see the warning in [`../chain/README.md`](../chain/README.md#configuration). |
| `PIMLICO_RPC_URL` | server only | *unset* | Full upstream URL; wins over the key. For a self-hosted bundler. |
| `SPONSORSHIP_POLICY_ID` | **server only** | *unset* | Pinned into every paymaster call. Unset strips the field, which the key's verifying-paymaster toggle then governs. |
| `AA_PROXY_REQUESTS_PER_MINUTE` | server only | `120` | Per IP, per instance. |

`.gitignore` ignores `.env*`, so there is no committed `.env.example`; this table is the reference.

## Tests

`envelope.test.ts`, `context.test.ts`, `upstream.test.ts` and `rate-limit.test.ts` are offline and
run in CI. The route
handler itself is not unit-tested — it is a thin composition of these three, and the suite is
`environment: 'node'` with no HTTP harness installed.
