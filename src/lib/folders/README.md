# `lib/folders` — folders in every scope

Two shapes, because [Task 133](../../../../tasks.md#task-133) D1 put the tree in a different place per
scope:

- **The sealed manifest** — `secrets` tabs and `notes` spaces — below.
- **The tree** — `documents` and `files` — in `tree.ts` ([below](#the-tree--documents-and-files)).

## The sealed manifest

How the items of a scope are organised, sealed so the server never learns a folder name, how many
folders there are, or which item sits in which. It is modelled on
[`lib/sharing/address-book`](../sharing/README.md): one blob per scope, sealed under a fresh DEK
wrapped by the scope's KEK, written optimistically on a revision.

This is 133.1 of [Task 133](../../../../tasks.md#task-133). Today it serves the vault's tabs
(`secrets`) and the spaces in notes (`notes`). `documents` and `files` keep their tree in a table
instead (133.3), and the Shared space will reuse the pure half of this module under a per-connection
key (133.4).

## Files

| File          | What                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `manifest.ts` | The shape, parsing, validation, merge and repair, the edits and the queries. No I/O    |
| `api.ts`      | `GET` / `PUT /<scope>/folders`, and the `folders-update` signature                     |
| `store.ts`    | Sealing and opening, the per-session cache, the edit loop that survives a `409`, and `resetFolders` |
| `tree.ts`     | The `documents` and `files` tree: its routes, sealed names, and walking it              |

### The manifest

```ts
{
  v: 1,
  folders: { [folderId]: { name, parent_id, position, updated_at, deleted_at? } },
  items:   { [itemId]:   { folder_id, updated_at } },
}
```

- **Folder ids are client-minted UUIDs**, except `home`, which has the fixed id `home` so two
  devices that each create an empty manifest create the same folder rather than two.
- **A deletion is a tombstone** (`deleted_at`), never a removed key. A merge that only unions keys
  would bring a deleted folder back from the other side.
- **An item placement is by item id** and names one folder (D4 — a strict tree). A placement to a
  folder that has since been deleted is not an error; the item resolves as unplaced.
- **Ordering is `position`**, then name, then id, and is computed here: the server cannot sort
  what it cannot read.

#### Rules per scope

`MANIFEST_SCOPE_RULES` holds them, and every edit and every validation takes them:

| Scope              | `maxDepth` | `home` | Why                                                 |
| ------------------ | ---------- | ------ | --------------------------------------------------- |
| `secrets`, `notes` | 1          | yes    | A tab is flat (D2), and a tab has to be _some_ tab (D5) |

**`home` is a real entry, not a rendered default** (D5). It is renameable, cannot be deleted and
cannot be moved off the root, and an item with no placement — or placed in a deleted folder —
resolves to it. In a scope without `home` the same item resolves to the root, `null`.

### Validation — the tree is the client's to check

The server stores the blob without being able to read it, so it can refuse none of the ways a tree
goes wrong. `validateFolderManifest` refuses, with a `FolderManifestInvalidError` naming the
`problem`:

| Problem           | Meaning                                                    |
| ----------------- | ---------------------------------------------------------- |
| `cycle`           | Following parents comes back to where it started           |
| `too-deep`        | A live folder sits deeper than `maxDepth`                  |
| `unknown-parent`  | A folder names a parent that is not in the manifest at all |
| `deleted-parent`  | A live folder sits under a deleted one                     |
| `missing-home`    | A scope with `home` has none, or it is deleted or nested   |
| `unknown-folder`  | An item is placed in a folder that never existed           |
| `malformed`, `bad-name`, `unknown-version` | The JSON is not a manifest        |

**A cycle is the hazard this exists for.** `A → B → A` renders recursively for ever and freezes
the tab — a denial of service against the user's own vault. Every walk here is bounded by the
number of folders, and `loadFolders` validates before anything is returned, so a tree that fails
is **reported to the caller rather than rendered**. `editFolders` refuses to edit it too.

### Edits and the merge

Each edit is a `FolderEdit` — `(manifest, rules) => manifest` — and throws a `FolderEditError` when
it cannot apply: `createFolder`, `renameFolder`, `moveFolder`, `deleteFolder` (recursive over the
subtree), `placeItem`, `forgetItems`. An edit that changes nothing returns the same object, and
`editFolders` then writes nothing.

`editFolders` applies the edit to the manifest it holds, **merges the result into it**, seals and
`PUT`s it. On `409 CONFLICT` it re-reads and **applies the same edit again** to what another device
stored — so an edit that no longer makes sense (moving into a folder deleted meanwhile) fails
honestly rather than being merged into something else. `createFolder` mints its id once, outside
the edit, so a retry does not create a second folder.

`mergeFolderManifests(stored, local)` is **last-writer-per-folder-id on `updated_at`**, and the same
per item id; the stored side wins a tie. A merge can produce a tree neither side wrote, so its
result goes through `repairFolderManifest`, deterministically:

- **A cycle** — two devices each moving one folder under the other — is broken by lifting the most
  recently moved folder in it to the root.
- **A live folder under a deleted one** is deleted with it, which is what deleting a folder means.
- **A subtree carried past `maxDepth`** by two moves that were each legal has its shallowest
  offending folder lifted to the root, until nothing is too deep.
- **`home`** is put back at the root if it is missing, deleted or nested.

The honest cost of last-writer-wins: **a simultaneous rename can lose one side's word.**

### Sealing

- A fresh 32-byte DEK per write seals the JSON; the DEK is wrapped under **the scope's current
  KEK**, and the `PUT` carries that generation. `409 STALE_KEY_GENERATION` refreshes the keyrings
  and retries.
- Opening an older generation's manifest fetches the keyrings first if this session lacks that KEK.
- Plaintext and DEK are zeroed after use. The cache is per `SessionKeystore` and is cleared when
  the session locks.
- `folders-update` signs `[scope, expected_revision, sha256(ciphertext)]`
  ([`lib/signing`](../signing/README.md)).

## What is still open

- **Deleting a tab** only drops the grouping in the manifest; the tab strip
  ([`FolderTabs`](../../components/README.md#folders)) sends the items' signed batch delete first, then
  the manifest edit (D6).
- **Tombstones are never pruned.** A scope holding tens of folders never notices; one that churns
  folders for years will carry them.
- **A rotation does not re-wrap the manifest.** [`lib/rekey`](../rekey/README.md) walks items; the
  manifest stays under the generation it was last written with until the next edit re-seals it
  under the current one, exactly as the address book does.
- **`resetFolders`** replaces a manifest that fails validation with an empty one, over whatever
  revision is stored. Only the user starts it — the tab strip offers it beside the explanation — because
  it throws the tabs away; the items themselves are untouched.

## The tree — `documents` and `files`

Here a folder is a row on the server ([`folders` domain](../../../../api-general/internal/domain/folders/README.md#the-tree--documents-and-files)):
the server sees which folder is inside which and which item sits where, and **never a name**.

| Export | What |
| --- | --- |
| `listTreeFolders` | Every live folder, names opened here, and the tree validated before it is returned |
| `createTreeFolder`, `renameTreeFolder` | Seal the name under a fresh DEK wrapped by the scope's KEK |
| `moveTreeFolder` | `null` is the top level |
| `deleteTreeFolder` | Signed `folder-delete` over `[scope, folder_id]`; the server takes the subtree and its items |
| `moveItemsToFolder` | Moves items; `null` is the top level |
| `childrenOf`, `pathTo`, `descendantsOf` | Walking the tree for a folder view and a path bar |
| `canMoveFolder`, `canCreateIn` | The same depth and cycle rules the server enforces, so the UI never offers a move it would refuse |
| `TREE_RULES`, `MAX_TREE_DEPTH` | 8 levels, no `home` |

- **The server enforces the tree, and the client checks it anyway.** `listTreeFolders` runs the
  folders through `validateFolderManifest` with `TREE_RULES`, so a server that returns a loop gets a
  `FolderManifestInvalidError` rather than a frozen tab. A folder whose name cannot be opened here
  keeps its place with `name: undefined`.
- **`FolderTreeProblemError`** carries the server's two refusals, `FOLDER_TOO_DEEP` and
  `FOLDER_INTO_ITSELF`, so a screen can say which one.
- **Listing one folder** is `listDocumentsMeta(context, { folder })` and `listFiles(context, { folder })`
  with a folder id or `ROOT_FOLDER`. Without `folder` they list everything, which `lib/rekey` relies on.
- **A drive thumbnail is a file of its own.** Whoever moves a file moves its thumbnail with it, or the
  thumbnail stays behind and shows up as a file in the old folder.
