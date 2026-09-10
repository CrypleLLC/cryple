import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import type { AuthedContext } from '@/lib/context';
import { MissingUploadTicketError, PartUploadError, resumeUpload, uploadFile, type PartPutter, type UploadFile, type UploadProgress } from './upload';
import { memorySink, SealBufferExceededError } from './sink';
import { openManifest } from './manifest';
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
      return `"etag-${part.number}"`;
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
    const patch = api.bodies[api.bodies.length - 1];
    expect(patch).toEqual({});
  });

  it('sends the ETags it collected when the object is multipart', { timeout: 30_000 }, async () => {
    const api = mockApi();
    const { put } = recordingPutter();

    await uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES + 1000), { put, concurrency: 1 });

    const patch = api.bodies[api.bodies.length - 1] as { parts: { number: number; etag: string }[] };
    expect(patch.parts).toEqual([
      { number: 1, etag: '"etag-1"' },
      { number: 2, etag: '"etag-2"' },
    ]);
  });

  it('sorts the ETags by part number even when the PUTs finish out of order', { timeout: 30_000 }, async () => {
    const api = mockApi();

    await uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES + 1000), {
      concurrency: 2,
      put: async (part) => {
        await new Promise((resolve) => setTimeout(resolve, part.number === 1 ? 20 : 0));
        return `"etag-${part.number}"`;
      },
    });

    const patch = api.bodies[api.bodies.length - 1] as { parts: { number: number }[] };
    expect(patch.parts.map((part) => part.number)).toEqual([1, 2]);
  });

  it('declares the padded size and the hash of what it actually sealed', async () => {
    const api = mockApi();
    const { put } = recordingPutter();

    await uploadFile(await newContext(), file(40_000), { put });

    const post = api.bodies[0] as { size_bytes: number; ciphertext_sha256: string; chunk_count: number };
    expect(post.size_bytes).toBe(layoutFor(40_000).storedBytes);
    expect(post.chunk_count).toBe(1);
    expect(post.ciphertext_sha256).toMatch(/^[0-9a-f]{64}$/);
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
        return '"e"';
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

    expect(phases[0]).toBe('sealing');
    expect(phases).toContain('uploading');
    expect(phases[phases.length - 1]).toBe('completing');
  });

  it('uses the id it was given, so a retry cannot mint a second object', async () => {
    const api = mockApi();
    const { put } = recordingPutter();

    await uploadFile(await newContext(), file(1000), { put, id: ID });

    expect((api.bodies[0] as { id: string }).id).toBe(ID);
  });

  it('refuses a file too large for the sealed buffer before it touches the network', async () => {
    const api = mockApi();
    const { put } = recordingPutter();

    await expect(
      uploadFile(await newContext(), file(200_000), { put, sink: memorySink(64 << 10) }),
    ).rejects.toThrow(SealBufferExceededError);

    expect(api.calls).toHaveLength(0);
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

  it('surfaces a rejected part rather than completing a partial object', { timeout: 30_000 }, async () => {
    mockApi();

    await expect(
      uploadFile(await newContext(), file(CHUNK_PAYLOAD_BYTES + 1000), {
        concurrency: 1,
        put: async (part) => {
          if (part.number === 2) {
            throw new PartUploadError(2, 403);
          }
          return '"e"';
        },
      }),
    ).rejects.toThrow(PartUploadError);
  });
});

describe('resuming', () => {
  it('uploads only the parts the object store is missing', async () => {
    mockApi();
    const { put, sent } = recordingPutter();

    const sink = memorySink();
    await sink.reserve(100, 2);
    await sink.write(0, new Uint8Array(10));
    await sink.write(1, new Uint8Array(10));

    await resumeUpload(await newContext(), ID, sink, { put });

    expect(sent.map((part) => part.number)).toEqual([2]);
  });

  it('cannot resume from a memory sink that no longer holds the bytes', async () => {
    mockApi();

    await expect(
      resumeUpload(await newContext(), ID, memorySink(), { put: recordingPutter().put }),
    ).rejects.toThrow(/no longer held/);
  });
});
