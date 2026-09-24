import { describe, expect, it } from 'vitest';
import { deriveShareSubkey } from '@/lib/keyrings/crypto';
import { openBlob, sealBlob } from '@/lib/sealed';
import { createConnectionKey, unwrapUnderConnection, wrapUnderConnection } from './keys';
import { connectionIsStale } from './flows';
import type { ConnectionRecord } from './api';

function connection(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: '0c892e57-93cf-423a-a9e9-fee5a9f87681',
    direction: 'outbound',
    username: 'anacosta',
    user_address: 'b'.repeat(64),
    status: 'accepted',
    pqxdh_blob: 'blob',
    sender_wrapped_key: 'own',
    sender_key_generation: 1,
    recipient_key_generation: 1,
    keys: [],
    created_at: '2026-09-23T00:00:00Z',
    ...overrides,
  } as ConnectionRecord;
}

describe('connectionIsStale', () => {
  it('is stale once the counterparty publishes a newer sharing generation', () => {
    expect(connectionIsStale(connection({ recipient_key_generation: 1 }), 2)).toBe(true);
  });

  it('is not stale when the connection already names the published generation', () => {
    expect(connectionIsStale(connection({ recipient_key_generation: 2 }), 2)).toBe(false);
  });

  it('never re-establishes backwards, whatever the server reports', () => {
    expect(connectionIsStale(connection({ recipient_key_generation: 3 }), 2)).toBe(false);
  });
});

describe('what a re-establishment has to preserve', () => {
  it('re-wraps a share in the format a share is actually wrapped in', async () => {
    const oldKey = createConnectionKey();
    const newKey = createConnectionKey();
    const dek = crypto.getRandomValues(new Uint8Array(32));

    const oldSubkey = await deriveShareSubkey(oldKey, 'secrets');
    const newSubkey = await deriveShareSubkey(newKey, 'secrets');

    const asShared = await wrapUnderConnection(oldSubkey, dek);
    const reopened = await unwrapUnderConnection(oldSubkey, asShared);
    const rewrapped = await wrapUnderConnection(newSubkey, reopened);

    expect([...(await unwrapUnderConnection(newSubkey, rewrapped))]).toEqual([...dek]);
    await expect(openBlob(asShared, oldSubkey)).rejects.toThrow();
  });

  it('re-wraps a share so it opens under the new connection key and not the old', async () => {
    const oldKey = createConnectionKey();
    const newKey = createConnectionKey();
    const dek = crypto.getRandomValues(new Uint8Array(32));

    const oldSubkey = await deriveShareSubkey(oldKey, 'notes');
    const wrappedBefore = await sealBlob(dek, oldSubkey);

    const reopened = await openBlob(wrappedBefore, oldSubkey);
    const newSubkey = await deriveShareSubkey(newKey, 'notes');
    const wrappedAfter = await sealBlob(reopened, newSubkey);

    expect([...(await openBlob(wrappedAfter, newSubkey))]).toEqual([...dek]);
    await expect(openBlob(wrappedAfter, oldSubkey)).rejects.toThrow();
  });

  it('gives each scope its own sub-key, so the scope a share was sent under still decides', async () => {
    const key = createConnectionKey();
    const notes = await deriveShareSubkey(key, 'notes');
    const files = await deriveShareSubkey(key, 'files');

    expect([...notes]).not.toEqual([...files]);

    const dek = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await sealBlob(dek, notes);
    await expect(openBlob(wrapped, files)).rejects.toThrow();
  });

  it('leaves a device that knows the old connection key unable to open the new one', async () => {
    const dek = crypto.getRandomValues(new Uint8Array(32));
    const before = await deriveShareSubkey(createConnectionKey(), 'secrets');
    const after = await deriveShareSubkey(createConnectionKey(), 'secrets');

    const wrapped = await sealBlob(dek, before);
    await expect(openBlob(wrapped, after)).rejects.toThrow();
  });
});
