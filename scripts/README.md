# scripts

Dev-only CLIs, run by hand with `node`. Nothing here ships to a browser, nothing here
receives key material, and `no-console` is off for this directory alone — stdout is the
whole point of a diagnostic. See [AGENTS.md](../AGENTS.md) § Commands.

## which-deployment.mjs

```bash
node scripts/which-deployment.mjs <public_key_spki_base64> [expected_address]
```

Derives the ERC-4337 smart-account address for a P-256 public key under each factory /
implementation pair this project has deployed, and marks the one matching
`expected_address` if you pass it.

Answers "which cohort is this account on" — the question
[api-general Task 71](../../api-general/.docs/tasks/tasks.md#task-71) made answerable by
recording the pair on the user row. `GET /succession/status` now serves
`chain.smart_account_factory` and `chain.smart_account_implementation` from that row, so
once the web-app half of Task 74 lands and `src/lib/chain/config.ts` stops carrying its own
constants, this script is the way to diagnose an `assertSmartAccountMatches` failure rather
than guess at it.

The `PAIRS` table is a hand-maintained record of past deployments. Add a row when you
deploy; the script cannot discover them.
