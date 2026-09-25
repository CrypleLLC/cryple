# `components/vault`

| File | Role |
| --- | --- |
| `VaultScreen.tsx` | The vault: the secrets list, filed under tabs, add, share, move and delete (Task 34) |
| `VaultReveal.tsx` | The global show/hide-values state and its top-bar button, shared with Passwords |

The list is an [`ItemList`](../item-list/README.md) and the add form a
[`FormModal`](../modal/README.md); what is left in the screen is loading, filing and the row's
actions. The tab strip above the list is [`FolderTabs`](../folders/README.md).

## Why the vault list downloads every payload

**Names are ciphertext.** A secret's plaintext is one `{name, value}` JSON blob, so the server
holds no name field to list — `GET /secrets?fields=meta` returns sizes and timestamps and
nothing a person can read. Showing names in the index therefore means opening every item, and
the list loads through `listSecrets` — the single unpaginated `GET /secrets` the endpoint guide
calls "the heaviest response the API produces" — rather than the meta listing plus one
`GET /secrets/{id}` per row. One request beats N, and the values are then already in memory.

Hiding is consequently presentational only: the global toggle in the top bar flips a boolean,
never a fetch, so it is instant in both directions and costs nothing to use. Names stay visible
at all times; only values mask, and they mask to a fixed-width `MASKED_VALUE` so the rendering
does not leak the length. Copy stays available while values are hidden — the point of hiding is
shoulder-surfing, not withholding the value from its owner.

An item that will not decrypt is rendered as `UNREADABLE_SECRET_NAME` and keeps its row instead
of failing the whole list, since one blob written by another client must not blank the vault.
`buildVaultRows` in [`lib/app`](../../lib/app/README.md) does that classification, so it is tested
without a DOM.
