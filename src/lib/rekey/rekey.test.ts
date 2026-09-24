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
  it('visits only the item scopes that rotated and this device holds', async () => {
    const { context } = await openTestSession({ generations: { secrets: 2, notes: 2 } });
    const calls = mockFetch({ status: 200, body: { data: [] } });

    const outcomes = await rewrapAfterRotation(context, ['secrets', 'sharing', 'passwords']);

    expect(outcomes.map((outcome) => outcome.scope)).toEqual(['secrets']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/secrets');
  });

  it('does nothing when a rotation touched no item scope', async () => {
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
