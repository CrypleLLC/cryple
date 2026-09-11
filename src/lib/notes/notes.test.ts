import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import {
  createNote,
  deleteNote,
  deleteNotes,
  getNote,
  hashReceivedCiphertext,
  listNotes,
  listNotesMeta,
  noteCharacterCount,
  openNote,
  saveNote,
  updateNote,
  MAX_NOTE_CHARACTERS,
  NOTE_VERSION,
  type NoteRecord,
  type NotesContext,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;
const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const publicKey = tree.identity.publicKeyUncompressed;

const ID_A = '0c892e57-93cf-423a-a9e9-fee5a9f87681';
const ID_B = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const ID_C = 'ba7816bf-8f01-4fea-9411-2b4c3f5a1e77';

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method as string,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const spec = specs[Math.min(index++, specs.length - 1)];
      const text = spec.body === undefined ? '' : JSON.stringify(spec.body);
      return {
        status: spec.status,
        ok: spec.status >= 200 && spec.status < 300,
        text: async () => text,
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );

  return calls;
}

async function newContext(options: { paranoid?: boolean } = {}): Promise<NotesContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid: options.paranoid ?? true };
}

const storedNote: NoteRecord = {
  id: ID_A,
  ciphertext: 'AXh4eHh4eHh4eHh4Y2lwaGVy',
  wrapped_dek: 'd3JhcHBlZA==',
  version: 'v1',
  created_at: '2026-08-01T12:00:00Z',
  updated_at: '2026-08-01T12:00:00Z',
};

async function sealedRecord(context: NotesContext, plaintext: string): Promise<NoteRecord> {
  const calls = mockFetch({ status: 201, body: { data: storedNote } });
  await createNote(context, plaintext, { id: ID_A });

  return {
    ...storedNote,
    ciphertext: calls[0].body!.ciphertext as string,
    wrapped_dek: calls[0].body!.wrapped_dek as string,
  };
}

function meta(id: string, updatedAt: string) {
  return {
    id,
    ciphertext_sha256: 'a'.repeat(64),
    ciphertext_bytes: 128,
    version: 'v1',
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /notes', () => {
  it('sends a client-generated id, which is what makes the retry safe', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedNote } });

    await createNote(await newContext(), 'a letter');

    const body = calls[0].body!;
    expect(calls[0].url).toBe('http://localhost:8080/notes');
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.version).toBe(NOTE_VERSION);
  });

  it('distinguishes 201 created from 200 already stored', async () => {
    mockFetch({ status: 201, body: { data: storedNote } });
    expect((await createNote(await newContext(), 'x')).created).toBe(true);

    mockFetch({ status: 200, body: { data: storedNote } });
    expect((await createNote(await newContext(), 'x', { id: ID_A })).created).toBe(false);
  });

  it('never puts the plaintext on the wire', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedNote } });

    await createNote(await newContext(), 'dear family, the safe code is 4417');
    expect(JSON.stringify(calls[0].body)).not.toContain('dear family');
  });

  it('creates and posts no signed action — the JWT alone authorizes it', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedNote } });

    await createNote(await newContext(), 'x');
    expect(calls[0].body).not.toHaveProperty('signature');
    expect(calls[0].body).not.toHaveProperty('password');
  });

  it('refuses a note over the 5000-character product limit', async () => {
    mockFetch({ status: 201, body: { data: storedNote } });
    await expect(
      createNote(await newContext(), 'x'.repeat(MAX_NOTE_CHARACTERS + 1)),
    ).rejects.toThrow(/character limit/);
  });

  it('counts characters by code point, so a 5000-emoji note is allowed', async () => {
    expect(noteCharacterCount('😀😀')).toBe(2);

    const calls = mockFetch({ status: 201, body: { data: storedNote } });
    await createNote(await newContext(), '😀'.repeat(MAX_NOTE_CHARACTERS));
    expect(calls).toHaveLength(1);
  });

  it('refuses a non-canonical supplied id', async () => {
    mockFetch({ status: 201, body: { data: storedNote } });
    await expect(createNote(await newContext(), 'x', { id: ID_A.toUpperCase() })).rejects.toThrow(
      /canonical/,
    );
  });

  it('round-trips through openNote', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedNote } });
    const context = await newContext();

    await createNote(context, 'the real letter');
    const echoed: NoteRecord = {
      ...storedNote,
      ciphertext: calls[0].body!.ciphertext as string,
      wrapped_dek: calls[0].body!.wrapped_dek as string,
    };

    expect(await openNote(context, echoed)).toBe('the real letter');
  });
});

