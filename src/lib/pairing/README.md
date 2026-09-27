# `lib/pairing` — linking the browser extension

The web app's half of linking the Cryple password extension with a temporary code, and the two pieces
the extension shares with it. Design: [password-manager/software-design-document.md § 5](../../../../password-manager/software-design-document.md#5-linking-the-extension-with-a-temporary-code);
server: [`pairing` domain](../../../../api-general/internal/domain/pairing/README.md).

| File | What | Used by |
| --- | --- | --- |
| `fingerprint.ts` | `pairingFingerprint`, the `Cryple-Pairing-v1` construction; reading and formatting a code | the web app **and** the extension |
| `api.ts` | Open, read, complete and cancel a pairing (JWT); claim it and read a claim's status (public) | the web app **and** the extension |
| `link.ts` | `claimedDevice`, `ownerFingerprint`, `linkClaimedDevice` | the web app only — it imports `lib/account`, which the extension's build refuses |

## Linking

1. `openPairing` → a code the screen shows for five minutes.
2. `getPairing` until `claimed`; `claimedDevice` validates the three keys.
3. `ownerFingerprint` computes the number from **this account's** address and root key and the
   claimed keys. The user compares it with the extension's.
4. On a match, `linkClaimedDevice` reads and verifies this account's chain, builds a `device-add`
   with scopes `passwords` and a wrap of **every** `passwords` generation this session holds
   (`buildDeviceLink`), applies it, and calls `complete`. No rotation happens, so the recovery phrase
   is not needed.
5. On a mismatch the screen cancels the pairing and says why, with no retry on the same code.

## The fingerprint

`SHA-256("Cryple-Pairing-v1|" + code + "|" + user_address + "|" + root_public_key + "|" + device_id +
"|" + signing_public_key + "|" + x25519_public_key + "|" + mlkem_public_key)`, first four bytes
big-endian mod 10⁶, six digits. The code is its normalised 8 characters. `fingerprint.test.ts`
reproduces `device_keys.pairing_fingerprint` from `test-vectors.json`, which `api-general`'s
`tools/cryplevectors` generates.

## Codes as people type them

`normalisePairingCode` upper-cases, drops dashes and spaces, reads `I` and `L` as `1` and `O` as `0`,
and refuses anything outside Crockford base32 or not 8 characters long — the same rule as the server.
