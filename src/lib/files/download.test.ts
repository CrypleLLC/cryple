import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { bytesToHex, concatBytes } from '@/lib/encoding';
import { generateDek, vaultKekDekWrapper } from '@/lib/secrets';
import type { AuthedContext } from '@/lib/context';
import {
  DownloadBufferExceededError,
  ObjectDigestError,
  TruncatedObjectError,
  decryptStream,
  downloadFile,
  openFile,
  readChunk,
} from './download';
import { ManifestLayoutError } from './manifest';
import { ChunkPositionError } from './chunks';
import { sealChunk } from './chunks';
import { buildManifest, sealManifest } from './manifest';
import { CHUNK_PAYLOAD_BYTES, layoutFor } from './layout';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

async function newContext(): Promise<AuthedContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(vectors.seed_and_user_address.mnemonic, '481937');
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid: false };
}

function bytes(length: number, seed = 1): Uint8Array {
  const tile = Uint8Array.from({ length: Math.min(length, 4096) }, (_, i) => (i * 31 + seed) % 251);
  const out = new Uint8Array(length);
  for (let at = 0; at < length; at += tile.length) {
    out.set(tile.subarray(0, Math.min(tile.length, length - at)), at);
  }
  return out;
}

function streamOf(...parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

interface Stored {
  object: Uint8Array;
  ciphertext: string;
  wrapped_dek: string;
  size_bytes: number;
  sha256: string;
  dek: Uint8Array;
  manifest: Awaited<ReturnType<typeof buildManifest>>;
}

async function store(
  plaintext: Uint8Array,
  context: AuthedContext,
  name = 'passport.pdf',
): Promise<Stored> {
  const dek = generateDek();
  const layout = layoutFor(plaintext.length);
  const padded = new Uint8Array(layout.paddedBytes);
  padded.set(plaintext);

  const chunks: Uint8Array[] = [];
  for (let index = 0; index < layout.chunkCount; index += 1) {
    const from = index * CHUNK_PAYLOAD_BYTES;
    const to = Math.min(from + CHUNK_PAYLOAD_BYTES, layout.paddedBytes);
    chunks.push(await sealChunk(padded.subarray(from, to), index, layout.chunkCount, dek));
  }

  const object = concatBytes(...chunks);
  const manifest = buildManifest({ name, mime: 'application/pdf', size: plaintext.length });

  return {
    object,
    ciphertext: await sealManifest(manifest, dek),
    wrapped_dek: await vaultKekDekWrapper(context.session.vaultKek).wrapDek(dek),
    size_bytes: layout.storedBytes,
    sha256: bytesToHex(sha256(object)),
    dek,
    manifest,
  };
}

function mockApi(stored: Stored, object?: Uint8Array, overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/files/')) {
        return {
          status: 200,
          ok: true,
          text: async () =>
            JSON.stringify({
              message: 'ok',
              data: {
                id: ID,
                ciphertext: stored.ciphertext,
                wrapped_dek: stored.wrapped_dek,
                size_bytes: stored.size_bytes,
                ciphertext_sha256: stored.sha256,
                version: 'v1',
                r2_state: 'ok',
                gcs_state: 'pending',
                created_at: 'now',
                updated_at: 'now',
                url: 'https://r2.example/object',
                expires_at: 'later',
                ...overrides,
              },
            }),
          headers: { get: () => null },
        } as unknown as Response;
      }

      return {
        status: 200,
        ok: true,
        body: streamOf(object ?? stored.object),
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_BASE_API_URL;
});

describe('opening a file', () => {
  it('unwraps the DEK and reads the manifest the upload sealed', async () => {
    const context = await newContext();
    const stored = await store(bytes(40_000), context, 'passport-scan.pdf');
    mockApi(stored);

    const opened = await openFile(context, ID);

    expect(opened.manifest.name).toBe('passport-scan.pdf');
    expect(opened.manifest.size).toBe(40_000);
    expect(opened.dek).toHaveLength(32);
  });

  it('refuses before decrypting when the row disagrees with the manifest', async () => {
    const context = await newContext();
    const stored = await store(bytes(40_000), context);
    mockApi(stored, undefined, { size_bytes: stored.size_bytes + 64 });

    await expect(openFile(context, ID)).rejects.toThrow(ManifestLayoutError);
  });
});

