# `lib/documents` — rich-text documents as an encrypted CRDT log

Backs the Google-Docs-style editor at `/docs/[id]`. A document is a **Yjs CRDT**: one compacted
snapshot plus an append-only log of sealed deltas, all produced and consumed here. The server
assigns sequence numbers, appends, and serves ranges. It never parses a delta and never merges
anything — see
[`documents/README.md`](../../../../api-general/internal/domain/documents/README.md) in the API
repo for the wire contract this module implements.

Single user, many devices. No collaboration, no presence, no WebSocket.

## Why a CRDT rather than the `notes` shape

`lib/notes` writes one whole `ciphertext` per save: last write wins, and a phone holding a stale
buffer silently overwrites what the laptop wrote. That is tolerable for a short note and not for
long-form writing.

Operational Transformation cannot help here — it resolves concurrent edits by reading their
positions and content, and the server holds only ciphertext. A CRDT merges by construction, with
no server intelligence at all, which is exactly what a zero-knowledge backend can host.

Three Yjs properties keep the server dumb, and each one buys this module a simplification:

| Property | What it buys |
| --- | --- |
| Commutative | `seq` is a **cursor**, not a correctness-bearing order |
| Idempotent | Re-applying a delta is a no-op, so over-fetching is always safe |
| Self-describing binary | Nothing inspects a delta, here or on the server |

Sync is on `seq`, never on a Yjs state vector. A state vector is plaintext structural metadata —
client count and per-client operation counts — so sending one would leak document structure for
no gain.

## Files

| File | Role |
| --- | --- |
| `records.ts` | Wire types, server ceilings, and the contiguity rules |
| `api.ts` | The nine endpoints, DEK wrapping, and the `document-delete` signature |
| `crypto.ts` | Sealing deltas and snapshots under the per-document DEK |
| `content.ts` | The `Y.Doc` layout: `body` fragment, `meta.title` |
| `sync.ts` | `DocumentSync` — the engine: open, pull, debounce, push, compact |
| `summaries.ts` | Decrypting enough of each document to render the dashboard list |

## Sealing

Deltas and snapshots are **binary**, so they use `sealBlob` / `openBlob` from
[`lib/sealed`](../sealed/README.md) directly — not `sealText`, which is what `lib/notes` uses.
The DEK is per document and wrapped under the vault KEK by the shared
`vaultKekDekWrapper` ([`lib/secrets/dek.ts`](../secrets/README.md)), the same seam every other
domain uses.

**One DEK seals the snapshot and every delta**, so one wrapped key covers the whole log however
long it grows. It is also why rotating a document's DEK means re-encrypting everything — compact
first, then rotate.

## The two cursor traps

Both of these produce silent, permanent data loss rather than an error, and both have tests.

### `seq` restarts after a full prune

`seq` is `MAX(seq) + 1` **over the remaining rows**. Prune the whole log during compaction and
the next append is `seq = 1` again — *below* the `snapshot_seq` it follows. A client that opens
at `cursor = snapshot_seq` will therefore never see it.

`DocumentSync` opens at **`cursor = 0`** and pulls the whole surviving log, re-applying anything
the snapshot already covers. That is free correctness: Yjs updates are idempotent. The same reset
happens after this device compacts, and after `refreshHead`.

Because the log may legitimately start above `0` (a partial prune) or restart at `1` (a full
one), a cold pull cannot demand that the first row equals `cursor + 1`. `assertLogFollows` encodes
what is actually true: the first surviving row is either `1` or `snapshot_seq + 1`.

### `latest_seq` from an append is not a cursor

`POST /updates` returns the log's new `latest_seq`. Treating it as "everything I have seen" is
wrong whenever another device appended in between — those rows sit below it, unread, and the
cursor jumps straight past them.

`cursorAfterAppend` only advances when `latest_seq === cursor + applied`, which is exactly the
case where the only new rows are the ones this device just wrote. Otherwise the cursor stands and
the next pull re-reads the range, harmlessly.

## Contiguity, and why it is a client obligation

`.docs/storage-plan.md` used to call for sequence numbers in AES-GCM AAD so a compromised backend
could not reorder chunks, which the frozen sealed-blob format in `.docs/crypto/ECDSA.md` makes
impossible — it specifies **no AAD**. **That contradiction was resolved on 2026-09-06**: the drive
now binds a chunk's position inside the *authenticated plaintext* (`storage-plan.md` § 3.3), which
GCM covers just as AAD would have.

**It does not resolve anything here, and the obligation below stands.** That fix applies to the
chunks of one file object, sealed under one DEK and written once. A document's delta log is a
different shape — an append-only series of independently sealed rows, written by several devices
over time — so there is no chunk count to bind and no single object whose hash could reveal a
missing row. For Yjs, reordering is harmless anyway: merges commute. **Dropping is not.**

So the client verifies it: `assertContiguous` rejects a hole inside any fetched range, and a
detected gap latches `gapDetected` on the sync state. Once latched, `compact()` refuses — writing
a snapshot over an incomplete merge would make the loss permanent by pruning the very rows that
could still have arrived.

## Compaction

Only a client can compact: the server cannot merge an encrypted log. A document nobody opens
never compacts and its log grows — inherent to encrypted CRDT logs, not a defect, but it means
compaction belongs to the open/close lifecycle. `DocumentSync.close()` flushes, then compacts if
the log has grown past `DEFAULT_COMPACT_THRESHOLD` deltas past the snapshot.

`expected_revision` guards the install. A `409 CONFLICT` means another device wrote first, so the
engine re-reads the head and drops its own compaction attempt rather than retrying into a race.
The failure it prevents is **staleness, not simultaneity**: appends are immune by construction,
snapshot installs are not.

## Debounce is a storage decision

The sealed-blob envelope costs 29 bytes per seal (`0x01 ‖ iv(12) ‖ tag(16)`). Sealing every
keystroke makes envelope overhead dominate the payload, so the engine merges queued updates and
pushes on a 1.5 s debounce. Batches are chunked to stay under the server's 262144-character
per-delta ceiling; a single update over that ceiling throws rather than being silently truncated.

`client_update_id` is generated once per batch and **reused on retry**, so a replay after a
dropped response is skipped server-side and consumes no sequence number.

## Document titles live inside the CRDT

The API stores no title — it is zero-knowledge, and the index returns metadata only. The title is
therefore a field in the document itself: `doc.getMap('meta').get('title')`, alongside the body in
`doc.getXmlFragment('body')`.

The consequence is that the dashboard list cannot be rendered from `GET /documents` alone.
`loadDocumentSummaries` opens each document (snapshot plus log) at a bounded concurrency of 4 and
reads the title out, the same shape `listNotes` uses. An undecryptable document degrades to a
tile marked unreadable rather than failing the whole list.

## Deletes

The two delete routes are the only ones that need a signed action; create, edit and compact are
JWT-only, because an autosave cannot prompt for a seed signature every two seconds.

`document-delete` is **variadic**, so `normalizeActionArgs` sorts and de-duplicates the ids before
signing — the server rebuilds the argument list the same way, and an unsorted list produces a
signature that cannot verify.
