# `lib/notes` — the notes domain

The `/notes` endpoints and the per-note encryption around them. Backed by
[`api-general/internal/domain/notes/README.md`](../../../../api-general/internal/domain/notes/README.md),
which is derived from the Go implementation and is the wire contract this module is built to.

## Why this is not `lib/secrets`

A note is structurally what a secret is — a `ciphertext`, a `wrapped_dek`, a `version` — and it
uses the **same vault KEK and the same sealed-blob codec**, imported from
[`lib/secrets`](../secrets/README.md) rather than re-derived here.

One thing separates them: **notes get edited.** `POST /secrets` is create-or-return and there is
no `PUT /secrets`, because a seed phrase is written once. A letter is revised. `PUT /notes/{id}`
is the entire reason the domain exists.

## The DEK must survive the edit

This is the sharpest edge in the domain, and the server cannot defend against it.

When an heir is assigned a note, `inheritance_shares.pq_hybrid_encrypted_item_key` holds that
note's DEK wrapped to the heir's public keys. Generating a **fresh** DEK on edit leaves that
stored value unwrapping to the *old* DEK, which no longer opens the new ciphertext. Both fields
are opaque, so nothing server-side notices — the inheritance is broken and stays silent until a
release, the one moment the owner is not around to fix it.

`updateNote` therefore takes the **stored `NoteRecord`**, not just an id:

```
unwrapDek(note.wrapped_dek) → re-seal the new plaintext under that same DEK
                            → PUT with the byte-identical note.wrapped_dek
```

`notes.test.ts` pins both halves: that `wrapped_dek` on the wire is identical to the stored one,
and that the pre-edit `wrapped_dek` still opens the post-edit ciphertext.

If a note's DEK ever genuinely needs rotating, every affected share must be re-assigned via
`POST /succession/shares` in the same operation. Nothing here does that, so nothing here rotates.

## Two different limits, and only one of them is real

`MAX_NOTE_CHARACTERS = 5000` is the **product** rule and it is enforced only here — the server
never sees plaintext and cannot count characters. It counts **code points**, so a note of 5000
emoji is allowed rather than rejected as 20,000 bytes, and it counts them over
`toPlainText(stored)` rather than the stored string: the editor is WYSIWYG, so the line markers
are invisible and charging the user for them would make the counter drop for no visible reason.
That is the one place this domain reaches into
[`lib/note-format`](../note-format/README.md) — the rule is about what a person wrote, so it has
to be measured in what a person sees.

`MAX_CIPHERTEXT_CHARACTERS = 32768` mirrors the server's `service.MaxCiphertextChars`, the
ceiling on the base64 ciphertext string. It is derived from the worst case of the rule above
(5000 four-byte UTF-8 characters seal to 26,708 base64 chars) — checking it locally converts a
bug into a legible error instead of an opaque `400 BAD_REQUEST`.

Since the visible count ignores markers, it is now the ceiling — not the character rule — that
bounds what actually gets stored. A pathological document (thousands of one-character checklist
lines) could carry enough marker overhead to approach 32,768 while reading as under 5,000, so
this check is what makes the friendlier count safe rather than merely nicer.

Both are checked before any network call. **Do not tighten either to "enforce" the other**;
encrypted length is a function of the plaintext's encoding, and a tighter bound rejects
legitimate notes written in non-Latin scripts.

## Authorization is deliberately uneven

| Operation | Proof required |
| --- | --- |
| `createNote`, `updateNote`, `listNotes`, `getNote` | JWT only |
| `deleteNote`, `deleteNotes` | JWT **and** a `note-delete` signed action |

Creating and editing are additive; deleting is irreversible and also destroys every
`inheritance_shares` row pointing at that note, in the same server-side transaction. So delete
carries the same proof-of-seed-key `DELETE /secrets/{id}` carries, plus the second factor in
Paranoid Mode.