describe('downloading', () => {
  it('returns the plaintext byte-identical, with the padding trimmed off', async () => {
    const context = await newContext();
    const plaintext = bytes(40_000);
    const stored = await store(plaintext, context);
    mockApi(stored);

    const { bytes: got, manifest } = await downloadFile(context, ID);

    expect(got).toHaveLength(40_000);
    expect(bytesToHex(sha256(got))).toBe(bytesToHex(sha256(plaintext)));
    expect(manifest.size).toBe(40_000);
  });

  it('round-trips an empty file', async () => {
    const context = await newContext();
    const stored = await store(new Uint8Array(0), context);
    mockApi(stored);

    expect((await downloadFile(context, ID)).bytes).toHaveLength(0);
  });

  it('round-trips a multi-chunk file', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const plaintext = bytes(CHUNK_PAYLOAD_BYTES + 100_000);
    const stored = await store(plaintext, context);
    mockApi(stored);

    const { bytes: got } = await downloadFile(context, ID);

    expect(got).toHaveLength(plaintext.length);
    expect(bytesToHex(sha256(got))).toBe(bytesToHex(sha256(plaintext)));
  });

  it('refuses a file larger than the in-memory limit rather than trying', async () => {
    const context = await newContext();
    const stored = await store(bytes(40_000), context);
    mockApi(stored);

    await expect(downloadFile(context, ID, { maxBytes: 1000 })).rejects.toThrow(
      DownloadBufferExceededError,
    );
  });
});

describe('what the stream refuses', () => {
  it('refuses an object truncated at a chunk boundary', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const stored = await store(bytes(CHUNK_PAYLOAD_BYTES + 100_000), context);
    mockApi(stored, stored.object.subarray(0, CHUNK_PAYLOAD_BYTES + 37));

    await expect(downloadFile(context, ID)).rejects.toThrow(TruncatedObjectError);
  });

  it('refuses an object truncated mid-chunk', async () => {
    const context = await newContext();
    const stored = await store(bytes(40_000), context);
    mockApi(stored, stored.object.subarray(0, stored.object.length - 10));

    await expect(downloadFile(context, ID)).rejects.toThrow(TruncatedObjectError);
  });

  it('refuses an object whose chunks were reordered', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const plaintext = bytes(CHUNK_PAYLOAD_BYTES + 100_000);
    const stored = await store(plaintext, context);
    const first = stored.object.subarray(0, CHUNK_PAYLOAD_BYTES + 37);
    const second = stored.object.subarray(CHUNK_PAYLOAD_BYTES + 37);
    mockApi(stored, concatBytes(second, first));

    await expect(downloadFile(context, ID)).rejects.toThrow();
  });

  it('refuses a single altered byte', async () => {
    const context = await newContext();
    const stored = await store(bytes(40_000), context);
    const tampered = Uint8Array.from(stored.object);
    tampered[500] ^= 0xff;
    mockApi(stored, tampered);

    await expect(downloadFile(context, ID)).rejects.toThrow();
  });

  it('reports a digest mismatch when the bytes decrypt but are not the recorded object', async () => {
    const context = await newContext();
    const stored = await store(bytes(40_000), context);
    mockApi(stored, undefined, { ciphertext_sha256: 'f'.repeat(64) });

    await expect(downloadFile(context, ID)).rejects.toThrow(ObjectDigestError);
  });

  it('cannot be opened by an account that holds only the ciphertext', async () => {
    const owner = await newContext();
    const stored = await store(bytes(40_000), owner);

    const stranger = new SessionKeystore({ idleTimeoutMs: 0 });
    await stranger.unlockWithMnemonic(
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
      '481937',
    );
    const strangerContext: AuthedContext = {
      session: stranger,
      tokens: new TokenStore(),
      paranoid: false,
    };
    strangerContext.tokens.set('jwt');
    mockApi(stored);

    await expect(openFile(strangerContext, ID)).rejects.toThrow();
  });
});

describe('decrypting a stream directly', () => {
  it('releases each chunk only after its tag and position check out', async () => {
    const context = await newContext();
    const plaintext = bytes(40_000);
    const stored = await store(plaintext, context);
    const dek = await vaultKekDekWrapper(context.session.vaultKek).unwrapDek(stored.wrapped_dek);

    const out = decryptStream(streamOf(stored.object), stored.manifest, dek);
    const reader = out.getReader();
    const first = await reader.read();

    expect(first.done).toBe(false);
    expect(first.value).toHaveLength(40_000);
  });

  it('does not care how the network chunked the response', async () => {
    const context = await newContext();
    const plaintext = bytes(40_000);
    const stored = await store(plaintext, context);
    const dek = await vaultKekDekWrapper(context.session.vaultKek).unwrapDek(stored.wrapped_dek);

    const slices: Uint8Array[] = [];
    for (let at = 0; at < stored.object.length; at += 997) {
      slices.push(stored.object.subarray(at, Math.min(at + 997, stored.object.length)));
    }

    const out = decryptStream(streamOf(...slices), stored.manifest, dek);
    const parts: Uint8Array[] = [];
    const reader = out.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    expect(bytesToHex(sha256(concatBytes(...parts)))).toBe(bytesToHex(sha256(plaintext)));
  });
});

