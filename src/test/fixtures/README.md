# Test fixtures

## `test-vectors.json`

A **verbatim copy** of
[`../api-general/.docs/crypto/test-vectors.json`](../../../../api-general/.docs/crypto/test-vectors.json).

This client only ever *reads* this file. Regenerating it is a backend operation
(`go run ./tools/cryplevectors` in `../api-general`) and is idempotent — **if its output
differs from the committed file, a protocol constant changed.** That is a breaking change to
every user's keys, not a fix.

Never edit this file to make a test pass. If a value here disagrees with this client's
output, this client is wrong.

### Why it matters more here than in the backend

No Go test consumes these vectors — the generator produces the file and nothing re-reads it.
**This client's fixture test is therefore the only cross-client check of the derivations
that exists anywhere**, which is why Task 3 gates every other milestone.

### What it covers

For the well-known all-`abandon` BIP39 mnemonic (test values only — never a real account):

| Section | Consumed by |
| --- | --- |
| `seed_and_user_address` | [`lib/keys`](../../lib/keys/README.md) |
| `identity_key_p256` | [`lib/keys`](../../lib/keys/README.md), [`lib/encoding`](../../lib/encoding/README.md) |
| `x25519_key`, `mlkem768_key` | [`lib/keys`](../../lib/keys/README.md) |
| `vault_kek`, `sealed_blob` | [`lib/keys`](../../lib/keys/README.md), [`lib/secrets`](../../lib/secrets/README.md) |
| `heir_label_key`, `sealed_label_blob` | [`lib/keys`](../../lib/keys/README.md), [`lib/app` § The heir label](../../lib/app/README.md#the-heir-label) |
| `server_auth_token` | [`lib/pin`](../../lib/pin/README.md) |
| `pqxdh` | [`lib/pqxdh`](../../lib/pqxdh/README.md) |
| `vault_merkle` | [`lib/vaultmerkle`](../../lib/vaultmerkle/README.md) |

### Refreshing the copy

```bash
cp ../api-general/.docs/crypto/test-vectors.json src/test/fixtures/test-vectors.json
npm test
```

If the suite goes red after a refresh, do not adjust this client until you know which
backend constant moved and why.

**A refresh that only *adds* objects is the good case**, and it is what the last two looked like:
`vault_kek` / `sealed_blob` arrived with Decision A/B, and `heir_label_key` / `sealed_label_blob`
with `crypto/ECDSA.md` § Step 6, each leaving every pre-existing value byte-identical. A refresh
that *changes* an existing value is the breaking one.

**`sealed_label_blob`'s plaintext is deliberately non-ASCII.** It carries `plaintext_utf8` and
`plaintext_hex` side by side so a client that normalizes (NFC/NFKD), transcodes, or seals UTF-16
fails here rather than silently writing blobs its owner's other devices read differently.
