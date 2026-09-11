import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import type { AuthedContext } from '@/lib/context';
import {
  MissingUploadTicketError,
  PartUploadError,
  SourceLengthError,
  SourceMismatchError,
  resumeUpload,
  uploadFile,
  type PartPutter,
  type UploadFile,
  type UploadProgress,
} from './upload';
import { buildManifest, openManifest, sealManifest } from './manifest';
import { openChunk } from './chunks';
import { CHUNK_PAYLOAD_BYTES, layoutFor } from './layout';
import { vaultKekDekWrapper } from '@/lib/secrets';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

async function newContext(): Promise<AuthedContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, '481937');
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid: false };
}

function file(size: number, name = 'passport.pdf', type = 'application/pdf'): UploadFile {
  const bytes = new Uint8Array(size).fill(0xab);
  return {
    name,
    type,
    size,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  };
}

interface Api {
  calls: { url: string; init: RequestInit }[];
  bodies: Record<string, unknown>[];
}

function mockApi(options: { createStatus?: number } = {}): Api {
  const calls: { url: string; init: RequestInit }[] = [];
  const bodies: Record<string, unknown>[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.body !== undefined && typeof init.body === 'string') {
        bodies.push(JSON.parse(init.body));
      }

      const ok = (body: unknown, status = 200) =>
        ({
          status,
          ok: true,
          text: async () => JSON.stringify(body),
          headers: { get: () => null },
        }) as unknown as Response;

      if (url.includes('/files') && init.method === 'POST') {
        const sent = JSON.parse(String(init.body));
        return ok(
          {
            message: 'ok',
            data: {
              id: sent.id,
              ciphertext: sent.ciphertext,
              wrapped_dek: sent.wrapped_dek,
              size_bytes: sent.size_bytes,
              ciphertext_sha256: sent.ciphertext_sha256,
              version: 'v1',
              r2_state: 'pending',
              gcs_state: 'pending',
              created_at: 'now',
              updated_at: 'now',
              upload: {
                multipart: sent.chunk_count > 1,
                chunk_size: 8388608,
                parts: Array.from({ length: sent.chunk_count }, (_, index) => ({
                  number: index + 1,
                  url: `https://r2.example/part${index + 1}`,
                  size: 1,
                })),
                expires_at: 'later',
              },
            },
          },
          options.createStatus ?? 201,
        );
      }

      if (init.method === 'PATCH') {
        return ok({ message: 'ok', data: { id: ID, r2_state: 'ok', gcs_state: 'pending' } });
      }

      if (url.includes('/upload')) {
        return ok({ message: 'ok', data: { uploaded: [1], parts: [{ number: 2, url: 'https://r2.example/part2', size: 1 }] } });
      }

      return ok({ message: 'ok', data: {} });
    }),
  );

  return { calls, bodies };
}

