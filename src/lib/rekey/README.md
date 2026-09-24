# `lib/rekey` — re-wrapping what a rotation left behind

[Task 130](../../../../tasks-closed.md#task-130). A `keyring-rotate` mints a new scope KEK, but every item
already stored stays wrapped under the generation it was written with. This module walks those
items and re-wraps their DEKs under the current one.

**It is the only module that reaches into all four item domains**, which is why it is its own
module rather than something in [`lib/keyrings`](../keyrings/README.md): the item domains import
`lib/keyrings`, so the seam has to sit above them, the way [`lib/account`](../account/README.md)
does.

## What it is for

A removed device knows the generations it held. It can no longer fetch anything — its token is
refused as soon as the chain says it is gone — but a **database leak** together with that device's
keys would open every item still wrapped under a generation it knew. Rotating closes the door;
re-wrapping is what actually moves the items behind it.

**It is not a re-encryption.** The item's DEK never changes and no ciphertext is touched, so
nothing is re-uploaded — a 4 GiB file is re-wrapped by sending 84 bytes. That also bounds what this
buys: an attacker who already holds an item's *DEK* is unaffected. Re-encrypting under a fresh DEK
is the stronger move and is not what this is.

## The API

| Export | What |
| --- | --- |
| `rewrapScope(context, scope)` | Lists one scope, re-wraps everything below the current generation, returns `{scope, requested, rekeyed}` |
| `rewrapAfterRotation(context, scopes)` | The scopes a batch rotated, filtered to item scopes this device holds, in order |
| `staleItems(items, generation)` | The items below `generation`, sorted by id |
| `batched(items, size)` | Splits into `REKEY_BATCH_SIZE` batches |

`removeOtherDevices` ([`lib/account`](../account/README.md)) returns the scopes its batch rotated,
and `DevicesScreen` passes them straight to `rewrapAfterRotation`.

## Why the listings carry `wrapped_dek`

Every one of the four listings this module reads — `GET /secrets?fields=meta`, `GET /notes`,
`GET /documents`, `GET /files` — returns `wrapped_dek` and `key_generation` beside the id. Without
them there is no way to tell which items a rotation left behind except to download every item and
look, which for documents means every snapshot and for files every object. A wrap is 84 bytes.

## What it refuses to do

- **One signature per batch, capped at `REKEY_BATCH_SIZE`.** The ids are sorted ascending and the
  server rebuilds the list the same way, exactly as the batch deletes do.
- **Never two wraps for one id.** The server refuses such a batch (`404`) rather than
  de-duplicating it, because the signature covers only the ids and could not say which wrap was
  meant. This module cannot produce one — it re-wraps each listed item once.
- **A file still uploading is skipped** (`r2_state !== 'ok'`). Its upload is still in flight and
  will carry the current generation itself; a row the drive has not finished storing has nothing
  worth re-wrapping.
- **A scope this device does not hold is skipped**, and left to a device that does.

## What is still open

- **Enrolment is not covered.** `buildEnrolment` can remove devices and rotate in the same batch
  ("I lost my devices"), and that path does not run a re-wrap yet — the session is still being
  established when the batch lands. The next unlock is where it belongs.
- **Nothing retries.** A re-wrap that fails half way leaves the rest stale, and the next rotation's
  pass picks them up because staleness is computed from the listing rather than remembered. That is
  the intended shape, not a gap, but it does mean a failure is silent until then.
