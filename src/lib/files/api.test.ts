import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { ApiError, TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import type { AuthedContext } from '@/lib/context';
import {
  abandonUpload,
  completeUpload,
  createFile,
  declaredLayoutFor,
  deleteFile,
  deleteFiles,
  getFileDownload,
  getStorageUsage,
  getUploadState,
  listFiles,
} from './api';
import { fits, isInVault, isReplicated, remainingBytes } from './records';
import { layoutFor } from './layout';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = '481937';

interface FakeResponse {
  status: number;
  body?: unknown;
}

function mockFetch(...responses: FakeResponse[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const spec = responses[Math.min(index++, responses.length - 1)];
      return {
        status: spec.status,
        ok: spec.status >= 200 && spec.status < 300,
        text: async () => (spec.body === undefined ? '' : JSON.stringify(spec.body)),
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );

  return calls;
}

async function newContext(paranoid = false): Promise<AuthedContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid };
}

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SHA = 'a'.repeat(64);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    ciphertext: 'sealed',
    wrapped_dek: 'wrapped',
    size_bytes: 65_573,
    ciphertext_sha256: SHA,
    version: 'v1',
    r2_state: 'pending',
    gcs_state: 'pending',
    created_at: '2026-09-09T10:00:00Z',
    updated_at: '2026-09-09T10:00:00Z',
    ...overrides,
  };
}

function body(data: unknown) {
  return { message: 'ok', data };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_BASE_API_URL;
});

describe('creating a file', () => {
  it('sends a client-generated id so a retry cannot mint a second object', async () => {
    const calls = mockFetch({ status: 201, body: body(row()) });
    const context = await newContext();

    await createFile(context, {
      ciphertext: 'sealed',
      wrapped_dek: 'wrapped',
      ...declaredLayoutFor(40_000)
    });

    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sent.version).toBe('v1');
  });

  it('declares the padded stored size, not the plaintext length', async () => {
    const calls = mockFetch({ status: 201, body: body(row()) });

    await createFile(await newContext(), {
      ciphertext: 'sealed',
      wrapped_dek: 'wrapped',
      ...declaredLayoutFor(40_000)
    });

    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.size_bytes).toBe(65_573);
    expect(sent.chunk_count).toBe(1);
    expect(sent.size_bytes).not.toBe(40_000);
  });

  it('reports 201 as created and 200 as a replay', async () => {
    mockFetch({ status: 201, body: body(row()) });
    const created = await createFile(await newContext(), {
      ciphertext: 'a', wrapped_dek: 'b', ...declaredLayoutFor(10)});
    expect(created.created).toBe(true);

    vi.unstubAllGlobals();
    mockFetch({ status: 200, body: body(row()) });
    const replayed = await createFile(await newContext(), {
      id: ID, ciphertext: 'a', wrapped_dek: 'b', ...declaredLayoutFor(10)});
    expect(replayed.created).toBe(false);
  });

  it('carries the resume ticket a replay returns for a pending row', async () => {
    mockFetch({
      status: 200,
      body: body({
        ...row(),
        upload: {
          multipart: true,
          chunk_size: 8388608,
          parts: [{ number: 2, url: 'https://r2/part2', size: 8388645 }],
          expires_at: '2026-09-09T11:00:00Z',
        },
      }),
    });

    const result = await createFile(await newContext(), {
      id: ID, ciphertext: 'a', wrapped_dek: 'b', ...declaredLayoutFor(10)});

    expect(result.created).toBe(false);
    expect(result.file.upload?.parts).toHaveLength(1);
    expect(result.file.upload?.parts[0].number).toBe(2);
  });

  it('does not send the hash, because it describes an object that does not exist yet', async () => {
    const calls = mockFetch({ status: 201, body: body(row()) });

    await createFile(await newContext(), {
      ciphertext: 'a',
      wrapped_dek: 'b',
      ...declaredLayoutFor(10),
    });

    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('ciphertext_sha256');
  });

  it('refuses a non-canonical id at the edge', async () => {
    mockFetch({ status: 201, body: body(row()) });

    await expect(
      createFile(await newContext(), {
        id: ID.toUpperCase(), ciphertext: 'a', wrapped_dek: 'b', ...declaredLayoutFor(10)}),
    ).rejects.toThrow();
  });
});