`note-delete` signs the note ids as its arguments, so a signature captured for one note cannot
delete another. It is **variadic**, exactly like `secret-delete`: the batch route signs the whole
set at once and the single route is the one-element case of the same label — see below.

## `saveNote` — one call the autosave loop can fire repeatedly

The editor autosaves after two seconds of inactivity, which means the same note is written many
times and the *first* of those writes is a create while the rest are updates. `saveNote` is that
one entry point:

```ts
saveNote(context, text, { id, record })   // record present → PUT; absent → POST, then maybe PUT
```

Two things it exists to get right, both invisible in the happy path:

**The id is the caller's, generated once when the blank editor opens.** Not per save. `POST
/notes` without an `id` is *not* idempotent — every call makes a new note with a server-generated
UUID — so an autosave that timed out and retried would leave two notes, each separately
assignable to heirs, with nothing to dedupe them.

**A `200` from the create is followed by a `PUT`.** This is the non-obvious half. `POST /notes`
is create-or-return, not upsert: replaying an id with *different* `ciphertext` keeps the stored
row and **silently discards** what was just sent. Under autosave that is a live data-loss path —
the first save times out after the server stored it, the user keeps typing, the retry carries
newer text and gets back the older row. Answering a `created === false` with an immediate
`updateNote` forces the newer text through. `createNote` alone is still the right call for any
caller that genuinely wants create-or-return semantics.

Concurrency is the **caller's** responsibility: `saveNote` does not serialize itself, and two
overlapping calls on a not-yet-created note would both `POST`. `NotesScreen` holds a single
in-flight guard, which is why this stays a plain async function here.

## `deleteNotes` — one signature for the whole selection

`DELETE /notes` takes an `ids` array and **one** signed action, so a multi-select delete costs one
seed prompt instead of N. It shares the `note-delete` label with `DELETE /notes/{id}`, which is
therefore the one-element case of the same action — exactly the arrangement `secrets` has.

**The ids are sorted ascending and de-duplicated before the payload is signed**, because
`canonicalIDs` in `notes/service/service.go` rebuilds them that way (`sort.Strings`, over a map)
before handing them to `VerifySignedAction`. Sign any other order and the signature is rejected.
`normalizeActionArgs('note-delete', ids)` does exactly this, driven by the `variadic: true` flag
in the action table, so the sorting is not restated here — and the **same normalized array is
what goes on the wire**, so what you send and what you sign are the same bytes.

Two guards happen locally, before anything is signed:

- Every id is checked canonical. The handler rejects a non-canonical id with `400 INVALID_PARAM`
  before the service runs, so nothing is deleted, but failing here keeps the error legible.
- An empty selection throws rather than spending a request. The server answers an empty `ids`
  with `404`, which would surface as the wrong message entirely.

**`deleted` coming back lower than `requested` is not an error.** The `DELETE ... WHERE user_id`
is owner-scoped in SQL, so an id that is not yours simply does not match, and `requested` is the
count *after* de-duplication, not the length of what you passed. The realistic cause in this UI —
where the selection comes from the user's own grid — is that the note was already deleted
somewhere else, which is why `batchDeleteSummary` in [`lib/app`](../app/README.md) says "already
gone" rather than "try again".

Like the single delete, the batch destroys the matching `inheritance_shares` rows in the same
`ReadCommitted` transaction (`deleteScoped`), and the response does not say how many went with
them — so treat any cached `share_count` as stale afterwards.

## Listing costs two round trips per note, on purpose

`GET /notes` is metadata-only and paginated: a 5000-character note is 6.7–26 KB of base64, which
Postgres stores out-of-line in TOAST, so a listing that selected `ciphertext` would detoast the
whole account on every page load.

The UI shows real content in each file miniature, so `listNotes` pages the metadata to
exhaustion via `collectPages` (**a short page is not the last page**) and then fetches each full
note through `getNote`, bounded to `NOTE_FETCH_CONCURRENCY = 6` in flight. `listNotesMeta` is
exported separately for any caller that only needs the index.

## API

| Function | Endpoint | Notes |
| --- | --- | --- |
| `createNote` | `POST /notes` | Client-generated `id`; `201` created / `200` already stored |
| `updateNote` | `PUT /notes/{id}` | Reuses the stored DEK and `wrapped_dek`; strict update, never an upsert |
| `saveNote` | either | The autosave entry point — see below |
| `listNotesMeta` | `GET /notes` | Paginated metadata index |
| `listNotes` | `GET /notes` + `GET /notes/{id}` | Metadata, then bounded full fetches |
| `getNote` | `GET /notes/{id}` | |
| `openNote` | — | `unwrapDek` + decrypt |
| `deleteNote` | `DELETE /notes/{id}` | `note-delete`, one-element case; JSON body required |
| `deleteNotes` | `DELETE /notes` | `note-delete`, batch; one signature for the selection |
| `hashReceivedCiphertext` | — | Hash what you received, not `ciphertext_sha256` |

`NotesContext` extends `AuthedContext` with the same optional `dek: DekWrapper` test seam
`SecretsContext` has; omitted, it is `vaultKekDekWrapper(context.session.vaultKek)`.

## Rules inherited from the wire contract

- **Always send a client-generated `id`.** The insert is `ON CONFLICT DO NOTHING … RETURNING`, so
  replaying an identical body yields one note and `created === false`. Omit the `id` and a
  retried timeout leaves **two** notes, each separately assignable to heirs.
- **`POST` is create-or-return, not upsert.** Replaying an id with a different `ciphertext`
  changes nothing and returns the stored row. Editing goes through `PUT`.
- **`PUT` to an unknown id is `404` and creates nothing** — resurrecting a note whose
  `inheritance_shares` were already cascade-deleted is a state the server refuses to enter.
- **`404` means "absent *or* not yours"**, deliberately indistinguishable.
- **Ids are rejected, never normalized** — the id the client signs for a delete must be the id
  the server verifies.
- A note rejected for being oversized is **indistinguishable on the wire** from one rejected for
  a missing field: both are `400 {"code":"BAD_REQUEST"}`.

## Assigning a note to an heir

Built in [`lib/succession`](../succession/README.md), not here: `inheritableNote(note)` turns a
`NoteRecord` into the `{ type, id, wrappedDek }` shape `assignShare` takes, and the note's
`wrapped_dek` is unwrapped and re-wrapped to the heir's PQXDH keys like any other item.

The consequence for this module is the **DEK-reuse contract on edit**: editing a note keeps its
id and its DEK, so a share assigned to an heir stays valid across every edit. Rotating a note's
DEK would silently invalidate it — which is why `updateNote` sends back the same `wrapped_dek`
it was given, and why the tests pin that in both directions.

## Tests

`notes.test.ts` covers: the client-generated id and the `201`/`200` split; that plaintext never
reaches the wire and that create/edit carry no signature or password; the code-point character
count and both limits; canonical-id enforcement on every path; the `openNote` round trip; the
DEK-reuse contract on edit in both directions; version carry-forward; cursor following including
the short-page case; the bounded full-note fetch; and for delete, that the signature verifies
over `note-delete:<id>`, fails for a different id, and carries `password` only in Paranoid Mode.

For `deleteNotes`: that the whole selection goes in one request under one signature; that ids are
sorted and de-duplicated on the wire *and* in the signed payload; that a signature over the
**submitted** order does not verify while the sorted one does; that the batch and the single
route produce interchangeable one-element signatures; that `deleted < requested` is read from the
body rather than treated as an error; and that an invalid id or an empty selection is refused
before anything is signed.

For `saveNote` specifically: that the first save `POST`s with the caller's id and later saves
reuse it; that a `200` create-or-return is followed by a `PUT` whose ciphertext really does open
to the newer text; that a `201` is *not* followed by a redundant `PUT`; and that both paths
refuse an over-limit draft before any request.