describe('PUT /notes/{id}', () => {
  it('re-seals under the stored DEK and returns a byte-identical wrapped_dek', async () => {
    const created = mockFetch({ status: 201, body: { data: storedNote } });
    const context = await newContext();

    await createNote(context, 'first draft');
    const stored: NoteRecord = {
      ...storedNote,
      ciphertext: created[0].body!.ciphertext as string,
      wrapped_dek: created[0].body!.wrapped_dek as string,
    };

    const edits = mockFetch({ status: 200, body: { data: stored } });
    await updateNote(context, stored, 'second draft');

    const body = edits[0].body!;
    expect(edits[0].method).toBe('PUT');
    expect(edits[0].url).toBe(`http://localhost:8080/notes/${ID_A}`);
    expect(body.wrapped_dek).toBe(stored.wrapped_dek);
    expect(body.ciphertext).not.toBe(stored.ciphertext);

    const reSealed: NoteRecord = { ...stored, ciphertext: body.ciphertext as string };
    expect(await openNote(context, reSealed)).toBe('second draft');
  });

  it('reuses the DEK across edits: the old wrapped_dek still opens the new ciphertext', async () => {
    const created = mockFetch({ status: 201, body: { data: storedNote } });
    const context = await newContext();

    await createNote(context, 'v1');
    const beforeEdit: NoteRecord = {
      ...storedNote,
      ciphertext: created[0].body!.ciphertext as string,
      wrapped_dek: created[0].body!.wrapped_dek as string,
    };

    const edits = mockFetch({ status: 200, body: { data: beforeEdit } });
    await updateNote(context, beforeEdit, 'v2');

    const afterEdit: NoteRecord = {
      ...beforeEdit,
      ciphertext: edits[0].body!.ciphertext as string,
    };

    expect(await openNote(context, afterEdit)).toBe('v2');
  });

  it('carries the note version forward rather than assuming v1', async () => {
    const created = mockFetch({ status: 201, body: { data: storedNote } });
    const context = await newContext();
    await createNote(context, 'x');

    const stored: NoteRecord = {
      ...storedNote,
      version: 'v2',
      ciphertext: created[0].body!.ciphertext as string,
      wrapped_dek: created[0].body!.wrapped_dek as string,
    };

    const edits = mockFetch({ status: 200, body: { data: stored } });
    await updateNote(context, stored, 'y');
    expect(edits[0].body!.version).toBe('v2');
  });

  it('refuses an over-limit edit before touching the network', async () => {
    const calls = mockFetch({ status: 200, body: { data: storedNote } });
    await expect(
      updateNote(await newContext(), storedNote, 'x'.repeat(MAX_NOTE_CHARACTERS + 1)),
    ).rejects.toThrow(/character limit/);
    expect(calls).toHaveLength(0);
  });
});

describe('saveNote — the autosave entry point', () => {
  it('creates on the first save, with the caller-owned id', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedNote } });

    await saveNote(await newContext(), 'first keystrokes', { id: ID_A });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body!.id).toBe(ID_A);
  });

  it('reuses that same id across autosaves, so a replayed create cannot fork the note', async () => {
    const created = mockFetch({ status: 201, body: { data: storedNote } });
    const context = await newContext();

    await saveNote(context, 'a', { id: ID_A });
    await saveNote(context, 'ab', { id: ID_A });

    expect(created[0].body!.id).toBe(ID_A);
    expect(created[1].body!.id).toBe(ID_A);
  });

  it('follows a 200 create-or-return with a PUT, so the newer text is not silently discarded', async () => {
    const context = await newContext();
    const alreadyStored = await sealedRecord(context, 'the text the server kept');

    const calls = mockFetch(
      { status: 200, body: { data: alreadyStored } },
      { status: 200, body: { data: alreadyStored } },
    );

    await saveNote(context, 'text typed after the timeout', { id: ID_A });

    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('POST');
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].url).toBe(`http://localhost:8080/notes/${ID_A}`);
    expect(calls[1].body!.wrapped_dek).toBe(alreadyStored.wrapped_dek);

    const reSealed: NoteRecord = {
      ...alreadyStored,
      ciphertext: calls[1].body!.ciphertext as string,
    };
    expect(await openNote(context, reSealed)).toBe('text typed after the timeout');
  });

  it('does not follow a 201 with a redundant PUT', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedNote } });

    await saveNote(await newContext(), 'fresh note', { id: ID_A });
    expect(calls).toHaveLength(1);
  });

  it('goes straight to PUT once the note has a stored record', async () => {
    const context = await newContext();
    const stored = await sealedRecord(context, 'first draft');

    const calls = mockFetch({ status: 200, body: { data: stored } });
    await saveNote(context, 'edited', { id: ID_A, record: stored });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body!.wrapped_dek).toBe(stored.wrapped_dek);
  });

  it('refuses an over-limit autosave on both paths, before any request', async () => {
    const tooLong = 'x'.repeat(MAX_NOTE_CHARACTERS + 1);

    const creating = mockFetch({ status: 201, body: { data: storedNote } });
    await expect(saveNote(await newContext(), tooLong, { id: ID_A })).rejects.toThrow(
      /character limit/,
    );
    expect(creating).toHaveLength(0);

    const updating = mockFetch({ status: 200, body: { data: storedNote } });
    await expect(
      saveNote(await newContext(), tooLong, { id: ID_A, record: storedNote }),
    ).rejects.toThrow(/character limit/);
    expect(updating).toHaveLength(0);
  });
});

