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

## Deleting a secret is confirmed, and recoverable

The row's Delete opens a [`ConfirmDeleteModal`](../modal/README.md) naming the secret, and only its
*Delete* sends the signed `secret-delete`. Since
[ADR 00016](../../../../api-general/docs/adr/00016_deleted_secrets_are_recoverable.md) that moves the
secret to **Recently deleted** rather than destroying it, and the sentence,
`SECRET_DELETE_CONFIRMATION` in `lib/app/vault.ts`, says so: where it goes, that it can come back,
and that it stays stored, encrypted, until it is deleted permanently. A test pins all three.

| File | Role |
| --- | --- |
| `DeletedSecrets.tsx` | *Recently deleted*, in the [side panel](../shell/README.md#the-side-panel): restore, and delete permanently |

*Recently deleted* is a button above the list, opening the side panel exactly as Passwords' does.

- **It reads nothing until it is opened**, then `GET /secrets/deleted`, and opens each secret to
  show its name (`buildDeletedVaultRows`). The value is never put in a row: the panel has no use
  for it. A secret that will not open is listed as *Unreadable item*, still restorable and still
  purgeable. It reads again after every restore and purge, and after a delete while it is open.
- **Restore** is `POST /secrets/{id}/restore`, unsigned. The secret goes back to the tab it was in:
  a delete **does not** touch the tabs manifest, and a tab that was deleted meanwhile falls back to
  the first tab, because `folderOf` ignores a placement in a folder that no longer exists.
- **Delete permanently** is on each row, and *Delete all permanently* under the list when there is
  more than one. Both confirm first with `SECRET_PURGE_CONFIRMATION` — the one sentence in the
  Vault that says *cannot be undone* — and send the signed `secret-purge`. A purge is where the
  manifest placement is forgotten. Both controls exist only on a full device, which is what the
  signature needs.
- **Deleting a tab still deletes its secrets**, through the same `DELETE /secrets` — so they land
  in Recently deleted too, and a restore puts them in the first tab.
- The panel stays open while its confirmation is up: see
  [the side panel](../shell/README.md#the-side-panel) on modals opened from it.
