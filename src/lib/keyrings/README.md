# `lib/keyrings` — scope KEKs, wraps and batches

Everything of [device-keys.md § Keyrings and generations](../../../../api-general/docs/crypto/device-keys.md#keyrings-and-generations)
and [§ Batches](../../../../api-general/docs/crypto/device-keys.md#batches--how-state-changes)
this client does.

## `crypto.ts`

| Function                                          | What                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `generateScopeKek`                                | A fresh random 32-byte KEK for one generation of one scope                                                                   |
| `wrapKekForRoot` / `openRootWrap`                 | `sealed(root_wrap_key, KEK)`. The root wrap key is the seed's `Cryple-Key-v1\|vault-kek` leaf                                |
| `wrapKekForDevice` / `openDeviceWrap`             | PQXDH, usage `device-keyring`, recipient slot `user_address/device_id`, so a wrap for one device never opens for another     |
| `generateSharingKeys`, `seal/openSharingMaterial` | A `sharing` generation's X25519 and ML-KEM keys, sealed as `x25519_private(32) ‖ mlkem_seed(64)` under that generation's KEK |
| `deriveShareSubkey`                               | `HKDF-SHA256(connection_key, "Cryple-Share-v1\|<scope>")`                                                                    |

The `device_keys` vectors pin the root wrap, the `device-keyring` info string, the genesis
sharing keys and every share sub-key.

## `batches.ts`

Each builder signs its events, runs the whole batch through `ChainState.applyBatch`, then wraps
every generation it creates **to the root and to exactly the active devices holding that scope**,
and seals the sharing material. The server refuses a batch whose wraps are incomplete
(`INVALID_BATCH`), so the builders compute recipients from the verified chain, never from a list.

| Builder              | Signed by   | Used for                                                                                                       |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `buildGenesis`       | root        | Sign-up: `device-add` (every scope), `sharing-keys` 1, `keyring-rotate` of every keyring to 1                  |
| `buildEnrolment`     | root        | Adding this browser with the phrase, optionally removing devices and rotating what they held in the same batch |
| `buildDeviceRemoval` | this device | Removing another device, with the rotation of every keyring it held and new sharing keys                       |
| `buildRotation`      | this device | Rotating named scopes                                                                                          |
| `buildSelfRemoval`   | this device | "Remove this browser": a self `device-remove`, which needs no rotation                                         |
| `buildDeviceLink`    | this device | Linking another device, such as the browser extension: one `device-add` and a wrap of every generation of each scope it is granted, from the keys this session holds. No rotation, so no root |

**Every rotation needs the root wrap key**, because each new generation is also wrapped to the
root, so the seed alone can always reopen the keyring. A device does not hold that key, so
removing another device asks for the recovery phrase (`lib/account` → `removeOtherDevices`) and
derives it for that one batch.

## `api.ts` and `items.ts`

- `fetchKeyrings`, `openDeviceKeyrings`, `openRootKeyrings`, `refreshKeyrings`, `loadKeyrings`,
  `postOwnWraps`, `fetchChain`, `listDevices`, `applyDeviceBatch`.
- A `wrapped_key: null` for a generation of a held scope is a bug to report, and surfaces as
  `MissingGenerationError`, never as a silent failure.
- `scopeDekWrapper(context, scope)` wraps an item DEK under the scope's **current** KEK and
  returns `{ wrapped_dek, key_generation }`. It unwraps by the row's `key_generation`, re-reading
  the keyrings once if that generation is not held yet.
- `withCurrentGeneration(context, attempt)` runs a write, and on `409 STALE_KEY_GENERATION`
  re-reads `GET /keyrings` and runs it **once** more. A second refusal is surfaced, never looped.
  Callers re-wrap inside `attempt`, so the retry carries the new generation.