describe('ranged reads, for seeking', () => {
  it('fetches one chunk by its byte range and verifies its position', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const plaintext = bytes(CHUNK_PAYLOAD_BYTES + 100_000);
    const stored = await store(plaintext, context);
    const dek = await vaultKekDekWrapper(context.session.vaultKek).unwrapDek(stored.wrapped_dek);

    let requested = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      requested = String((init.headers as Record<string, string>).Range);
      const [start, end] = requested.replace('bytes=', '').split('-').map(Number);
      return {
        ok: true,
        status: 206,
        arrayBuffer: async () => stored.object.slice(start, end + 1).buffer,
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const chunk = await readChunk('https://r2.example/object', stored.manifest, 1, dek, fetchImpl);

    expect(requested).toBe(`bytes=${CHUNK_PAYLOAD_BYTES + 37}-${stored.size_bytes - 1}`);
    expect(chunk.length).toBeGreaterThan(0);
  });

  it('refuses a chunk served from the wrong offset', { timeout: 30_000 }, async () => {
    const context = await newContext();
    const stored = await store(bytes(CHUNK_PAYLOAD_BYTES + 100_000), context);
    const dek = await vaultKekDekWrapper(context.session.vaultKek).unwrapDek(stored.wrapped_dek);

    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 206,
        arrayBuffer: async () => stored.object.slice(0, CHUNK_PAYLOAD_BYTES + 37).buffer,
      }) as unknown as Response) as unknown as typeof fetch;

    await expect(
      readChunk('https://r2.example/object', stored.manifest, 1, dek, fetchImpl),
    ).rejects.toThrow(ChunkPositionError);
  });
});

describe('the whole round trip', () => {
  it('uploads on one device and downloads byte-identical on another', async () => {
    const plaintext = bytes(120_000, 9);
    const uploader = await newContext();

    const objectParts: Uint8Array[] = [];
    let posted: Record<string, string | number> = {};
    let patched: Record<string, string> = {};

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (init?.method === 'POST') {
          posted = JSON.parse(String(init.body));
          return {
            status: 201,
            ok: true,
            text: async () =>
              JSON.stringify({
                message: 'ok',
                data: {
                  ...posted,
                  r2_state: 'pending',
                  gcs_state: 'pending',
                  created_at: 'now',
                  updated_at: 'now',
                  upload: {
                    multipart: false,
                    chunk_size: CHUNK_PAYLOAD_BYTES,
                    parts: [{ number: 1, url: 'https://r2.example/p1', size: 1 }],
                    expires_at: 'later',
                  },
                },
              }),
            headers: { get: () => null },
          } as unknown as Response;
        }
        if (init?.method === 'PATCH') {
          patched = JSON.parse(String(init.body));
          return {
            status: 200,
            ok: true,
            text: async () => JSON.stringify({ message: 'ok', data: { id: ID, r2_state: 'ok' } }),
            headers: { get: () => null },
          } as unknown as Response;
        }
        void url;
        return { status: 200, ok: true, text: async () => '{}', headers: { get: () => null } } as unknown as Response;
      }),
    );

    const { uploadFile } = await import('./upload');
    await uploadFile(uploader, {
      name: 'report.pdf',
      type: 'application/pdf',
      size: plaintext.length,
      stream: () => streamOf(plaintext),
    }, {
      id: ID,
      put: async (_part, body) => {
        objectParts.push(Uint8Array.from(body));
      },
    });

    vi.unstubAllGlobals();

    const secondDevice = await newContext();
    mockApi(
      {
        object: concatBytes(...objectParts),
        ciphertext: String(posted.ciphertext),
        wrapped_dek: String(posted.wrapped_dek),
        size_bytes: Number(posted.size_bytes),
        sha256: String(patched.ciphertext_sha256),
        dek: new Uint8Array(),
        manifest: buildManifest({ name: 'report.pdf', mime: 'application/pdf', size: plaintext.length }),
      },
    );

    const { bytes: got, manifest } = await downloadFile(secondDevice, ID);

    expect(manifest.name).toBe('report.pdf');
    expect(got).toHaveLength(plaintext.length);
    expect(bytesToHex(sha256(got))).toBe(bytesToHex(sha256(plaintext)));
    expect(patched.ciphertext_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(posted).not.toHaveProperty('ciphertext_sha256');
  });
});
