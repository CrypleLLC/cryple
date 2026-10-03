# `components/trash`

The **Trash** sidebar section: deleted documents, Drive files and folders, until they are deleted for
good. Everything it decides is in [`lib/trash`](../../lib/trash/README.md) and the copy in
[`lib/app/trash.ts`](../../lib/app/README.md#the-trash).

| File | Role |
| --- | --- |
| `TrashScreen.tsx` | The list, *Restore* and *Delete for good* per entry, and *Empty the Trash* |

- **It is always in the sidebar**, whatever the account. An account that keeps nothing
  (`retention_days: 0`) sees the Trash say so, and an empty list — a delete was already final.
- **The notice on top says how long things wait**, and each row says when it goes for good, counted
  from its deletion: *Deleted for good in 27 days*.
- **One row per entry**, from both Documents and the Drive, newest deletion first. A folder row says
  how many documents or files went with it; restoring it brings them all back.
- **Restoring needs nothing more than a tap**; nothing is destroyed. A Drive restore that would pass
  the quota says so instead of restoring part of it.
- **Deleting for good is a full device's**, like every destruction, behind a confirmation that says
  nobody can bring it back. A limited device sees why the control is missing.
- **It lists only the scopes the device holds**: a device without `files` never asks for the Drive's
  Trash.
