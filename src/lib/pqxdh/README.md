# `lib/pqxdh` — hybrid wrapping for a specific recipient

The **only** way this client encrypts data for someone else. Two uses in MVP scope and nothing
else: succession DEK wrapping for heirs, and guardian share wrapping for recovery.

Task 14 of [tasks.md](../../../tasks.md). Implements
[crypto/pqxdh.md](../../../../api-general/.docs/crypto/pqxdh.md) — a **FROZEN** spec.

> Changing any constant here is a breaking change requiring a new `version` byte and
> re-wrapping every stored blob. An inheritance blob is designed to stay decryptable for
> **decades** — that is the window this construction is sized for.

## The construction

```
ephemeral   = fresh X25519 key pair, per wrapped payload
ecdhSecret  = X25519(ephemeralPriv, recipientX25519Pub)
kemSecret, kemCiphertext = ML-KEM-768.encapsulate(recipientMlkemPub)

IKM         = 0xFF×32 ‖ ecdhSecret ‖ kemSecret            (96 bytes, order normative)
salt        = 0x00×32
info        = "Cryple-PQXDH-v1|" ‖ usage ‖ "|" ‖ senderUserAddress ‖ "|" ‖ recipientUserAddress
sessionKey  = HKDF-SHA256(IKM, salt, info, L=32)

blob = 0x01 ‖ kemCiphertext(1088) ‖ ephemeralX25519Pub(32) ‖ iv(12) ‖ AES-256-GCM(sessionKey, iv, payload)
```

Base64-encoded for storage. A 32-byte DEK wraps to **1181 bytes → 1576 base64 characters**.

## API

```ts
const blob = await pqxdhWrap(payload, { x25519PublicKey, mlkemPublicKey }, context);
const opened = await pqxdhUnwrap(blob, { x25519PrivateKey, mlkemSecretKey }, context);
```

`context` is `{ usage, senderUserAddress, recipientUserAddress }`. Also exported:
`deriveSessionKey`, `buildInfo`, `parseBlob` (for length/version checks without decrypting).

## Usage labels

| Label | Context | Recipient key source |
| --- | --- | --- |
| `succession-dek` | Wrapping an item DEK for an heir | Beneficiary's `public_key_*_snapshot` |
| `recovery-share` | Wrapping an SSS share of the REK for a guardian | Guardian's registered keys |
| `recovery-session` | Guardian re-wrapping a share to a recovering device | Session `ephemeral_public_key` |

**Never reuse a label for a new purpose** — a new usage gets a new label. The label is what
stops a session key derived for one purpose from being valid in another.

For `recovery-session` the "recipient" is the **recovering account's own `user_address`** — the
ephemeral key belongs to that account's session, not to a third party.

## The constants that must not drift

- **AES-256-GCM, not ChaCha20-Poly1305.** Earlier drafts named both. GCM won because ChaCha is
  absent from WebCrypto, and forcing every browser client to ship a WASM implementation of the
  one primitive protecting the payload is a worse trade than the algorithm difference.
- **No AAD.** Context binding lives entirely in the HKDF `info` string, which is simpler to get
  right across clients than agreeing on an AAD encoding.
- **IKM order is normative** — `0xFF×32 ‖ ecdh ‖ kem`. Swapping the two secrets produces a
  different, silently wrong session key; the test suite pins this.
- **Addresses in `info` are the 64-char lowercase hex strings**, joined literally with `|`.
- **A fresh ephemeral key per payload.** Required, not an optimization: it makes the blob
  **self-contained**, so an heir needs only their own private keys and the blob — no lookup of
  the owner's public key, which matters when the owner's account may be gone.

## Rejecting rather than guessing

`parseBlob` checks the length against the layout **and** the version byte before any
decryption is attempted, per the spec's implementation requirements:

- an unknown version byte throws `UnsupportedPqxdhVersionError` — never a best-effort parse
- a blob shorter than `1 + 1088 + 32 + 12 + 16` throws `MalformedPqxdhBlobError`

Tag comparison is delegated to WebCrypto and never hand-rolled. `ecdhSecret`, `kemSecret`,
`sessionKey` and the ephemeral private key are zeroed in a `finally` on every path, including
the failure paths.

## What this does and does not protect

It protects the confidentiality of the wrapped payload against anyone lacking the recipient's
private keys — including Cryple, and including a future quantum adversary, since breaking it
requires breaking **both** X25519 and ML-KEM.

It does **not** control *when* the recipient obtains the blob. The blob sits on Cryple's
servers from setup time; release timing is enforced elsewhere and is a documented trust
limitation.

It deliberately provides **no forward secrecy** against compromise of the heir's long-term
keys — and must not, since the heir has to decrypt years later.

**Recipient key authenticity is out of scope.** The wrap is only as trustworthy as the public
keys used, and those come from Cryple's database. A malicious backend could substitute its own
keys at setup time. Mitigation is out-of-band fingerprint verification, tracked as a
limitation and not solved here.

## Tests

`pqxdh.test.ts` meets the Task 14 acceptance criteria directly against the fixture:

- reproduces `session_key_hex` from the recorded `ecdh_secret_hex` and `kem_secret_hex`
- **decrypts the recorded `wire_blob_base64`** to `plaintext_dek_hex` — encapsulation
  randomness makes wrapping non-deterministic, so unwrapping the recorded blob is the test
- confirms the parsed blob carries the recorded ephemeral public key, KEM ciphertext and IV
- asserts the session key diverges when usage, either address, or the IKM order changes
- round-trips every usage label, and checks a fresh ephemeral key and IV per wrap
- rejects an unknown version byte, a short blob and a truncated one, and fails authentication
  on a tampered ciphertext
