# `lib/account` — the account flows

The multi-step flows, each composed from the lower modules. Every flow takes `AccountServices`:
the session keystore, the token store and the device record store.

| Flow | What happens |
| --- | --- |
| `draftSignUp` + `completeSignUp` | Derive the root from the phrase, generate this browser's keys, build the genesis (`lib/keyrings`), `POST /sign-up`, verify the chain the server stored, register the device PIN, write the record, open the session, then zero the root. With Paranoid chosen, the same PIN is enabled as the account PIN while the root is still in hand. **A draft survives a failed attempt**, so a retry sends the same genesis and the server answers `200` for the same device instead of refusing a second one |
| `unlockWithPin` | `evaluate` → derive → open the record → `confirm` → sign in with the device key → verify the chain from the root key → open the keyrings. Outcomes: `unlocked` (with `chainProblem` if the chain did not verify), `wrong-pin` with `attemptsRemaining`, `forgotten`, `removed`, `offline`, `rate-limited`, `no-device` |
| `enrolThisBrowser` | The phrase adds this browser: check the account exists (`GET /users/lookup`), read the chain with the root (`POST /devices/enrol/chain`, with the account PIN proof when it is Paranoid), verify it, build a root-signed `device-add`, optionally remove devices and rotate in the same batch ("I lost my devices" removes all of them), `POST /devices/enrol`, open the root's keyrings with the root wrap key, post this device's wraps of every older generation, register the PIN, zero the root. `TooManyDevicesError` carries the device list, so the UI can let the user choose which to remove |
| `renewSignIn` | Signs in again with the device key when a token expires. Silent, because the device is unlocked. A refusal means the device was removed → `DeviceRemovedError` |
| `removeThisBrowser` | A self `device-remove`, then forgets the token, the keystore and the record |
| `forgetThisBrowser` | The same on a best-effort basis, for a browser that has lost its registration: the signing key still signs, so it leaves the device list before forgetting |
| `changeDevicePin` | A new registration from the open session; the commit replaces the old one |
| `removeOtherDevices` | Needs the phrase for the root wrap key (see `lib/keyrings`). Builds the removal with the rotation of everything the device held, and adds the new KEKs to the session |
| `deleteAccountWithPhrase` | Root-signed `account-delete`, with the account PIN proof on Paranoid, then forgets everything local |

## How each PIN failure reads

- **A wrong device PIN** fails the local open of the sealed material and returns the server's
  `attempts_remaining`. At zero, the browser has lost the account.
- **`404` on evaluate** means the registration is gone: the attempts ran out, or another device
  removed this one (the registration goes with the device). The outcome is `forgotten`, the local
  record is deleted, and the UI asks for the phrase, never for the PIN again.
- **An account PIN never errors.** The evaluation always answers, so a wrong or throttled PIN
  shows only as the root action refused (`AuthRejectedError` or `401 INVALID_CREDENTIALS`).

The root keys and the phrase exist only inside `completeSignUp`, `enrolThisBrowser`,
`removeOtherDevices` and `deleteAccountWithPhrase`, and are zeroed in their `finally`.
