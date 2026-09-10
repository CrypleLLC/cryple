# `lib/files` — the drive

The client half of the drive: **the format**, and the transport that carries it. Tasks
[109.1–109.3](../../../tasks/tasks.md). The design is
[storage-plan.md § 3.3](../../../../api-general/.docs/storage-plan.md) and the wire contract is
[front-end-endpoints.md § 17](../../../front-end-endpoints.md#17-files-endpoints); neither is
restated here.

## Files

| File | Role |
| --- | --- |
| `layout.ts` | The arithmetic: padding, chunk counts, stored sizes, byte ranges |
| `chunks.ts` | Sealing and opening one chunk, and the position header that makes reordering detectable |
| `manifest.ts` | The sealed manifest — where a filename lives — and the check that refuses a mismatched object |
| `records.ts` | The wire types, and the small predicates a screen needs (`isInVault`, `remainingBytes`, `fits`) |
| `api.ts` | The seven routes |
| `sink.ts` | Where sealed chunks live between sealing and uploading — see below, this is not an optimisation |
| `seal.ts` | The sealing pass: stream in, pad, chunk, seal, hash |
| `upload.ts` | The whole upload, and within-session resume |
| `download.ts` | Resolving a file, streaming decryption, and the ranged read that makes seeking possible |

`layout`, `chunks` and `manifest` do no I/O at all, which is why the whole format is tested in a
suite with no DOM and no network.

## The object

```
chunk_plaintext = u32be(chunk_index) ‖ u32be(chunk_count) ‖ payload
chunk_object    = 0x01 ‖ iv(12) ‖ AES-256-GCM(DEK, iv, chunk_plaintext) ‖ tag(16)
```

The stored object is those chunks concatenated in order, and nothing else — no header, no
manifest, no index.

## Three numbers, and why each is what it is

| | Value | Set by |
| --- | --- | --- |
| Chunk payload | 8 MiB | **Transport, not privacy.** One chunk is one R2 multipart part, and R2's minimum part size is 5 MiB. 1 MiB is below the floor and was never viable |
| Chunk overhead | 37 | `1` version ‖ `12` IV ‖ **`8` position header** ‖ `16` tag |
| Padding bucket | 64 KiB | **Privacy.** It is what quantises the length the server sees |

**The overhead is 37, not 29.** 29 is the same envelope without the position header, which is what
this format was while the chunk index lived in AEAD additional data. The frozen envelope has no
AAD, so the index moved inside the authenticated plaintext and cost 8 bytes per chunk. Anything
computing an offset with 29 drifts 8 bytes per chunk and every ranged read after the first fails
its GCM tag.

**Padding and chunking are separate decisions and must stay that way.** The design once specified
rounding a file up to a whole chunk; at 8 MiB that turns a 40 KB note into an 8 MiB object, a 200×
inflation. Padding is applied to the plaintext *before* chunking, so a 40 KB note is 64 KiB and
uploads as a single `PUT` — no multipart, and therefore no minimum part size.

## The stored size is derived, never guessed

```
padded      = ceil(true_size / 65536) × 65536
chunk_count = ceil(padded / 8388608)
size_bytes  = padded + chunk_count × 37
```

**`size_bytes` is not `chunk_count × stride`.** The last chunk is short, so that identity holds only
when the payload exactly fills its chunks. A 64 KiB file is one chunk and 65,573 stored bytes; the
product form expects 8,388,645. [The design specified the product form until
2026-09-09](../../../../api-general/.docs/storage-plan.md) — a client implementing it literally
would have refused nearly every file it uploaded, and the refusal would have looked like a working
safety check. `layout.test.ts` pins both the correct arithmetic and the rejection of the old form.

The server checks a weaker version of the same thing, `ceil(size_bytes / stride) == chunk_count`,
because it never has the true length. **The client is the only party that can verify the layout
exactly**, which is the usual shape of this architecture.

## What each field defends against

| Attack | Defence | Test |
| --- | --- | --- |
| Reorder chunks within a file | `chunk_index` mismatches where it was read from | `chunks.test.ts` |
| Drop or truncate trailing chunks | `chunk_count` disagrees with how many arrived | `chunks.test.ts` |
| Splice in a chunk from another file | Different DEK, so the GCM tag fails | `chunks.test.ts` |
| Alter a chunk in storage | The GCM tag fails | `chunks.test.ts` |

`openChunk` takes the index and count the caller **read it from** and verifies the header against
them. It does not return the position for the caller to check, because a check the caller has to
remember is a check that gets skipped.

## Raw bytes, not base64

`chunks.ts` uses `sealBytes` / `openBytes` from [`lib/sealed`](../sealed/README.md), which return
`Uint8Array`. The `sealBlob` / `openBlob` pair is the same envelope base64-encoded, and that
encoding exists for `TEXT` columns. **An R2 object is not one**, and base64-ing a multi-gigabyte
file inflates it by a third for nothing. Those two raw functions were added for this module, and
the base64 pair now delegates to them so there is one implementation of the envelope.

The manifest goes the other way: it is a `ciphertext` column, so it is `sealText` and base64.

## The manifest

A file's name, MIME type and **true plaintext length** are user data, so they are sealed under the
file's own DEK and stored in `ciphertext` exactly like `secrets.ciphertext`. There is no filename
column, and `files.size_bytes` on the wire is the padded length rather than the real one.

`assertManifestMatchesRow` is the refusal from
[§5.5](../../../../api-general/.docs/storage-plan.md): if the manifest and the ledger row do not
describe the same object, the client stops rather than decrypting and hoping.

**It reads as a data error, not a security alert.** The overwhelmingly likely cause is a bug in an
upload, and telling a user their vault is under attack because a client wrote a wrong length is how
a security warning becomes noise. `manifest.test.ts` asserts the message says so — it names the
upload and contains neither "attack" nor "tamper".

## Transport

`api.ts` is the seven routes and nothing clever. Three things in it are not obvious:

- **`POST /files` is also the resume call.** Replaying it with the same `id` on a row that is still
  `pending` returns `200` and a ticket listing only the parts R2 does not have — the same answer as
  `GET /files/{id}/upload` without re-sending the body. `createFile` therefore reports `created`
  from the status rather than assuming a `POST` created anything.
- **The listing is written against a page envelope the API does not yet send.** `GET /files` accepts
  `limit` and `cursor` but returns no `page`, so `collectPages` stops after one page — which is the
  correct behaviour for a route that cannot tell you there is more. When [the server-side
  fix](../../../../tasks.md#task-107) lands, this starts paging with no change here. **Do not
  special-case the current behaviour and do not synthesise a cursor**; there is no legal value to
  send. Both halves are tested.
- **`completeUpload` sorts parts by number**, because that is the order R2 completes a multipart in,
  and the caller collecting `ETag`s from concurrent `PUT`s has no reason to hold them in order.

### The row does not carry `chunk_count`

`POST /files` takes one and the row never returns it. So **the chunk layout comes from the sealed
manifest, and only from there** — `assertManifestMatchesRow` takes the row's `size_bytes` and
nothing else, checks the manifest is internally consistent, and then checks it against that one
number. An earlier draft of this module took a row chunk count that does not exist on the wire.

### Two error codes are unique to the drive

| | Status | Code | Handling |
| --- | --- | --- | --- |
| Quota | `507` | `QUOTA_EXCEEDED` | The only `5xx` in the API that is **not** a server fault. Never retry it unchanged. `userMessageFor` says the space returns within a minute, because deleted rows count until the reconciler runs |
| Object too large | `413` | `BAD_REQUEST` | **Shares its code with an ordinary field rejection**, so `isObjectTooLarge` branches on the status. Anything switching on `code` alone gets this wrong |

## Upload, and the reason it is two passes

`uploadFile` seals the whole object, `POST`s, uploads the parts, then `PATCH`es. **It cannot
interleave sealing and uploading**, and that is worth understanding before anyone tries to "fix" it:

- `ciphertext_sha256` is required at `POST /files`, so the hash of the finished object must exist
  before the request that authorises the upload.
- `POST` is also what returns the presigned URLs, so nothing can be sent before it.
- Every chunk draws a **random IV**, so a second sealing pass produces a different object with a
  different hash. The bytes cannot be regenerated; they have to be kept.

So the client holds the sealed object between the two passes, which means **memory is bounded by the
file rather than by the chunk** — the opposite of what
[§3.3](../../../../api-general/.docs/storage-plan.md) claims. `sink.ts` is that holding place, and
it exists as an interface because it is where the eventual fix plugs in: OPFS spill, a derived IV,
or moving the hash to `PATCH`. The
[design](../../../../api-general/.docs/storage-plan.md) carries all three with their costs.

`memorySink` therefore takes a ceiling and **refuses above it rather than crashing the tab**. The
same limitation is why `resumeUpload` takes a sink: it can retry parts within a session, but a page
reload loses the sealed bytes and there is nothing to resume from.

Three smaller things:

- **A one-chunk file is a single `PUT`, not a multipart upload.** The ticket's `multipart` flag says
  which, and `completeUpload` sends no parts for the single case. This is what keeps small files
  cheap at an 8 MiB chunk.
- **Parts upload with bounded concurrency and are sorted by number before `PATCH`**, because R2
  completes a multipart in order and concurrent `PUT`s do not finish in one.
- **The sealing pass refuses a source that lies about its length**, in either direction, rather than
  padding a short read or truncating a long one into an object whose hash nobody can reproduce.

## Download

`openFile` resolves the row, unwraps the DEK under the vault KEK, opens the manifest and **runs the
layout check before anything is decrypted**. `downloadFile` streams the object through
`decryptStream` and hands back plaintext.

- **Each chunk is verified before its bytes are released**, not after assembly — the GCM tag *and*
  the position header. That is what makes streaming a large file safe rather than trusting four
  gigabytes on a hash that cannot be computed until the end.
- **The padding is trimmed with `size` from the manifest**, which is the only place the true length
  exists. The stream emits exactly `size` bytes and the padded tail never reaches the caller.
- **Truncation is caught by the chunk count**, not by the length: a stream that ends early leaves
  `index < chunk_count` and raises `TruncatedObjectError`. A stream that runs long is refused too.
- **`ciphertext_sha256` is checked at end of stream**, and it is a belt on top of braces: per-chunk
  GCM already catches any altered byte. Its value is the clearer error when the object is intact but
  is not the one the row recorded.
- **The presigned URL is re-requested, never cached.** Its TTL is five minutes, and a URL held past
  it fails in a way that looks like a missing file.

`readChunk` is the ranged read, `[n × 8388645, …)`, for seeking in media. Nothing in the first
version calls it — a straight download is enough — but the stride arithmetic exists so the reader
did not have to be designed in a way that forecloses it.

## What is not here

No cache and no thumbnails; both are deferred, and
[Task 109.8](../../../tasks/tasks.md) explains why the cache is trivial when it arrives.