function recordingPutter(): { put: PartPutter; sent: { number: number; length: number }[] } {
  const sent: { number: number; length: number }[] = [];
  return {
    sent,
    put: async (part, bodyBytes) => {
      sent.push({ number: part.number, length: bodyBytes.length });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_BASE_API_URL;
});

describe('uploading a file', () => {
  it('takes the single-PUT path when the file fits one chunk', async () => {
    const api = mockApi();
    const { put, sent } = recordingPutter();

    await uploadFile(await newContext(), file(40_000), { put });

    expect(sent).toEqual([{ number: 1, length: 65_573 }]);
    const patch = api.bodies[api.bodies.length - 1] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['ciphertext_sha256']);
  });

  it('sends no part list at all, because the server takes it from the store', { timeout: 30_000 }, async () => {
    const api = mockApi();
    const { put } = recordingPutter();

    await uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES + 1000), { put, concurrency: 1 });

    const patch = api.bodies[api.bodies.length - 1] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['ciphertext_sha256']);
  });

  it('never reads a response header from a part upload', { timeout: 30_000 }, async () => {
    const api = mockApi();

    await uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES + 1000), {
      concurrency: 2,
      put: async () => {},
    });

    const patch = api.bodies[api.bodies.length - 1] as Record<string, unknown>;
    expect(patch.parts).toBeUndefined();
  });

  it('declares the padded size and the chunk layout up front', async () => {
    const api = mockApi();
    const { put } = recordingPutter();

    await uploadFile(await newContext(), file(40_000), { put });

    const post = api.bodies[0] as { size_bytes: number; chunk_count: number };
    expect(post.size_bytes).toBe(layoutFor(40_000).storedBytes);
    expect(post.chunk_count).toBe(1);
  });

  it('seals the filename into the manifest and nowhere else', async () => {
    const api = mockApi();
    const { put } = recordingPutter();
    const context = await newContext();

    await uploadFile(context, file(1000, 'passport-scan.pdf', 'application/pdf'), { put });

    const post = api.bodies[0] as { ciphertext: string; wrapped_dek: string };
    expect(JSON.stringify(post)).not.toContain('passport-scan');

    const dek = await vaultKekDekWrapper(context.session.vaultKek).unwrapDek(post.wrapped_dek);
    const manifest = await openManifest(post.ciphertext, dek);

    expect(manifest.name).toBe('passport-scan.pdf');
    expect(manifest.mime).toBe('application/pdf');
    expect(manifest.size).toBe(1000);
  });

  it('wraps the DEK so the file can be opened again from the row alone', async () => {
    const api = mockApi();
    const context = await newContext();
    const captured: Uint8Array[] = [];

    await uploadFile(context, file(1000), {
      put: async (part, body) => {
        captured.push(body);
      },
    });

    const post = api.bodies[0] as { wrapped_dek: string };
    const dek = await vaultKekDekWrapper(context.session.vaultKek).unwrapDek(post.wrapped_dek);
    const opened = await openChunk(captured[0], 0, 1, dek);

    expect(opened.subarray(0, 1000).every((byte) => byte === 0xab)).toBe(true);
  });

  it('reports every phase in order', async () => {
    mockApi();
    const { put } = recordingPutter();
    const phases: UploadProgress['phase'][] = [];

    await uploadFile(await newContext(), file(1000), {
      put,
      onProgress: (progress) => phases.push(progress.phase),
    });

    expect(phases[0]).toBe('uploading');
    expect(phases[phases.length - 1]).toBe('completing');
  });

  it('sends the hash at PATCH, not at POST', async () => {
    const api = mockApi();
    const { put } = recordingPutter();

    await uploadFile(await newContext(), file(40_000), { put });

    expect(api.bodies[0]).not.toHaveProperty('ciphertext_sha256');
    const patch = api.bodies[api.bodies.length - 1] as { ciphertext_sha256: string };
    expect(patch.ciphertext_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes what it actually uploaded', { timeout: 30_000 }, async () => {
    const api = mockApi();
    const uploaded: Uint8Array[] = [];

    await uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES + 1000), {
      concurrency: 1,
      put: async (_part, bodyBytes) => {
        uploaded.push(Uint8Array.from(bodyBytes));
      },
    });

    const { sha256 } = await import('@noble/hashes/sha2.js');
    const { bytesToHex, concatBytes } = await import('@/lib/encoding');
    const patch = api.bodies[api.bodies.length - 1] as { ciphertext_sha256: string };

    expect(patch.ciphertext_sha256).toBe(bytesToHex(sha256(concatBytes(...uploaded))));
  });

  it('never holds more than the parts in flight', { timeout: 30_000 }, async () => {
    mockApi();
    let live = 0;
    let peak = 0;

    await uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES * 2 + 1000), {
      concurrency: 2,
      put: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, 5));
        live -= 1;
      },
    });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('refuses a source that produced fewer bytes than it declared', async () => {
    mockApi();

    await expect(
      uploadFile(await newContext(), {
        name: 'a.bin',
        type: 'application/octet-stream',
        size: 100_000,
        stream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(10));
              controller.close();
            },
          }),
      }, { put: recordingPutter().put }),
    ).rejects.toThrow(SourceLengthError);
  });

  it('uses the id it was given, so a retry cannot mint a second object', async () => {
    const api = mockApi();
    const { put } = recordingPutter();

    await uploadFile(await newContext(), file(1000), { put, id: ID });

    expect((api.bodies[0] as { id: string }).id).toBe(ID);
  });

  it('stops if the server returns no ticket, rather than reporting success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          status: 201,
          ok: true,
          text: async () =>
            JSON.stringify({ message: 'ok', data: { id: ID, r2_state: 'pending', gcs_state: 'pending' } }),
          headers: { get: () => null },
        }) as unknown as Response,
      ),
    );

    await expect(uploadFile(await newContext(), file(1000), { put: recordingPutter().put })).rejects.toThrow(
      MissingUploadTicketError,
    );
  });

  it('completes a multipart object against a store that exposes no headers at all', { timeout: 30_000 }, async () => {
    const api = mockApi();

    await uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES + 1000), {
      concurrency: 1,
      put: async () => {},
    });

    const patch = api.bodies[api.bodies.length - 1] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['ciphertext_sha256']);
  });

  it('surfaces a rejected part rather than completing a partial object', { timeout: 30_000 }, async () => {
    mockApi();

    await expect(
      uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES + 1000), {
        concurrency: 1,
        put: async (part) => {
          if (part.number === 2) {
            throw new PartUploadError(2, 403);
          }
        },
      }),
    ).rejects.toThrow(PartUploadError);
  });
});

describe('a part failing while others are in flight', () => {
  it('raises the first failure and leaves no unhandled rejection behind', { timeout: 60_000 }, async () => {
    mockApi();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent | unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);

    const bytes = new Uint8Array(CHUNK_PAYLOAD_BYTES * 3 + 100);
    await expect(
      uploadFile(await newContext(), {
        name: 'a.bin', type: 'application/octet-stream', size: bytes.length,
        stream: () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }),
      }, {
        concurrency: 3,
        put: async (part) => { await new Promise((r) => setTimeout(r, part.number * 5)); throw new Error(`part ${part.number} failed`); },
      }),
    ).rejects.toThrow();

    await new Promise((r) => setTimeout(r, 120));
    process.off('unhandledRejection', onUnhandled);

    expect(unhandled).toEqual([]);
  });
});

