import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTestSession } from '@/test/session';
import { TokenStore } from '@/lib/api';
import { scopeDekWrapper } from '@/lib/keyrings';
import { generateDek } from '@/lib/secrets';
import type { AuthedContext } from '@/lib/context';
import { buildManifest, openManifest, sealManifest } from './manifest';
import { renameFile } from './rename';

const ID = '3f6b0d3e-8f2a-4d1c-9a5e-2b7c1d4e6f80';

async function newContext(): Promise<AuthedContext> {
  const { session } = (await openTestSession()).context;
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid: false };
}

afterEach(() => vi.unstubAllGlobals());

describe('renaming a file', () => {
  it('re-seals the manifest under the same DEK, changing the name and nothing else', async () => {
    const context = await newContext();
    const dek = generateDek();
    const wrapped = await scopeDekWrapper(context, 'files').wrapDek(dek);
    const original = buildManifest({
      name: 'IMG_0412.jpg',
      mime: 'image/jpeg',
      size: 40_000,
      thumbnailId: 'ba7816bf-8f01-4fea-9411-2b4c3f5a1e77',
      createdAt: new Date('2026-09-01T10:00:00Z'),
    });
    const row = {
      id: ID,
      ciphertext: await sealManifest(original, dek),
      ...wrapped,
      size_bytes: 40_028,
      ciphertext_sha256: 'a'.repeat(64),
      version: 'v1',
      r2_state: 'ok',
      gcs_state: 'ok',
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T10:00:00Z',
      url: 'https://r2.example/object',
      expires_at: '2026-09-01T10:05:00Z',
    };

    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const body = init.method === 'PUT' ? { ...row, ciphertext: JSON.parse(String(init.body)).ciphertext } : row;
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ data: body }),
          headers: { get: () => null },
        } as unknown as Response;
      }),
    );

    const renamed = await renameFile(context, ID, 'Beach, day two.jpg');

    const put = calls.find((call) => call.init.method === 'PUT')!;
    expect(put.url).toContain(`/files/${ID}/manifest`);
    const sent = JSON.parse(String(put.init.body)) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(['ciphertext']);

    const reopened = await openManifest(sent.ciphertext as string, dek);
    expect(reopened).toEqual({ ...original, name: 'Beach, day two.jpg' });
    expect(renamed.manifest.name).toBe('Beach, day two.jpg');
  });

  it('refuses a non-canonical id before asking the server anything', async () => {
    const context = await newContext();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(renameFile(context, 'NOT-AN-ID', 'x')).rejects.toThrow(/canonical/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
