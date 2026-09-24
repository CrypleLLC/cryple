# `lib/chain` — the account event chain

Builds and verifies the signed, hash-chained statements of
[device-keys.md § The account event chain](../../../../api-general/docs/crypto/device-keys.md#the-account-event-chain).
It is a port of `api-general/internal/domain/devices/chain`, rule for rule. **The client verifies
everything the server returns**, its own chain and every contact's proof path: the server having
checked first is no reason to skip it.

## Statements

```
statement  = "Cryple-Chain-v1|" user_address "|" seq "|" prev "|" type ["|" field …]
signature  = ECDSA-P256(SHA-256(statement)), IEEE P1363, base64
event_hash = hex(SHA-256(statement "|" signer "|" signature))
```

`buildStatement`, `deviceAddFields`, `formatRotations` / `parseRotations`, `eventHash`,
`signStatement` and `batchDigest` (the hex SHA-256 of the statements joined by `\n`, which
`device-enrol` signs) produce exactly these bytes. The `device_keys` vectors pin them.

## `ChainState` — the verifier

- `ChainState.replay(userAddress, rootPublicKey, storedEvents)` rebuilds the devices, the
  generation of each keyring and the announced sharing keys, and **throws `InvalidChainError` on
  the first rule broken**: a wrong sequence or head, an unknown version, another account's
  address, a bad signature, a removed or non-admin signer, a device granting a scope it lacks, a
  narrowing that widens, a rotation that skips a generation, a removal of another device without
  rotating what it lost, and a sharing rotation without its keys. It also checks that each stored
  `event_hash` is the event's own hash.
- `applyBatch(events)` applies a batch this client is about to send, with the server's
  batch-level rules. The batch builders in `lib/keyrings` run it on every batch they build, so a
  batch the server would refuse is refused here first.
- **Replay without batch boundaries.** A stored chain does not record where one batch ended. The
  batch rules are applied to each run of consecutive events by the same signer instead. Every
  batch sits inside one such run, so a chain the server accepted always replays, and a removal
  whose rotation is missing is still refused.

## Proof paths

`verifyProofPath(userAddress, rootPublicKey, sharingKeys, proof)` checks what
`GET /users/{uuid}/public-keys` returns for a contact: the path starts at the root, each step is
a `device-add` of an admin device that signs the next event, every signature and hash verifies,
and the last event is the `sharing-keys` announcement of exactly the published keys. A contact's
trust rests on this path and on their pinned root key (`lib/sharing`), never on the server.

## A pitfall this module guards

**`verifyPayload` accepts high-S signatures.** Go and WebCrypto both produce them and the server
accepts them; noble's P-256 refuses them by default, which would reject valid chains. The vector
chain includes one.