describe('resuming an upload after a reload', () => {
  const TWO_CHUNKS = CHUNK_PAYLOAD_BYTES + 1000;

  async function startedUpload(context: AuthedContext, source = file(TWO_CHUNKS)) {
    const api = mockApi();
    const chunks: Uint8Array[] = [];

    await uploadFile(context, source, {
      id: ID,
      concurrency: 1,
      put: async (_part, body) => {
        chunks.push(Uint8Array.from(body));
      },
    });

    const post = api.bodies[0] as {
      ciphertext: string;
      wrapped_dek: string;
      size_bytes: number;
    };

    vi.unstubAllGlobals();

    return {
      chunks,
      row: {
        id: ID,
        ciphertext: post.ciphertext,
        wrapped_dek: post.wrapped_dek,
        size_bytes: post.size_bytes,
      },
    };
  }

  it('uploads only the parts R2 does not have', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const { row } = await startedUpload(context);

    mockApi();
    const { put, sent } = recordingPutter();

    await resumeUpload(context, row, file(TWO_CHUNKS), { put, concurrency: 1 });

    expect(sent.map((part) => part.number)).toEqual([2]);
  });

  it('hashes the whole object, including the chunks it did not re-send', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const { chunks, row } = await startedUpload(context);

    const api = mockApi();
    const { put } = recordingPutter();

    await resumeUpload(context, row, file(TWO_CHUNKS), { put, concurrency: 1 });

    const { sha256 } = await import('@noble/hashes/sha2.js');
    const { bytesToHex, concatBytes } = await import('@/lib/encoding');
    const patch = api.bodies[api.bodies.length - 1] as { ciphertext_sha256: string };

    expect(patch.ciphertext_sha256).toBe(bytesToHex(sha256(concatBytes(...chunks))));
  });

  it('reports progress over the whole object, not over what it re-sent', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const { row } = await startedUpload(context);

    mockApi();
    const seen: UploadProgress[] = [];

    await resumeUpload(context, row, file(TWO_CHUNKS), {
      put: async () => {},
      concurrency: 1,
      onProgress: (progress) => seen.push(progress),
    });

    const last = seen[seen.length - 1];
    expect(last.doneBytes).toBe(last.totalBytes);
    expect(seen.some((progress) => progress.doneBytes > 0 && progress.phase === 'uploading')).toBe(true);
  });

  it('refuses a file of a different size', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const { row } = await startedUpload(context);

    mockApi();

    await expect(
      resumeUpload(context, row, file(TWO_CHUNKS + 1), { put: async () => {} }),
    ).rejects.toThrow(SourceMismatchError);
  });

  it('refuses a file of a different name', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const { row } = await startedUpload(context);

    mockApi();

    await expect(
      resumeUpload(context, row, file(TWO_CHUNKS, 'other.pdf'), { put: async () => {} }),
    ).rejects.toThrow(SourceMismatchError);
  });

  it('refuses a file with the same name and size but different bytes', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const { row } = await startedUpload(context);

    mockApi();
    const impostor: UploadFile = {
      ...file(TWO_CHUNKS),
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(TWO_CHUNKS).fill(0xcd));
            controller.close();
          },
        }),
    };

    await expect(resumeUpload(context, row, impostor, { put: async () => {} })).rejects.toThrow(
      SourceMismatchError,
    );
  });

  it('sends nothing at all when the source does not match', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const { row } = await startedUpload(context);

    const api = mockApi();
    const { put, sent } = recordingPutter();

    await expect(
      resumeUpload(context, row, file(TWO_CHUNKS, 'other.pdf'), { put }),
    ).rejects.toThrow(SourceMismatchError);

    expect(sent).toEqual([]);
    expect(api.bodies.some((body) => 'ciphertext_sha256' in body)).toBe(false);
  });

  it('refuses an upload started before the manifest carried a fingerprint', async () => {
    const context = await newContext();
    const dek = new Uint8Array(32).fill(9);
    const manifest = buildManifest({ name: 'passport.pdf', mime: 'application/pdf', size: 40_000 });
    const row = {
      id: ID,
      ciphertext: await sealManifest(manifest, dek),
      wrapped_dek: await vaultKekDekWrapper(context.session.vaultKek).wrapDek(dek),
      size_bytes: layoutFor(40_000).storedBytes,
    };

    mockApi();

    expect(manifest.first_chunk_sha256).toBeUndefined();
    await expect(resumeUpload(context, row, file(40_000), { put: async () => {} })).rejects.toThrow(
      SourceMismatchError,
    );
  });
});
