# `lib/trash` — the Trash of documents and the Drive

Deleted documents, Drive files and their folders wait in the Trash for the account's
`retention_days` (`GET /users/me`), then `reconcile` destroys them
([Task 133](../../../../tasks.md#task-133) D7). `0` keeps nothing: the Trash is always empty and a
delete is final. The Vault and Passwords keep their own *Recently deleted*; this module is for the
two scopes whose folders are rows on the server.

| File | What |
| --- | --- |
| `api.ts` | The routes: `GET /<scope>/trash`, `GET /<scope>/trash/keys` (every trashed row's wrap, for [`lib/rekey`](../rekey/README.md)), `GET /documents/trash/{id}`, `POST /<scope>/trash/restore`, `DELETE /<scope>/trash` signed `document-purge` / `file-purge` |
| `entries.ts` | One list across both scopes, every name opened on this device, and restoring and purging a selection |

## One list, named here

`listTrash(context, scopes)` reads the Trash of each scope the device holds and turns every row into
a `TrashEntry` — `{ scope, kind, id, name, deletedAt, itemCount?, sizeBytes?, mime?, companions }` —
newest deletion first. The server holds no name, so each is opened here:

- **A folder** opens its sealed name exactly as the tree does (`openTreeFolderName` in
  [`lib/folders`](../folders/README.md)). **A deleted folder is one entry**: the server lists the root
  of each deletion with `item_count`, and what went with it is inside it, not beside it.
- **A document** has no name outside its Yjs state, so `trashedDocumentTitle` reads
  `GET /documents/trash/{id}` — the snapshot and every update after it — rebuilds the document and
  reads its title. A document that will not open keeps its place with `name: undefined`.
- **A file** opens its sealed manifest for the name, type and size.

**A thumbnail never shows as a file**, here as in the Drive: every manifest's `thumbnail_id` that is
itself in the Trash is hidden, and travels as a `companion` of its file, so restoring or purging the
file takes its thumbnail with it.

**One scope that will not load does not hide the other.** `listTrash` answers `{ entries, failed }`;
the screen says something could not be read and still lists what could.

## Restoring and purging

`restoreEntries` and `purgeEntries` group a selection by scope and send each scope's ids — with
their companions — in one request. Restoring needs no signature; purging is signed by the device
over the ids sorted and de-duplicated, the same normalisation every variadic action uses
([`lib/signing`](../signing/README.md)). Both answer how many rows moved.

- **Restore puts things back where they were**, or at the top when their folder is still in the
  Trash. A Drive restore that would pass the quota is refused whole with `QUOTA_EXCEEDED`.
- **Purging a Drive entry** takes it out of the Trash at once; the worker destroys both copies on its
  next pass. A document purge is immediate.
- **Nothing past its retention is listed or restorable**, even before the worker has destroyed it.
