# `lib/vaultmerkle` — the tree an heir verifies against

Computes the SHA-256 Merkle root over every inheritable item in the vault, and the inclusion
proof for any one of them. [Task 51a](../../../tasks.md) anchors the root this produces;
Task 54 verifies against it in the heir's browser.

Implements [`crypto/vault-leaf.md`](../../../../api-general/.docs/crypto/vault-leaf.md), settled
by Task 69. Reference implementation is Go: `api-general/internal/vaultmerkle`. Cross-client
vectors are `vault_merkle` in [test-vectors.json](../../test/fixtures/test-vectors.json), and
**if this module disagrees with those vectors, this module is wrong** — every rule below is
pinned against them in `vaultmerkle.test.ts`.

## The one rule the design serves

> The registry exists to distrust the server. Any leaf the server computes is worthless as a leaf.

`ciphertext_sha256` from `GET /secrets?fields=meta` and `GET /notes` is **advisory only** — it
renders an index and detects change. It is never leaf input. If a client anchored a
server-supplied hash, a compromised backend could serve tampered ciphertext with a matching hash
and the heir's verification would pass.

## The leaf

```
contentHash = SHA-256(blob bytes exactly as the API served them)
preimage    = "cryple.vault.leaf.v1" | itemType | itemID | hex(contentHash)
leaf        = SHA-256(UTF-8 preimage)
```

**The blob is the base64 text, hashed as UTF-8 — never base64-decoded first.** This matches what
Postgres computes for the advisory column, so the two can be compared for drift. One altered byte
makes an heir's verification fail, so no re-encoding, trimming or normalization is permitted
anywhere in the pipeline.

**The leaf binds the type and the id, not just the bytes.** Without that binding a proof for a
secret could be replayed as a proof for a note holding identical ciphertext, and the heir would
verify the wrong item as the right one. A test asserts the two leaves differ for identical blobs.

| Type | Blob |
| --- | --- |
| `secret` | `ciphertext` from `GET /secrets` (unpaginated, full ciphertext, by design) |
| `note` | `ciphertext` from `GET /notes/{id}`, fetched per note |
| `document` | `snapshot_ciphertext` from `GET /documents/{id}` |

## The tree

RFC 6962, SHA-256 throughout. Proofs are verified only in the browser, so there is no gas reason
to prefer keccak256, and one hash function across leaves, nodes and content removes a class of
client bugs.

```
MTH([leaf]) = leaf
MTH(L)      = SHA-256(0x01 || MTH(L[:k]) || MTH(L[k:]))   k = largest power of two < len(L)
```

Leaves sort **ascending by `(itemType, itemID)` as byte strings** — `document` < `note` <
`secret` falls out of that rather than being a separate rule. The owner and the heir enumerate
the vault independently, from different endpoints at different times, so the root must not depend
on the order any listing happened to return. A test builds the same root from a shuffled input.

Two details that are easy to get wrong and are pinned by tests:

- **RFC 6962's split rule, not "duplicate the last node when odd."** The common alternative
  admits distinct trees with equal roots.
- **The `0x01` node prefix over raw 32-byte halves** makes an internal-node preimage binary,
  while a leaf preimage is printable ASCII beginning `cryple.`. The two spaces cannot collide,
  so a leaf can never be presented as an internal node.

## Deliberate refusals

Each of these throws rather than silently producing a plausible root:

| Condition | Error | Why |
| --- | --- | --- |
| empty blob | `EmptyBlobError` | hashing the empty string mints a valid-looking leaf committing to nothing; exclusion must be the caller's deliberate act |
| empty vault | `EmptyTreeError` | there is no root at all, and `ProofRegistry.anchor` reverts on `bytes32(0)` |
| repeated `(type, id)` | `DuplicateItemError` | a duplicate is a bug in enumeration, not a second leaf |
| unknown type | `UnknownItemTypeError` | the closed set is part of the preimage |

## What lives elsewhere

Deciding *which* items belong in the tree is [`lib/app/anchoring.ts`](../app/anchoring.ts) —
document compaction state, leaf caching, and which notes still need fetching. Submitting the root
is [`lib/chain/anchor.ts`](../chain/anchor.ts). This module is pure computation over items it is
handed, and reaches no network.