describe('the two error codes the drive introduced', () => {
  it('surfaces 507 as a quota message that mentions the delay', async () => {
    mockFetch({ status: 507, body: { code: 'QUOTA_EXCEEDED' } });

    try {
      await createFile(await newContext(), {
        ciphertext: 'a', wrapped_dek: 'b', ...declaredLayoutFor(10)});
      expect.unreachable();
    } catch (error) {
      const api = error as ApiError;
      expect(api.isQuotaExceeded).toBe(true);
      const { userMessageFor } = await import('@/lib/api');
      expect(userMessageFor(api)).toContain('within a minute');
    }
  });

  it('tells 413 from an ordinary BAD_REQUEST by status, since they share a code', async () => {
    mockFetch({ status: 413, body: { code: 'BAD_REQUEST' } });

    try {
      await createFile(await newContext(), {
        ciphertext: 'a', wrapped_dek: 'b', ...declaredLayoutFor(10)});
      expect.unreachable();
    } catch (error) {
      const api = error as ApiError;
      expect(api.code).toBe('BAD_REQUEST');
      expect(api.isObjectTooLarge).toBe(true);
      expect(api.isQuotaExceeded).toBe(false);
    }
  });
});

describe('listing', () => {
  it('reads the page envelope, so it keeps working when the API starts sending one', async () => {
    const calls = mockFetch(
      { status: 200, body: { message: 'ok', data: [row()], page: { has_more: true, next_cursor: 'c2' } } },
      { status: 200, body: { message: 'ok', data: [row({ id: 'x' })], page: { has_more: false } } },
    );

    const files = await listFiles(await newContext());

    expect(files).toHaveLength(2);
    expect(calls[1].url).toContain('cursor=c2');
  });

  it('stops after one page while the API sends no envelope at all', async () => {
    const calls = mockFetch({ status: 200, body: body([row()]) });

    const files = await listFiles(await newContext());

    expect(files).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe('usage', () => {
  it('reads the storage bar numbers', async () => {
    mockFetch({
      status: 200,
      body: body({
        used_bytes: 8_454_149,
        stored_bytes: 65_573,
        quota_bytes: 524_288_000,
        file_count: 2,
      }),
    });

    const usage = await getStorageUsage(await newContext());

    expect(remainingBytes(usage)).toBe(524_288_000 - 8_454_149);
    expect(fits(usage, layoutFor(1_000_000).storedBytes)).toBe(true);
    expect(fits(usage, 524_288_000)).toBe(false);
    expect(usage.stored_bytes).toBe(65_573);
  });
});

describe('download and resume', () => {
  it('asks the API which parts R2 already has, rather than remembering', async () => {
    const calls = mockFetch({
      status: 200,
      body: body({ uploaded: [1, 3], parts: [{ number: 2, url: 'https://r2/p2', size: 8388645 }] }),
    });

    const state = await getUploadState(await newContext(), ID);

    expect(state.uploaded).toEqual([1, 3]);
    expect(state.parts.map((part) => part.number)).toEqual([2]);
    expect(calls[0].url).toContain(`/files/${ID}/upload`);
  });

  it('returns the presigned URL alongside the sealed manifest', async () => {
    mockFetch({
      status: 200,
      body: body({ ...row({ r2_state: 'ok' }), url: 'https://r2/object', expires_at: '2026-09-09T10:05:00Z' }),
    });

    const download = await getFileDownload(await newContext(), ID);

    expect(download.url).toBe('https://r2/object');
    expect(isInVault(download)).toBe(true);
    expect(isReplicated(download)).toBe(false);
  });
});

describe('completing an upload', () => {
  it('sends parts in number order, because R2 completes a multipart that way', async () => {
    const calls = mockFetch({ status: 200, body: body(row({ r2_state: 'ok' })) });

    await completeUpload(await newContext(), ID, SHA, [
      { number: 3, etag: 'c' },
      { number: 1, etag: 'a' },
      { number: 2, etag: 'b' },
    ]);

    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.parts.map((part: { number: number }) => part.number)).toEqual([1, 2, 3]);
  });

  it('sends no parts for a single-PUT object, but always the hash', async () => {
    const calls = mockFetch({ status: 200, body: body(row({ r2_state: 'ok' })) });

    await completeUpload(await newContext(), ID, SHA);

    expect(JSON.parse(String(calls[0].init.body))).toEqual({ ciphertext_sha256: SHA });
  });

  it('carries the hash, which is the whole reason this call changed', async () => {
    const calls = mockFetch({ status: 200, body: body(row({ r2_state: 'ok' })) });

    await completeUpload(await newContext(), ID, SHA, [{ number: 1, etag: 'a' }]);

    expect(JSON.parse(String(calls[0].init.body)).ciphertext_sha256).toBe(SHA);
  });

  it('refuses a malformed hash before spending a request', async () => {
    const calls = mockFetch({ status: 200, body: body(row()) });

    await expect(completeUpload(await newContext(), ID, 'ABC')).rejects.toThrow(
      /64 lowercase hex/,
    );
    expect(calls).toHaveLength(0);
  });

  it('surfaces a length mismatch as a conflict rather than retrying', async () => {
    mockFetch({ status: 409, body: { code: 'CONFLICT' } });

    await expect(completeUpload(await newContext(), ID, SHA)).rejects.toMatchObject({ status: 409 });
  });
});

describe('deleting a file', () => {
  it('signs file-delete with the one id it was given', async () => {
    const calls = mockFetch({ status: 204 });
    const context = await newContext();

    await deleteFile(context, ID);

    const sent = JSON.parse(String(calls[0].init.body));
    const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
    const payload = buildActionPayload(sent.challenge, sent.timestamp, 'file-delete', [ID]);

    expect(verifyPayload(payload, sent.signature, tree.identity.publicKeyUncompressed)).toBe(true);
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('omits the second factor on a Standard Mode account', async () => {
    const calls = mockFetch({ status: 204 });

    await deleteFile(await newContext(false), ID);

    expect(JSON.parse(String(calls[0].init.body)).password).toBeUndefined();
  });

  it('attaches the second factor on a Paranoid account', async () => {
    const calls = mockFetch({ status: 204 });

    await deleteFile(await newContext(true), ID);

    expect(typeof JSON.parse(String(calls[0].init.body)).password).toBe('string');
  });

  it('sends a body, because a DELETE without one is a 400', async () => {
    const calls = mockFetch({ status: 204 });

    await deleteFile(await newContext(), ID);

    expect(calls[0].init.body).toBeDefined();
  });
});

describe('deleting a selection of files', () => {
  const OTHER = '0c892e57-93cf-423a-a9e9-fee5a9f87681';

  it('signs the sorted, de-duplicated set and sends the same order', async () => {
    const calls = mockFetch({ status: 200, body: { message: 'ok', data: { requested: 2, deleted: 2 } } });
    const context = await newContext();

    await deleteFiles(context, [ID, OTHER, ID]);

    const sent = JSON.parse(String(calls[0].init.body));
    const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
    const payload = buildActionPayload(sent.challenge, sent.timestamp, 'file-delete', [OTHER, ID]);

    expect(sent.ids).toEqual([OTHER, ID]);
    expect(verifyPayload(payload, sent.signature, tree.identity.publicKeyUncompressed)).toBe(true);
    expect(calls[0].url).toContain('/files');
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('returns the counts, because this route answers 200 with a body', async () => {
    mockFetch({ status: 200, body: { message: 'ok', data: { requested: 3, deleted: 1 } } });

    expect(await deleteFiles(await newContext(), [ID, OTHER])).toEqual({
      requested: 3,
      deleted: 1,
    });
  });

  it('refuses an empty selection before it reaches the network', async () => {
    const calls = mockFetch({ status: 200, body: { message: 'ok', data: {} } });

    await expect(deleteFiles(await newContext(), [])).rejects.toThrow(/at least one/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-canonical id before it reaches the network', async () => {
    const calls = mockFetch({ status: 200, body: { message: 'ok', data: {} } });

    await expect(deleteFiles(await newContext(), [ID.toUpperCase()])).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('attaches the second factor on a Paranoid account', async () => {
    const calls = mockFetch({ status: 200, body: { message: 'ok', data: { requested: 1, deleted: 1 } } });

    await deleteFiles(await newContext(true), [ID]);

    expect(typeof JSON.parse(String(calls[0].init.body)).password).toBe('string');
  });
});

describe('giving a reservation back', () => {
  it('asks the upload route to drop it, with no body and no signature', async () => {
    const calls = mockFetch({ status: 204 });

    await abandonUpload(await newContext(), ID);

    expect(calls[0].url).toContain(`/files/${ID}/upload`);
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('treats a 404 as already done, because a retry must be silent', async () => {
    mockFetch({ status: 404, body: { code: 'NOT_FOUND' } });

    await expect(abandonUpload(await newContext(), ID)).resolves.toBeUndefined();
  });

  it('still reports a real failure', async () => {
    mockFetch({ status: 500, body: { code: 'INTERNAL_ERROR' } });

    await expect(abandonUpload(await newContext(), ID)).rejects.toThrow();
  });

  it('refuses a non-canonical id before it reaches the network', async () => {
    const calls = mockFetch({ status: 204 });

    await expect(abandonUpload(await newContext(), ID.toUpperCase())).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
