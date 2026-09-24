import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTestSession } from '@/test/session';
import { spkiBase64ToUncompressedPoint } from '@/lib/encoding';
import { openBlob, sealBlob } from '@/lib/sealed';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { REKEY_BATCH_SIZE, batched, rewrapAfterRotation, rewrapScope, staleItems } from './index';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('staleItems', () => {
  it('keeps only what an older generation wrapped, sorted by id', () => {
    const stale = staleItems(
      [
        { id: 'ccc', wrapped_dek: 'a', key_generation: 1 },
        { id: 'aaa', wrapped_dek: 'b', key_generation: 3 },
        { id: 'bbb', wrapped_dek: 'c', key_generation: 2 },
      ],
      3,
    );

    expect(stale.map((item) => item.id)).toEqual(['bbb', 'ccc']);
  });

  it('returns nothing when every item is already current', () => {
    expect(staleItems([{ id: 'a', wrapped_dek: 'x', key_generation: 4 }], 4)).toEqual([]);
  });
});

describe('batched', () => {
  it('splits into whole batches and one remainder', () => {
    const items = Array.from({ length: 5 }, (_, at) => at);
    expect(batched(items, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('caps a batch so one signature never covers an unbounded list', () => {
    expect(REKEY_BATCH_SIZE).toBeLessThanOrEqual(100);
  });
});

describe('rewrapScope', () => {
  it('re-wraps every stale secret under the current generation and leaves the rest alone', async () => {
    const { context, keks } = await openTestSession({ generations: { secrets: 2 } });
    const dek = crypto.getRandomValues(new Uint8Array(32));
    const old = keks.get('secrets:1')!;

    const calls = mockFetch(
      {
        status: 200,
        body: {
          data: [
            { id: 'aaaaaaaa-0000-4000-8000-000000000001', wrapped_dek: await sealBlob(dek, old), key_generation: 1 },
            { id: 'aaaaaaaa-0000-4000-8000-000000000002', wrapped_dek: 'current', key_generation: 2 },
          ],
        },
      },
      { status: 200, body: { data: { requested: 1, rekeyed: 1 } } },
    );

    const outcome = await rewrapScope(context, 'secrets');

    expect(outcome).toEqual({ scope: 'secrets', requested: 1, rekeyed: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('/secrets/keys');
    expect(calls[1].init.method).toBe('PUT');

    const body = bodyOf(calls[1].init);
    expect(body.key_generation).toBe(2);

    const items = body.items as { id: string; wrapped_dek: string }[];
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('aaaaaaaa-0000-4000-8000-000000000001');

    const reopened = await openBlob(items[0].wrapped_dek, keks.get('secrets:2')!);
    expect([...reopened]).toEqual([...dek]);
  });

  it('sends nothing at all when the rotation left nothing behind', async () => {
    const { context } = await openTestSession({ generations: { notes: 2 } });
    const calls = mockFetch({
      status: 200,
      body: { data: [{ id: 'n', wrapped_dek: 'x', key_generation: 2 }] },
    });

    const outcome = await rewrapScope(context, 'notes');

    expect(outcome).toEqual({ scope: 'notes', requested: 0, rekeyed: 0 });
    expect(calls).toHaveLength(1);
  });

  it('signs the sorted ids with the device key, under the right action', async () => {
    const { context, device, keks } = await openTestSession({ generations: { secrets: 2 } });
    const old = keks.get('secrets:1')!;
    const first = 'aaaaaaaa-0000-4000-8000-000000000001';
    const second = 'bbbbbbbb-0000-4000-8000-000000000002';

    const calls = mockFetch(
      {
        status: 200,
        body: {
          data: [
            { id: second, wrapped_dek: await sealBlob(crypto.getRandomValues(new Uint8Array(32)), old), key_generation: 1 },
            { id: first, wrapped_dek: await sealBlob(crypto.getRandomValues(new Uint8Array(32)), old), key_generation: 1 },
          ],
        },
      },
      { status: 200, body: { data: { requested: 2, rekeyed: 2 } } },
    );

    await rewrapScope(context, 'secrets');

    const body = bodyOf(calls[1].init);
    const payload = buildActionPayload(
      String(body.challenge),
      Number(body.timestamp),
      'secret-rekey',
      [first, second],
    );

    expect(
      await verifyPayload(payload, String(body.signature), spkiBase64ToUncompressedPoint(device.signingPublicKey)),
    ).toBe(true);
  });

  it('skips a file the drive has not finished storing', async () => {
    const { context, keks } = await openTestSession({ generations: { files: 2 } });
    const old = keks.get('files:1')!;
    const wrapped = await sealBlob(crypto.getRandomValues(new Uint8Array(32)), old);

    const calls = mockFetch(
      {
        status: 200,
        body: {
          data: [
            { id: 'ffffffff-0000-4000-8000-000000000001', wrapped_dek: wrapped, key_generation: 1, r2_state: 'ok', gcs_state: 'ok' },
            { id: 'ffffffff-0000-4000-8000-000000000002', wrapped_dek: wrapped, key_generation: 1, r2_state: 'pending', gcs_state: 'pending' },
          ],
        },
      },
      { status: 200, body: { data: { requested: 1, rekeyed: 1 } } },
    );

    const outcome = await rewrapScope(context, 'files');

    expect(outcome.requested).toBe(1);
    expect((bodyOf(calls[1].init).items as unknown[])).toHaveLength(1);
  });
});

describe('rewrapAfterRotation', () => {
  it('visits every scope that wraps DEKs, passwords included, and skips sharing', async () => {
    const { context } = await openTestSession({ generations: { secrets: 2, notes: 2 } });
    const calls = mockFetch({ status: 200, body: { data: [] } });

    const outcomes = await rewrapAfterRotation(context, ['secrets', 'sharing', 'passwords']);

    expect(outcomes.map((outcome) => outcome.scope)).toEqual(['secrets', 'passwords']);
    expect(calls.map((call) => call.url.includes('/credentials'))).toContain(true);
  });

  it('does nothing when a rotation touched no scope that wraps DEKs', async () => {
    const { context } = await openTestSession();
    const calls = mockFetch({ status: 200, body: { data: [] } });

    expect(await rewrapAfterRotation(context, ['sharing'])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('leaves a scope this device does not hold to a device that does', async () => {
    const { context } = await openTestSession({ scopes: ['secrets', 'admin'] });
    const calls = mockFetch({ status: 200, body: { data: [] } });

    const outcomes = await rewrapAfterRotation(context, ['secrets', 'notes', 'files']);

    expect(outcomes.map((outcome) => outcome.scope)).toEqual(['secrets']);
    expect(calls).toHaveLength(1);
  });
});

describe('the passwords pass', () => {
  const revisionA = '11111111-0000-4000-8000-000000000001';
  const revisionB = '22222222-0000-4000-8000-000000000002';

  it('enumerates revisions from the metadata listing, not the vault listing', async () => {
    const { context } = await openTestSession({ generations: { passwords: 2 } });
    const calls = mockFetch({ status: 200, body: { data: [] } });

    await rewrapScope(context, 'passwords');

    expect(calls[0].url).toContain('/credentials');
    expect(calls[0].url).toContain('fields=meta');
  });

  it('names each revision as revision_id and puts them to the credentials route', async () => {
    const { context, keks } = await openTestSession({ generations: { passwords: 2 } });
    const old = keks.get('passwords:1')!;
    const dek = crypto.getRandomValues(new Uint8Array(32));

    const calls = mockFetch(
      {
        status: 200,
        body: {
          data: [
            {
              credential_id: 'cccccccc-0000-4000-8000-00000000000c',
              revision_id: revisionA,
              wrapped_dek: await sealBlob(dek, old),
              key_generation: 1,
              created_at: '2026-09-24T10:00:00Z',
            },
          ],
        },
      },
      { status: 200, body: { data: { requested: 1, rekeyed: 1 } } },
    );

    const outcome = await rewrapScope(context, 'passwords');

    expect(outcome).toEqual({ scope: 'passwords', requested: 1, rekeyed: 1 });
    expect(calls[1].url).toContain('/credentials/keys');

    const body = bodyOf(calls[1].init);
    const items = body.items as Record<string, string>[];
    expect(items[0]).toHaveProperty('revision_id', revisionA);
    expect(items[0]).not.toHaveProperty('id');

    const reopened = await openBlob(items[0].wrapped_dek, keks.get('passwords:2')!);
    expect([...reopened]).toEqual([...dek]);
  });

  it('signs the sorted revision ids under credential-rekey', async () => {
    const { context, device, keks } = await openTestSession({ generations: { passwords: 2 } });
    const old = keks.get('passwords:1')!;

    const meta = async (revisionId: string) => ({
      credential_id: 'cccccccc-0000-4000-8000-00000000000c',
      revision_id: revisionId,
      wrapped_dek: await sealBlob(crypto.getRandomValues(new Uint8Array(32)), old),
      key_generation: 1,
      created_at: '2026-09-24T10:00:00Z',
    });

    const calls = mockFetch(
      { status: 200, body: { data: [await meta(revisionB), await meta(revisionA)] } },
      { status: 200, body: { data: { requested: 2, rekeyed: 2 } } },
    );

    await rewrapScope(context, 'passwords');

    const body = bodyOf(calls[1].init);
    const payload = buildActionPayload(
      String(body.challenge),
      Number(body.timestamp),
      'credential-rekey',
      [revisionA, revisionB],
    );

    expect(
      verifyPayload(
        payload,
        String(body.signature),
        spkiBase64ToUncompressedPoint(device.signingPublicKey),
      ),
    ).toBe(true);
  });

  it('batches a long history, because a credential edited for years is many revisions', async () => {
    const { context, keks } = await openTestSession({ generations: { passwords: 2 } });
    const old = keks.get('passwords:1')!;
    const wrapped = await sealBlob(crypto.getRandomValues(new Uint8Array(32)), old);

    const revisions = await Promise.all(
      Array.from({ length: REKEY_BATCH_SIZE + 1 }, (_unused, at) => ({
        credential_id: 'cccccccc-0000-4000-8000-00000000000c',
        revision_id: `${String(at).padStart(8, '0')}-0000-4000-8000-000000000000`,
        wrapped_dek: wrapped,
        key_generation: 1,
        created_at: '2026-09-24T10:00:00Z',
      })),
    );

    const calls = mockFetch(
      { status: 200, body: { data: revisions } },
      { status: 200, body: { data: { requested: REKEY_BATCH_SIZE, rekeyed: REKEY_BATCH_SIZE } } },
      { status: 200, body: { data: { requested: 1, rekeyed: 1 } } },
    );

    const outcome = await rewrapScope(context, 'passwords');

    expect(outcome.requested).toBe(REKEY_BATCH_SIZE + 1);
    expect(calls).toHaveLength(3);
    expect((bodyOf(calls[1].init).items as unknown[]).length).toBe(REKEY_BATCH_SIZE);
    expect((bodyOf(calls[2].init).items as unknown[]).length).toBe(1);
  });
});