describe('reads', () => {
  it('follows next_cursor until has_more is false', async () => {
    const calls = mockFetch(
      {
        status: 200,
        body: {
          data: [meta(ID_A, '2026-08-01T12:00:00Z')],
          page: { has_more: true, next_cursor: 'opaque-cursor' },
        },
      },
      { status: 200, body: { data: [meta(ID_B, '2026-08-02T12:00:00Z')], page: { has_more: false } } },
    );

    expect(await listNotesMeta(await newContext())).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('cursor=opaque-cursor');
  });

  it('treats a short page as more to come, not the last page', async () => {
    mockFetch(
      { status: 200, body: { data: [], page: { has_more: true, next_cursor: 'c' } } },
      { status: 200, body: { data: [meta(ID_A, '2026-08-01T12:00:00Z')], page: { has_more: false } } },
    );

    expect(await listNotesMeta(await newContext())).toHaveLength(1);
  });

  it('returns an empty array for an account with no notes', async () => {
    mockFetch({ status: 200, body: { data: [] } });
    expect(await listNotesMeta(await newContext())).toEqual([]);
  });

  it('fetches every full note behind the metadata listing', async () => {
    const calls = mockFetch(
      {
        status: 200,
        body: {
          data: [meta(ID_A, '2026-08-01T12:00:00Z'), meta(ID_B, '2026-08-02T12:00:00Z')],
          page: { has_more: false },
        },
      },
      { status: 200, body: { data: storedNote } },
    );

    const records = await listNotes(await newContext());

    expect(records).toHaveLength(2);
    expect(calls[1].url).toBe(`http://localhost:8080/notes/${ID_A}`);
    expect(calls[2].url).toBe(`http://localhost:8080/notes/${ID_B}`);
  });

  it('reads a single note by canonical id and rejects any other spelling', async () => {
    const calls = mockFetch({ status: 200, body: { data: storedNote } });
    expect((await getNote(await newContext(), ID_A)).id).toBe(ID_A);
    expect(calls[0].url).toBe(`http://localhost:8080/notes/${ID_A}`);

    await expect(getNote(await newContext(), `urn:uuid:${ID_A}`)).rejects.toThrow(/canonical/);
  });

  it('hashes the ciphertext you received rather than trusting ciphertext_sha256', async () => {
    const digest = await hashReceivedCiphertext(storedNote.ciphertext);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashReceivedCiphertext('tampered')).not.toBe(digest);
  });
});

