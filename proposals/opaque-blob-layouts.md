# Proposal: the three unspecified opaque-blob byte contracts

**Status: PROPOSAL. Nothing here is decided, and none of it is implemented as spec in the
client.** Written from `web-app` because that is where the gaps surfaced during integration;
the decision and the resulting spec text belong in **`api-general`**, in
[`.docs/crypto/ECDSA.md`](../../api-general/.docs/crypto/ECDSA.md), with regenerated vectors.

> **The labels and constructions below are the backend spec's to choose, never this client's.**
> `storage-plan.md` §3.1.1 says it directly: *"do not invent a KEK path here — if the vault
> needs a dedicated wrapping key, its derivation belongs in that spec, with test vectors."*
> This document exists so the decision is a review of a concrete option rather than a blank
> page. Reject the names freely; the shape is the part worth arguing about.

## The problem

Three fields cross the wire as opaque base64 blobs. For each, the *algorithm* is specified and
the *byte layout* is not:

| Field | Endpoint | Spec says | Unspecified |
| --- | --- | --- | --- |
| `wrapped_dek` | `POST /secrets` | "Opaque. Must be non-empty." | **The wrapping key itself**, and the blob layout |
| `ciphertext` | `POST /secrets` | "base64 AES-256-GCM blob produced client-side" | Where the 12-byte IV sits |
| `encrypted_seed` | `PUT /recovery/setup` | "AES-GCM encrypted seed phrase" (`recovery-flow.md:477`) | Where the 12-byte IV sits |

**All three fail the same way: silently, per item, and late.**

- The server treats every one of them as opaque, so nothing server-side ever catches a
  divergent client. There is no error to observe.
- `wrapped_dek` and `ciphertext` surface at **inheritance release** — an heir's client
  unwraps the DEK via PQXDH `succession-dek` and then cannot parse the item. Years later.
- `encrypted_seed` surfaces at **recovery** — a user with a valid guardian quorum reconstructs
  the REK correctly and still cannot decrypt their seed. It is also committed to the
  `recovery-setup` signature digest, so the exact bytes are already signed.

None of these is internal to one client. `front-end-guide.md` §2 states the API is consumed by
a mobile app as well, and `encrypted_seed` is written by one device and read by a *different*
one by construction.

## A fourth gap, found building Task 18 — `recovery-session`

Different in kind from the three above (it is a *missing field*, not just a missing layout), but
the same silent-failure shape, so it is recorded here rather than separately.

`pqxdh.md` lists `recovery-session` as a PQXDH usage whose recipient key source is the session's
`ephemeral_public_key`. Two things make it unimplementable as specified:

1. **One field, two keys.** `POST /recovery/request` takes a single opaque
   `ephemeral_public_key`, but PQXDH needs an X25519 (32 B) **and** an ML-KEM-768 (1184 B)
   recipient key. No packing is defined, and `service.go:401` only checks the field is
   non-empty — so the guardian's device and the recovering device must agree on an encoding
   that nothing validates.

2. **The recovering device cannot build `info`.** It needs
   `"Cryple-PQXDH-v1|recovery-session|{sender}|{recipient}"`, but
   `GET /recovery/session/{id}` returns only `{re_encrypted_share, submitted_at}`
   (`listSessionShares` in `repository/statements.go:228`). It learns neither the submitting
   guardian's `user_address` (sender) nor its own account's `user_address` (recipient, per
   `pqxdh.md`) — and it cannot derive its own, because that needs the seed being recovered.
   There is no username → address lookup.

**Possible resolutions, all the backend's call:**

- Define the packing (e.g. a length-prefixed concatenation, or two fields
  `ephemeral_x25519_public` / `ephemeral_mlkem_public` — a small, additive schema change), **and**
- Either return the guardian's `user_address` alongside each collected share, or define
  `recovery-session` to use fixed sentinel values in the `info` string instead of real addresses
  — the ephemeral key is already single-use and session-bound, so the addresses may be
  contributing less binding here than they do for `succession-dek`.

Until then `src/lib/recovery/session-crypto.ts` throws
`RecoverySessionCryptoUnspecifiedError`; everything around it (request, poll, vault fetch,
SSS reconstruction, seed decryption) is built and tested behind that seam.

## What is already settled, and is not in question

- The **frozen key tree** derives exactly four things and no symmetric key. This proposal adds
  a fifth leaf; it changes nothing existing.
- **PQXDH is frozen and has vectors.** Its blob layout
  (`0x01 ‖ kem_ct ‖ eph_pub ‖ iv ‖ ct+tag`) is settled and is *not* what this proposes to
  reuse — that envelope carries key-agreement material this case does not have.
- `user_address`, P-256, X25519, ML-KEM, `Server_Auth_Token` — all unaffected. **No existing
  account, key or blob changes if this lands.** That is the main argument for landing it now.

## Proposal, in one sentence

Specify **one** symmetric sealed-blob envelope, use it for all three fields, and add **one**
HKDF leaf to the key tree to produce the vault KEK.

### 1. The envelope — "Cryple sealed blob v1"

```
sealed(key, plaintext) = base64( 0x01 ‖ iv(12) ‖ AES-256-GCM(key, iv, plaintext) ‖ tag(16) )
```

- `0x01` — version byte. A reader **MUST reject an unknown version** rather than guessing.
- `iv` — 12 random bytes, fresh per encryption, never reused with the same key.
- Tag is 128-bit, appended by GCM (so a 32-byte payload seals to 61 bytes → 84 base64 chars).
- **No AAD**, matching PQXDH: there is no second party to bind context with, and the key is
  already single-purpose.

One envelope, three uses:

| Field | Key | Plaintext |
| --- | --- | --- |
| `wrapped_dek` | vault KEK (below) | the 32-byte item DEK |
| `ciphertext` | that item's DEK | the item payload |
| `encrypted_seed` | the REK (random, already specified) | UTF-8 of the mnemonic |

The version byte is the load-bearing part. Even if the layout below is rejected, **please keep
a leading version byte in whatever replaces it** — it is the difference between a future change
being detectable and being a silent misparse.

### 2. The vault KEK — the new leaf

```
kek = HKDF-SHA512(ikm = seed, salt = ∅, info = "Cryple-Key-v1|vault-kek", L = 32)
```

Rationale for the shape, not the name:

- **HKDF-SHA512 with an empty salt**, identical in form to the X25519 and ML-KEM leaves — one
  derivation idiom in the tree, not two.
- **L = 32** is exactly an AES-256 key. No expansion step for a client to invent.
- **A leaf, not an HD node.** SLIP-0010 defines nothing useful for a symmetric key, and the
  existing precedent for "not a P-256 key" in this tree is already HKDF.

`vault-kek` is a placeholder. `secrets`, `item-kek`, `vault` are equally reasonable —
**pick one and freeze it.** The only real constraint is that it must not collide with
`x25519` or `mlkem768`.

Security note: this KEK is used *only* to wrap DEKs, never to encrypt payload directly, which
is what `storage-plan.md` §3.1.1 already stipulates.

## Proposed diff to `crypto/ECDSA.md`

Add to the tree diagram:

```
└─ HKDF-SHA512(seed, salt=∅, info="Cryple-Key-v1|vault-kek", L=32)  ─→ vault KEK (AES-256)
```

Then a **Step 5** section after Step 4, stating the derivation above, and a short
**Sealed Blob Format** section stating the envelope. Both are a paragraph each.

## Proposed patch to `tools/cryplevectors/main.go`

The generator already does this exact thing twice, so the patch is mechanical.

**Constants** (beside `labelMLKEM`, ~line 50):

```go
labelVaultKEK = "Cryple-Key-v1|vault-kek"
```

**Derivation** (beside the ML-KEM block, ~line 194):

```go
// ---- Vault KEK (HKDF domain separation) ------------------------------
kek, err := hkdf.Key(sha512.New, seed, nil, labelVaultKEK, 32)
if err != nil {
    return nil, fmt.Errorf("vault kek hkdf: %w", err)
}
```

**Struct** — a new section rather than reusing `keyVec`, since there is no public half:

```go
type sealedVec struct {
    Derivation string `json:"derivation"`
    Label      string `json:"hkdf_info_label"`
    KEKHex     string `json:"vault_kek_hex"`
    Envelope   string `json:"envelope"`
    IVHex      string `json:"iv_hex"`
    PlaintextHex string `json:"plaintext_hex"`
    BlobBase64 string `json:"sealed_blob_base64"`
}
```

## The vectors this needs

1. **`vault_kek_hex`** — deterministic from the all-`abandon` seed, exactly like the other two
   leaves.
2. **A sealed-blob example** — a fixed key, a fixed IV and a fixed plaintext, with the recorded
   blob.

Point 2 has a property PQXDH's vector does not: **AES-GCM with a fixed key and IV is fully
deterministic**, so a client can reproduce *both* directions. The PQXDH vector can only be
tested by unwrapping the recorded blob, because ML-KEM encapsulation randomness cannot be
fixed through the Go standard library. This one pins wrap and unwrap.

Use a fixed IV **in the vector only**; production always uses a fresh random one.

## What happens in `web-app` once this lands

Roughly an hour, no call sites change — this is what the seam bought:

1. Implement `DekWrapper` in `src/lib/secrets/dek.ts`; make it the default in place of
   `unspecifiedDekWrapper`.
2. Reconcile `src/lib/secrets/codec.ts` with the ratified envelope. It currently ships a
   **provisional** `0x01 ‖ iv(12) ‖ ct+tag` — the same shape proposed here, so if this is
   accepted as written, the change is deleting a comment.
3. Refresh `src/test/fixtures/test-vectors.json`, add KEK + sealed-blob assertions.
4. Delete `fakeDekWrapperForTestsOnly` from `secrets.test.ts`; the existing round-trip tests
   then run against the real wrapper.
5. Tick Task 13.

Task 15/16 (`encrypted_seed`) then uses the same envelope instead of a second provisional one.

## Why now rather than after the MVP

`ECDSA.md` is FROZEN, and this **adds** to it rather than changing anything — free today,
expensive later. Two constraints make "later" much worse:

- **`crypto/key-continuity.md` and backend Task 63**: keys are immutable and there is no
  rotation protocol. After the first real user, changing the key tree needs a signed rotation
  flow that does not exist.
- **Nothing currently tracks this.** Backend Task 59 records that `storage-plan.md` *deferred*
  its KEK derivation to `ECDSA.md`; the deferral landed and the derivation never did. Task 63
  is encryption-key rotation — related, post-MVP, and a different concern. There is no open
  item anywhere that says "write the KEK paragraph", which is why it has stayed invisible.

## Open questions for whoever takes this

1. **The label string.** `vault-kek`, or something else?
2. **One envelope for all three, or three separate specs?** One is fewer things to get wrong
   and gives a single vector; three allows them to diverge later without a version bump.
3. **Should `encrypted_seed` be in `ECDSA.md` or `recovery-flow.md`?** It is a recovery
   concern, but co-locating all three envelopes keeps the byte layouts in one place.
4. **Does the file vault (postponed) want the same envelope?** If so, the version byte should
   be specified as shared across both rather than per-field.
