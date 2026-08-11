import { assertCanonicalUuid, collectPages, request, type PageRequest } from '@/lib/api';
import { normalizeActionArgs, signActionEnvelope } from '@/lib/signing';
import { toPlainText } from '@/lib/note-format';
import { requireToken, type AuthedContext } from '@/lib/context';
import { sha256Hex, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import {
  generateDek,
  openText,
  sealText,
  vaultKekDekWrapper,
  type DekWrapper,
} from '@/lib/secrets';

export const NOTE_VERSION = 'v1';
export const MAX_NOTE_CHARACTERS = 5000;
export const MAX_CIPHERTEXT_CHARACTERS = 32768;
export const NOTE_FETCH_CONCURRENCY = 6;

export interface NoteRecord {
  id: string;
  ciphertext: string;
  wrapped_dek: string;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface NoteMetaRecord {
  id: string;
  ciphertext_sha256: string;
  ciphertext_bytes: number;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface NotesContext extends AuthedContext {
  dek?: DekWrapper;
}

function wrapper(context: NotesContext): DekWrapper {
  return context.dek ?? vaultKekDekWrapper(context.session.vaultKek);
}

export function noteCharacterCount(text: string): number {
  return Array.from(toPlainText(text)).length;
}

function assertWithinCharacterLimit(text: string): string {
  const characters = noteCharacterCount(text);
  if (characters > MAX_NOTE_CHARACTERS) {
    throw new Error(
      `note is ${characters} characters, over the ${MAX_NOTE_CHARACTERS}-character limit`,
    );
  }
  return text;
}

function assertWithinCiphertextCeiling(ciphertext: string): string {
  if (ciphertext.length > MAX_CIPHERTEXT_CHARACTERS) {
    throw new Error(
      `sealed note is ${ciphertext.length} characters, over the server ceiling of ${MAX_CIPHERTEXT_CHARACTERS}`,
    );
  }
  return ciphertext;
}

export interface CreateNoteResult {
  note: NoteRecord;
  created: boolean;
}

export async function createNote(
  context: NotesContext,
  plaintext: string,
  options: { id?: string } = {},
): Promise<CreateNoteResult> {
  assertWithinCharacterLimit(plaintext);

  const id = options.id === undefined ? crypto.randomUUID() : assertCanonicalUuid(options.id);
  const dek = generateDek();

  try {
    const ciphertext = assertWithinCiphertextCeiling(await sealText(plaintext, dek));
    const wrapped_dek = await wrapper(context).wrapDek(dek);

    const response = await request<NoteRecord>({
      method: 'POST',
      path: '/notes',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: { id, ciphertext, wrapped_dek, version: NOTE_VERSION },
    });

    return { note: response.data, created: response.status === 201 };
  } finally {
    zeroBytes(dek);
  }
}

export async function updateNote(
  context: NotesContext,
  note: NoteRecord,
  plaintext: string,
): Promise<NoteRecord> {
  assertWithinCharacterLimit(plaintext);

  const id = assertCanonicalUuid(note.id);
  const dek = await wrapper(context).unwrapDek(note.wrapped_dek);

  try {
    const ciphertext = assertWithinCiphertextCeiling(await sealText(plaintext, dek));

    const response = await request<NoteRecord>({
      method: 'PUT',
      path: `/notes/${id}`,
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: { ciphertext, wrapped_dek: note.wrapped_dek, version: note.version || NOTE_VERSION },
    });

    return response.data;
  } finally {
    zeroBytes(dek);
  }
}

export async function saveNote(
  context: NotesContext,
  plaintext: string,
  target: { id: string; record?: NoteRecord },
): Promise<NoteRecord> {
  if (target.record !== undefined) {
    return updateNote(context, target.record, plaintext);
  }

  const result = await createNote(context, plaintext, { id: target.id });
  return result.created ? result.note : updateNote(context, result.note, plaintext);
}

export async function listNotesMeta(
  context: NotesContext,
  options: { limit?: number } = {},
): Promise<NoteMetaRecord[]> {
  return collectPages<NoteMetaRecord>(
    (page: PageRequest) =>
      request<NoteMetaRecord[]>({
        method: 'GET',
        path: '/notes',
        query: { limit: page.limit, cursor: page.cursor },
        token: requireToken(context),
        timeoutMs: context.timeoutMs,
      }),
    { limit: options.limit },
  );
}

export async function getNote(context: NotesContext, id: string): Promise<NoteRecord> {
  const response = await request<NoteRecord>({
    method: 'GET',
    path: `/notes/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function listNotes(
  context: NotesContext,
  options: { limit?: number } = {},
): Promise<NoteRecord[]> {
  const meta = await listNotesMeta(context, options);
  return mapBounded(meta, NOTE_FETCH_CONCURRENCY, (entry) => getNote(context, entry.id));
}

export async function openNote(context: NotesContext, note: NoteRecord): Promise<string> {
  const dek = await wrapper(context).unwrapDek(note.wrapped_dek);
  try {
    return await openText(note.ciphertext, dek);
  } finally {
    zeroBytes(dek);
  }
}

export async function deleteNote(context: NotesContext, id: string): Promise<void> {
  const canonical = assertCanonicalUuid(id);

  const envelope = signActionEnvelope(
    'note-delete',
    [canonical],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  await request<void>({
    method: 'DELETE',
    path: `/notes/${canonical}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: envelope,
  });
}

export interface BatchDeleteNotesResult {
  requested: number;
  deleted: number;
}

export async function deleteNotes(
  context: NotesContext,
  ids: readonly string[],
): Promise<BatchDeleteNotesResult> {
  const canonical = ids.map((id) => assertCanonicalUuid(id));
  const normalized = normalizeActionArgs('note-delete', canonical);

  const envelope = signActionEnvelope(
    'note-delete',
    normalized,
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<BatchDeleteNotesResult>({
    method: 'DELETE',
    path: '/notes',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ids: normalized, ...envelope },
  });

  return response.data;
}

export async function hashReceivedCiphertext(ciphertext: string): Promise<string> {
  return sha256Hex(utf8ToBytes(ciphertext));
}

async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}