describe('DELETE /notes/{id}', () => {
  it('sends a required body carrying the note-delete signature over that id', async () => {
    const calls = mockFetch({ status: 204 });
    await deleteNote(await newContext(), ID_A);

    const body = calls[0].body!;
    expect(calls[0].method).toBe('DELETE');
    expect(
      verifyPayload(
        buildActionPayload(body.challenge as string, body.timestamp as number, 'note-delete', [
          ID_A,
        ]),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('binds the signature to one note — it does not verify for another id', async () => {
    const calls = mockFetch({ status: 204 });
    await deleteNote(await newContext(), ID_A);

    const body = calls[0].body!;
    expect(
      verifyPayload(
        buildActionPayload(body.challenge as string, body.timestamp as number, 'note-delete', [
          ID_B,
        ]),
        body.signature as string,
        publicKey,
      ),
    ).toBe(false);
  });

  it('attaches password only on a Paranoid account', async () => {
    const paranoid = mockFetch({ status: 204 });
    await deleteNote(await newContext({ paranoid: true }), ID_A);
    expect(paranoid[0].body).toHaveProperty('password');

    const standard = mockFetch({ status: 204 });
    await deleteNote(await newContext({ paranoid: false }), ID_A);
    expect(standard[0].body).not.toHaveProperty('password');
  });

  it('refuses a non-canonical id', async () => {
    mockFetch({ status: 204 });
    await expect(deleteNote(await newContext(), 'nope')).rejects.toThrow(/canonical/);
  });
});

describe('DELETE /notes (batch)', () => {
  it('deletes the whole selection in one request, under one signature', async () => {
    const calls = mockFetch({ status: 200, body: { data: { requested: 2, deleted: 2 } } });

    const result = await deleteNotes(await newContext(), [ID_A, ID_B]);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('http://localhost:8080/notes');
    expect(result).toEqual({ requested: 2, deleted: 2 });
  });

  it('sorts and de-duplicates before signing, because the server rebuilds the payload that way', async () => {
    const calls = mockFetch({ status: 200, body: { data: { requested: 3, deleted: 3 } } });

    await deleteNotes(await newContext(), [ID_C, ID_A, ID_B, ID_A]);

    const body = calls[0].body!;
    expect(body.ids).toEqual([ID_A, ID_B, ID_C]);
    expect(
      verifyPayload(
        buildActionPayload(body.challenge as string, body.timestamp as number, 'note-delete', [
          ID_A,
          ID_B,
          ID_C,
        ]),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('signs the sorted order specifically — the submitted order does not verify', async () => {
    const calls = mockFetch({ status: 200, body: { data: { requested: 3, deleted: 3 } } });

    await deleteNotes(await newContext(), [ID_C, ID_A, ID_B]);

    const body = calls[0].body!;
    const asSubmitted = [
      body.challenge as string,
      body.timestamp as number,
      'note-delete',
      ID_C,
      ID_A,
      ID_B,
    ].join(':');

    expect(verifyPayload(asSubmitted, body.signature as string, publicKey)).toBe(false);
    expect(
      verifyPayload(
        buildActionPayload(body.challenge as string, body.timestamp as number, 'note-delete', [
          ID_A,
          ID_B,
          ID_C,
        ]),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('shares the note-delete label with the single-note route', async () => {
    const batch = mockFetch({ status: 200, body: { data: { requested: 1, deleted: 1 } } });
    await deleteNotes(await newContext(), [ID_A]);

    const single = mockFetch({ status: 204 });
    await deleteNote(await newContext(), ID_A);

    for (const body of [batch[0].body!, single[0].body!]) {
      expect(
        verifyPayload(
          buildActionPayload(body.challenge as string, body.timestamp as number, 'note-delete', [
            ID_A,
          ]),
          body.signature as string,
          publicKey,
        ),
      ).toBe(true);
    }
  });

  it('reads the 200 body — deleted below requested is not an error', async () => {
    mockFetch({ status: 200, body: { data: { requested: 3, deleted: 1 } } });

    expect(await deleteNotes(await newContext(), [ID_A, ID_B, ID_C])).toEqual({
      requested: 3,
      deleted: 1,
    });
  });

  it('attaches password only on a Paranoid account', async () => {
    const paranoid = mockFetch({ status: 200, body: { data: { requested: 1, deleted: 1 } } });
    await deleteNotes(await newContext({ paranoid: true }), [ID_A]);
    expect(paranoid[0].body).toHaveProperty('password');

    const standard = mockFetch({ status: 200, body: { data: { requested: 1, deleted: 1 } } });
    await deleteNotes(await newContext({ paranoid: false }), [ID_A]);
    expect(standard[0].body).not.toHaveProperty('password');
  });

  it('refuses a non-canonical id before signing anything', async () => {
    const calls = mockFetch({ status: 200, body: { data: { requested: 1, deleted: 1 } } });

    await expect(deleteNotes(await newContext(), [ID_A, 'nope'])).rejects.toThrow(/canonical/);
    expect(calls).toHaveLength(0);
  });

  it('refuses an empty selection locally rather than spending a request on a 404', async () => {
    const calls = mockFetch({ status: 200, body: { data: { requested: 0, deleted: 0 } } });

    await expect(deleteNotes(await newContext(), [])).rejects.toThrow(/at least one/);
    expect(calls).toHaveLength(0);
  });
});
