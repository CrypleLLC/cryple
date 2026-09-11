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
| `thumbnails.ts` | Deriving a preview locally, telling a preview's row apart from a file's, and opening one |
| `cache.ts` | The OPFS cache of **sealed** objects, and the pruning that keeps it honest |
| `records.ts` | The wire types, and the small predicates a screen needs (`isInVault`, `remainingBytes`, `fits`) |
| `api.ts` | The eight routes |
| `upload.ts` | The whole upload: stream in, pad, chunk, seal, `PUT`, hash — one pass. And resuming one |
| `download.ts` | Resolving a file, streaming decryption, and the ranged read that makes seeking possible |
| `handles.ts` | Remembering which file an unfinished upload came from, so resuming does not ask for it again |

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

`api.ts` is the eight routes and nothing clever. Three things in it are not obvious:

- **`POST /files` is also the resume call.** Replaying it with the same `id` on a row that is still
  `pending` returns `200` and a ticket listing only the parts R2 does not have — the same answer as
  `GET /files/{id}/upload` without re-sending the body. `createFile` therefore reports `created`
  from the status rather than assuming a `POST` created anything.
- **The listing pages through `collectPages`.** It was written against an envelope the API did not
  send yet, and stopped after one page until [Task 111](../../../../tasks.md#task-111) landed on
  2026-09-10; nothing here changed when it did. **Do not synthesise a cursor** — there is no legal
  value to send, and a short page is not the last page.
- **`completeUpload` sorts parts by number**, because that is the order R2 completes a multipart in,
  and the caller collecting `ETag`s from concurrent `PUT`s has no reason to hold them in order.

### Giving a reservation back

`abandonUpload` is `DELETE /files/{id}/upload`: no body, no signature, and **a `404` is success**.
The row it removes is a reservation the same token created, not stored data
([Task 112](../../../../tasks.md#task-112)), so a repeat, a row the sweep already collected, and one
that completed in between all mean the same thing — stop worrying about it.

It exists because `POST /files` checks the quota **before** signing anything, so the row holds its
declared size from the moment it is written. An upload that dies at its first part would otherwise
cost the user its whole size until a 24-hour sweep ran.

### Deleting one file and deleting a selection are one action

`deleteFile` (`DELETE /files/{id}`) and `deleteFiles` (`DELETE /files`) both sign `file-delete`, and
the single route is the one-element case of the same label. `deleteFiles` runs the ids through
`normalizeActionArgs`, which **sorts ascending and de-duplicates**, and sends `ids` in exactly that
order — the server rebuilds the list its own way, so a differently-ordered body verifies against
nothing. One signature covers the whole selection, which is the point: *n* files used to mean *n*
challenges, *n* signatures and, on a Paranoid account, *n* second-factor checks.

The batch answers `{requested, deleted}` rather than `204`. **A shortfall is not a failure** — those
ids matched no row, so the list was stale; `fileBatchDeleteSummary` turns it into copy that says so.
The count is rows, never objects: the bytes leave R2 and GCS afterwards, and the quota with them.

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

## Upload is a single pass

`uploadFile` `POST`s first, then for each chunk: seal it, `PUT` it, fold it into a running SHA-256,
discard it. `PATCH` carries the hash and the ETags. **Peak memory is a function of chunk size and
part concurrency, never of file size.**

It was two passes until 2026-09-10, and the reason it could not be one is worth keeping:
`ciphertext_sha256` was required at `POST`, `POST` is what returns the URLs, and a random IV meant
the sealed bytes could not be regenerated — so the whole ciphertext had to be held in between. Two
changes removed that, and both matter here:

- **The hash moved to `PATCH`** ([Task 110](../../../../tasks.md#task-110)). It describes the
  finished object, so completion is the first moment it can exist.
- **The chunk IV is derived**, `IV(n) = 0x00 × 8 ‖ u32be(n)`, so a chunk can be re-sealed
  byte-for-byte instead of held. See
  [storage-plan.md § 3.3](../../../../api-general/.docs/storage-plan.md#the-chunk-iv-is-derived-not-random)
  and the amendment in
  [ECDSA.md](../../../../api-general/.docs/crypto/ECDSA.md#sealed-blob-format).

### What the derived IV obliges

`(DEK, IV)` is unique **only because a drive DEK is used for exactly one object**. Reusing one is not
a degradation, it is a collapse: identical keystreams reveal `P₁ ⊕ P₂`, and the GHASH subkey is
recoverable from two messages under one nonce, which lets an attacker forge tags — and every defence
in the table above is a tag. `chunks.test.ts` pins the construction; **nothing outside `lib/files`
uses it**, and secrets, notes, documents and `wrapped_dek` must keep random IVs.

Three smaller things:

- **A one-chunk file is a single `PUT`, not a multipart upload.** The ticket's `multipart` flag says
  which, and `completeUpload` sends no parts for the single case.
- **Parts are sorted by number before `PATCH`**, because R2 completes a multipart in order and
  concurrent `PUT`s do not finish in one.
- **A `PUT` task never rejects.** It records the first failure and the loop raises it. A part that
  fails while others are still in flight would otherwise abandon them, and their own rejections
  would surface as *unhandled* rather than as this upload's error — visible only at
  `concurrency > 1`, which is why the first version passed its tests.
- **A missing `ETag` is caught before `PATCH`, and only for a multipart object.** A cross-origin
  response exposes only the safelisted headers, so a bucket without `ExposeHeaders: ["ETag"]` hands
  back nothing and the completion fails with `400 InvalidPart` after the whole file has uploaded.
  `assertETags` turns that into an error naming the bucket setting. A single-`PUT` object needs no
  ETag and keeps working against such a bucket.
- **A source that lies about its length is refused**, in either direction, rather than padding a
  short read or truncating a long one into an object whose hash nobody can reproduce.

## Resuming across a reload

`resumeUpload(context, row, file)` finishes an upload a previous page load started. It reads the
DEK from the row, opens the manifest, asks `GET /files/{id}/upload` which parts R2 already holds,
and then runs **the same pass `uploadFile` runs** — read, pad, seal, hash — `PUT`ting only what is
missing. The skip covers the `PUT` and nothing else: **every chunk is still sealed and folded into
the digest**, because the hash sent at `PATCH` describes the finished object rather than the bytes
this pass happened to send. That is why a resume re-reads the whole file even when one part is left.

The hard part is not the crypto, it is **proving the file is the same file**. A `File` does not
survive a reload, so the user picks it again — and nothing downstream would notice a substitution:
`PATCH` only checks the object's length, and the digest is computed over what this pass sealed. A
different source produces a stored object whose declared hash matches nothing, discovered by the
mirror worker days later. So `assertSameSource` checks size, then name, then the real test:
**re-seal chunk 1 and compare it against `first_chunk_sha256` from the manifest.** Sealing is
deterministic — derived IV, per-file DEK — so that digest is a fingerprint of the bytes, and
`uploadFile` writes it at `POST` for exactly this purpose. Name and size can coincide; this cannot.
Every refusal is a `SourceMismatchError` and happens before a single byte is sent.

**A manifest without `first_chunk_sha256` cannot be resumed** and says so, rather than falling back
to a check that only looks like one.

### Remembering the file, so a resume does not ask for it

**A browser has no file paths.** `File.name` is a name, not a location, and nothing a page can store
will reopen a file by path — that capability does not exist. What does exist is a
`FileSystemFileHandle` from `showOpenFilePicker()`: it is structured-cloneable, so it can live in
IndexedDB and reopen the same file after a reload with `getFile()`. `handles.ts` is that store, and
it is the difference between "pick the file again" and one click.

- **A handle is kept only while an upload is unfinished.** It is written when the upload starts,
  keyed by the file's id, and **deleted the moment the upload completes** — on a normal upload, on a
  resumed one, and when the file is deleted. `forgetSourcesExcept` prunes on every drive load, so a
  row that vanished elsewhere cannot leave a reference behind.
- **What it costs**: the browser stores that handle — the file's name and where it lives — in
  IndexedDB, unencrypted, because only the browser can resolve it. That is plaintext metadata at
  rest, which this product otherwise avoids; the deliberate limits are that it exists only between
  an interrupted upload and its completion, and that it names a file the user chose to upload
  seconds earlier. It is not key material and it is not content.
- **Permission is re-requested, not assumed.** After a reload the handle needs
  `requestPermission({mode: 'read'})`, which needs a user gesture — the Finish-uploading click is
  it. A refusal is not an error: `openRememberedSource` returns nothing and the caller falls back to
  the picker.
- **Firefox and Safari have no `showOpenFilePicker`**, so `chooseSources` returns `undefined`, the
  screen falls back to `<input type="file">`, no handle is ever stored, and resuming asks for the
  file. Everything else is identical, including the verification.
- **Dropped files can carry a handle too** — `DataTransferItem.getAsFileSystemHandle()` where it
  exists, plain `File`s where it does not.

**None of this weakens the check.** A remembered handle still goes through `assertSameSource`: the
file behind it can have been edited since, and `first_chunk_sha256` is what notices.

### Nothing here reads an ETag

`PartPutter` returns nothing. The server completes a multipart from R2's own `ListParts`
([Task 114](../../../../tasks.md#task-114)), so the client neither collects ETags nor sends a
`parts` array, and the bucket does not need `ETag` under CORS `ExposeHeaders`. A resumed upload
could not have supplied that list anyway — the ETags it would need belong to a page load that is
gone.

## Thumbnails are files

A preview is **an ordinary file of its own** — its own row, its own DEK, its own object key — and the
only thing that links it to its parent is `thumbnail_id` inside the parent's *sealed* manifest. The
backend therefore cannot tell a thumbnail from a small document, which is the entire point: a
`parent_id` column, or a "do not replicate" flag on `POST`, would tell it that one blob is derived
from another, and that tells it the parent is an image.

- **It is derived before the upload and uploaded after it.** `deriveThumbnail` draws the image onto
  an `OffscreenCanvas` at 320px on the longest edge and encodes JPEG at 0.72. The id is minted up
  front so the parent's manifest can carry it, but the preview is sent **after** the parent
  completes — so an upload that fails leaves no orphan row, and a preview that fails leaves a
  manifest pointing at nothing, which every reader already tolerates.
- **It must never fail an upload.** `deriveThumbnail` answers `undefined` for anything it cannot
  decode, for a browser without `OffscreenCanvas`, and for any error at all; `uploadThumbnail`
  swallows its own failure. A file with no preview shows the kind glyph, which is what every file
  did before this existed.
- **Only what a browser can decode**, and deliberately not SVG: it is a document that can execute,
  and `createImageBitmap` treats it inconsistently. HEIC is out for the same practical reason — no
  browser decodes it — which means iPhone photographs shared as HEIC get no preview.
- **Deleting a file deletes its preview**, in the same signed action: `file-delete` is variadic, so
  the parent and its thumbnail go in one signature rather than two.
- **A preview costs a whole padding bucket.** 20 KB of JPEG pads to 64 KiB and seals to 65,573
  bytes, and the quota is charged that. Five hundred photographs spend 32 MiB of a 500 MB tier on
  previews.

**The grid never shows a thumbnail as a file.** `thumbnailIdsOf` collects every `thumbnail_id` the
opened manifests point at, and those rows are dropped from the listing — client-side, because the
server has no idea which rows they are.

## The cache holds ciphertext, and that is the whole design

`cache.ts` is an origin-private file system directory of sealed objects, one file per drive `id`,
holding **exactly the bytes R2 holds**. Reading one still costs a decrypt; it costs no network.

- **Nothing on disk is plaintext.** A cache of decrypted files would put the user's content on disk
  outside their control, which is the one thing this architecture exists to prevent. The DEK stays
  in memory and is zeroed after every read.
- **A cached object can never be stale**, because a file is immutable: editing produces a new `id`.
  There is no revalidation, no ETag, no expiry — the id *is* the version.
- **A hit needs no round trip at all**, not even for the key. `GET /files` already returns every
  row's `wrapped_dek` and sealed manifest, so a preview whose bytes are cached is decrypted entirely
  from what the listing carried. A miss goes through `fetchSealedObject`, which is the only path
  that needs `GET /files/{id}` and a presigned URL.
- **Every operation degrades to a miss.** No OPFS, a refused quota, a corrupt entry: `readCachedObject`
  answers `undefined` and `writeCachedObject` answers `false`. A failed write drops the entry rather
  than leaving half of one.
- **`pruneCachedObjects` runs on every drive load** with the ids the listing returned, so a deleted
  file takes its cached bytes with it. That is also the only eviction there is today: previews are
  65,573 bytes each and a drive's worth of them is megabytes. **Caching whole originals needs a size
  cap and a least-recently-used policy first** — neither is written, because neither is needed yet.

OPFS is not durable storage: it shares the origin's quota and the browser may evict it under disk
pressure. That is correct for a cache and the reason nothing here is a source of truth.

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

**`downloadFile` still buffers the whole plaintext**, and its `maxBytes` ceiling is not the mirror of
the upload one that went away. That one existed because of the protocol; this one exists because the
function hands the caller a single `Uint8Array` to save. `decryptStream` is the unbuffered path and
already takes a `ReadableStream` — what is missing is a streaming save target (File System Access
`createWritable`, or a service worker), which is product work rather than protocol work.

## What is not here

No cache and no thumbnails; both are deferred, and
[Task 109.8](../../../tasks/tasks.md) explains why the cache is trivial when it arrives.
