# `lib/recovery` — the REK and its Shamir shares

Generates the Recovery Encryption Key, seals the seed phrase under it, and splits the REK
k-of-n so guardians can help the owner back in.

Task 15 of [tasks.md](../../../tasks.md). Shaped by
[recovery-flow.md](../../../../api-general/.docs/recovery-flow.md).

## What is split, and what is not

**The seed phrase is never split.** Cryple generates a random REK, AES-256-GCM-encrypts the
seed phrase under it, and Shamir-splits **the REK**:

```
seed phrase ──AES-256-GCM(REK)──→ encrypted_seed   (stored server-side, opaque)
REK ──────────Shamir k-of-n─────→ shares            (share 0 = user, 1..n-1 = guardians)
```

The server holds `encrypted_seed` and the wrapped guardian shares, and can reconstruct
neither — it holds no guardian's private key.

The REK is **random, not derived from the seed**. That is what keeps this milestone
independent of the unresolved KEK ([Task 12](../secrets/README.md)).

## n = guardians + 1

**Share 0 is the user's own Recovery Kit copy and always counts as one share**, so a setup
with two guardians is `n = 3`. `shareCountForGuardians` encodes that; `USER_SHARE_INDEX` is
`0`.

Default and recommended: **2-of-3** — the user plus either of two guardians.

`shareIndex` is Cryple's ordinal (0…n-1), used by the `recovery-setup` digest, which sorts by
it. It is **not** the Shamir x-coordinate — that is a random non-zero byte living inside the
share blob. Do not conflate them.

### Quorum is `min(configured, active guardians)`

`effectiveQuorum` computes it. A forced or accidental extra guardian **raises the owner's bar
without adding a participant**, so surface the guardian count and the effective quorum
together.

## The threshold rule, and the k=1 warning

The API's only rule is `1 ≤ k ≤ n`; `validateSplitConfig` enforces exactly that and nothing
more. There is no tier or plan gating — the Free/Premium split in `recovery-flow.md` is
product-plan copy, not API behaviour.

**`requiresSoleGuardianWarning` flags `k = 1` with more than one share.** That configuration
means any single guardian can reconstruct the seed alone, and the setup UI must say so:

> *"This person can recover your vault on their own. Only choose someone you fully trust."*

That is a safety requirement, not a tier restriction.

Note that even colluding guardians cannot open a **Paranoid Mode** vault: they reconstruct the
seed but still need the PIN to obtain a JWT.

## The SSS library, and the k=1 wrapper

Pinned: **[`shamir-secret-sharing`](https://github.com/privy-io/shamir-secret-sharing)**
(Privy) — independently audited, zero dependencies, TypeScript-native, GF(256), Apache-2.0.

**The share format is a durable protocol constant.** Once shares are distributed to guardians,
changing it strands them. The format is Hashicorp Vault's:

```
share = secret_bytes ‖ x_coordinate(1 byte)      // 32-byte REK → 33-byte share
```

The x-coordinate is the **last** byte, a random non-zero value, distinct per share.

### Why there is a wrapper at all

The library rejects `threshold < 2` on **both** `split` and `combine`, but Cryple's API allows
`k = 1`. `splitSecret` therefore handles that one case directly.

This is not a divergent format. **Shamir at threshold 1 is a degree-0 polynomial**, so
`p(x) = secret` for every `x` — each share carries the secret verbatim with an x byte appended,
which is byte-for-byte what the library would emit if its assertion were removed. `combineSecret`
with a single share strips the x byte, which is the same degree-0 interpolation.

Everything at `k ≥ 2` goes straight to the library. The wrapper is ~15 lines and touches no
field arithmetic.

## Reconstructing below the threshold fails safely

Combining fewer shares than `k` returns a **wrong REK rather than an error** — that is Shamir
working as designed, not a bug. The failure surfaces one step later, when AES-GCM
authentication rejects `encrypted_seed`. A test pins this: a 2-of-3-share combine on a 3-of-3
split produces a REK that then fails to decrypt.

So the loud failure is at seed decryption, never a silently wrong seed phrase.

## `encrypted_seed` uses the shared sealed-blob envelope

```
encrypted_seed = base64( 0x01 ‖ iv(12) ‖ AES-256-GCM(rek, iv, utf8(mnemonic)) ‖ tag )
```

That envelope lives in [`lib/sealed`](../sealed/README.md) and is shared with the item
`ciphertext`. ⚠️ **The layout is provisional** — `recovery-flow.md` names AES-GCM but never
says where the IV sits, and the blob is written by one device and read by another during
recovery. It is also committed to the `recovery-setup` signature digest.

See [proposals/opaque-blob-layouts.md](../../../proposals/opaque-blob-layouts.md); it needs
backend ratification alongside the KEK.

`encryptSeedPhrase` validates the mnemonic checksum before sealing, so a typo cannot be
committed to a recovery vault that then restores a wrong-but-valid account.

## API

```ts
const { encryptedSeed, shares } = await buildRecoveryVault(mnemonic, { shares: 3, threshold: 2 });
const phrase = await recoverSeedPhrase(encryptedSeed, [shares[0].bytes, shares[2].bytes]);
```

Lower level: `generateRek`, `encryptSeedPhrase` / `decryptSeedPhrase`, `splitSecret` /
`combineSecret`, `validateSplitConfig`, `requiresSoleGuardianWarning`, `effectiveQuorum`,
`shareCountForGuardians`.

The REK is zeroed in a `finally` on every path in both `buildRecoveryVault` and
`recoverSeedPhrase`.

## What is not here

Wrapping shares **to guardians** is PQXDH `usage=recovery-share` and lives in
[`lib/pqxdh`](../pqxdh/README.md). Submitting the vault (`PUT /recovery/setup`, its digest, and
guardian management) is Tasks 16–17.

## Tests

`recovery.test.ts` exhausts **every** k-subset for 2-of-3 and 3-of-5 rather than sampling one,
checks share layout and distinct x-coordinates, pins the k=1 degenerate path against the
ordinary one, asserts a sub-threshold combine fails at seed decryption rather than silently,
and confirms two vaults built from the same phrase never match.
