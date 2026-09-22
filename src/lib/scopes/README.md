# `lib/scopes` — what a device may hold

The seven scopes of [device-keys.md § Scopes](../../../../api-general/.docs/crypto/device-keys.md#scopes),
in their canonical order: `admin,passwords,secrets,notes,documents,files,sharing`.

| Export | Use |
| --- | --- |
| `SCOPES`, `KEYRING_SCOPES`, `ITEM_SCOPES` | The canonical lists. Every scope but `admin` is a keyring |
| `parseScopeList` / `formatScopeList` | A list is a comma-joined string **in canonical order, with no duplicates**. `parse` refuses anything else instead of normalising it, because a signature covers the exact string |
| `scopeForItemType` | `secret → secrets`, `note → notes`, `document → documents`, `file → files` |
| `isFullDevice` | Holding `admin` is what makes a device full: it may delete, remove devices and rotate |

In this client every browser is a full device holding every scope (phase 1). The UI still reads
scopes from the session, so a limited device already hides the sections and delete buttons it
cannot use.
