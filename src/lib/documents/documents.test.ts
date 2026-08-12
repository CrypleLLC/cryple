import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildActionPayload, normalizeActionArgs } from '@/lib/signing';
import { openBlob, sealBlob } from '@/lib/sealed';
import {
  MAX_UPDATE_CHARACTERS,
  SequenceGapError,
  assertContiguous,
  highestSeq,
  isContiguous,
  type AppendResult,
  type DocumentRecord,
  type DocumentUpdateRecord,
  type PendingUpdate,
} from './records';
import { DocumentSync, type DocumentTransport } from './sync';

const DEK = new Uint8Array(32).fill(7);

function update(seq: number, ciphertext = ''): DocumentUpdateRecord {
  return { seq, ciphertext, created_at: '2026-01-01T00:00:00Z' };
}

describe('sequence contiguity', () => {
  it('accepts a run that follows the cursor', () => {
    expect(isContiguous([update(4), update(5), update(6)], { after: 3 })).toBe(true);
  });

  it('rejects a hole inside the fetched range', () => {
    expect(() => assertContiguous([update(4), update(6)], { after: 3 })).toThrow(SequenceGapError);
  });

  it('rejects a range that does not start at the cursor', () => {
    expect(() => assertContiguous([update(6)], { after: 3 })).toThrow(SequenceGapError);
  });

  it('allows a range that starts above the cursor when the log was just pruned', () => {
    expect(isContiguous([update(6), update(7)])).toBe(true);
  });

  it('treats an empty range as contiguous', () => {
    expect(isContiguous([], { after: 9 })).toBe(true);
  });

  it('keeps the cursor when nothing came back', () => {
    expect(highestSeq(9, [])).toBe(9);
  });
});

describe('document-delete action', () => {
  it('sorts and de-duplicates ids before signing, as the batch route rebuilds them', () => {
    const ids = [
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '1f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    ];

    expect(normalizeActionArgs('document-delete', ids)).toEqual([
      '1f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    ]);
  });

  it('builds the colon-joined payload the server rebuilds', () => {
    expect(buildActionPayload('chal', 1700000000, 'document-delete', ['a', 'b'])).toBe(
      'chal:1700000000:document-delete:a:b',
    );
  });
});

class FakeServer {
  private log: DocumentUpdateRecord[] = [];
  private seen = new Set<string>();
  snapshotCiphertext = '';
  snapshotSeq = 0;
  revision = 1;
  pushes = 0;

  record(): DocumentRecord {
    return {
      id: 'doc',
      wrapped_dek: 'wrapped',
      snapshot_ciphertext: this.snapshotCiphertext,
      snapshot_seq: this.snapshotSeq,
      revision: this.revision,
      version: 'v1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
  }

  latestSeq(): number {
    return this.log.reduce((highest, entry) => Math.max(highest, entry.seq), 0);
  }

  since(seq: number): DocumentUpdateRecord[] {
    return this.log.filter((entry) => entry.seq > seq);
  }

  append(updates: readonly PendingUpdate[]): AppendResult {
    let applied = 0;
    let skipped = 0;

    for (const pending of updates) {
      if (this.seen.has(pending.client_update_id)) {
        skipped += 1;
        continue;
      }
      this.seen.add(pending.client_update_id);
      this.log.push(update(this.latestSeq() + 1, pending.ciphertext));
      this.pushes += 1;
      applied += 1;
    }

    return { applied, skipped, latest_seq: this.latestSeq() };
  }

  compact(snapshot: string, throughSeq: number): DocumentRecord {
    if (throughSeq > this.latestSeq()) {
      throw new Error('through_seq ahead of the log');
    }
    this.snapshotCiphertext = snapshot;
    this.snapshotSeq = throughSeq;
    this.revision += 1;
    this.log = this.log.filter((entry) => entry.seq > throughSeq);
    return this.record();
  }

  dropUpdate(seq: number): void {
    this.log = this.log.filter((entry) => entry.seq !== seq);
  }
}

function transportFor(server: FakeServer): DocumentTransport {
  return {
    fetchDocument: async () => server.record(),
    fetchUpdates: async (_id, since, options) => {
      const updates = server.since(since);
      assertContiguous(updates, options?.expectFollowing === false ? {} : { after: since });
      return updates;
    },
    pushUpdates: async (_id, updates) => server.append(updates),
    compact: async (_id, body) => server.compact(body.snapshot_ciphertext, body.through_seq),
    unwrapDek: async () => DEK.slice(),
    listMeta: async () => [
      {
        id: 'doc',
        snapshot_seq: server.snapshotSeq,
        latest_seq: server.latestSeq(),
        revision: server.revision,
        version: 'v1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  };
}

function textOf(sync: DocumentSync): string {
  return sync.doc.getXmlFragment('default').toString();
}

async function openSync(server: FakeServer): Promise<DocumentSync> {
  const sync = new DocumentSync('doc', transportFor(server), { debounceMs: 0, pollIntervalMs: 0 });
  await sync.open();
  return sync;
}

describe('DocumentSync', () => {
  it('seals every delta before it leaves the device', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'hello');
    await sync.flush();

    const [stored] = server.since(0);
    expect(stored.ciphertext).not.toContain('hello');

    const opened = await openBlob(stored.ciphertext, DEK);
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, opened);
    expect(mirror.getText('body').toString()).toBe('hello');

    sync.destroy();
  });

  it('carries an edit from one device to another through the log', async () => {
    const server = new FakeServer();
    const laptop = await openSync(server);

    laptop.doc.getText('body').insert(0, 'from the laptop');
    await laptop.flush();

    const phone = await openSync(server);
    expect(phone.doc.getText('body').toString()).toBe('from the laptop');

    laptop.destroy();
    phone.destroy();
  });

  it('converges when two devices edit concurrently', async () => {
    const server = new FakeServer();
    const laptop = await openSync(server);
    const phone = await openSync(server);

    laptop.doc.getText('body').insert(0, 'laptop ');
    phone.doc.getText('body').insert(0, 'phone ');
    await laptop.flush();
    await phone.flush();

    await laptop.pull();
    await phone.pull();

    expect(laptop.doc.getText('body').toString()).toBe(phone.doc.getText('body').toString());
    expect(laptop.doc.getText('body').toString()).toContain('laptop');
    expect(laptop.doc.getText('body').toString()).toContain('phone');

    laptop.destroy();
    phone.destroy();
  });

  it('reuses the client_update_id on retry so a replay costs no sequence number', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    let failures = 1;
    const flaky: DocumentTransport = {
      ...transportFor(server),
      pushUpdates: async (id, updates) => {
        if (failures > 0) {
          failures -= 1;
          server.append(updates);
          throw new Error('network dropped after the server committed');
        }
        return server.append(updates);
      },
    };

    const retrying = new DocumentSync('doc', flaky, { debounceMs: 0, pollIntervalMs: 0 });
    await retrying.open();
    retrying.doc.getText('body').insert(0, 'once');

    await expect(retrying.flush()).rejects.toThrow('network dropped');
    await retrying.flush();

    expect(server.since(0)).toHaveLength(1);

    sync.destroy();
    retrying.destroy();
  });

  it('waits for a debounced flush already in flight rather than returning early', async () => {
    const server = new FakeServer();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow: DocumentTransport = {
      ...transportFor(server),
      pushUpdates: async (_id, updates) => {
        await gate;
        return server.append(updates);
      },
    };

    const sync = new DocumentSync('doc', slow, { debounceMs: 0, pollIntervalMs: 0 });
    await sync.open();

    sync.doc.getText('body').insert(0, 'first');
    const debounced = sync.flush();

    sync.doc.getText('body').insert(0, 'second ');
    const explicit = sync.flush();

    release();
    await Promise.all([debounced, explicit]);

    expect(sync.getState().pending).toBe(0);
    expect(server.since(0)).toHaveLength(2);

    sync.destroy();
  });

  it('resets the cursor after compacting, because a full prune restarts seq at 1', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'before compaction');
    await sync.flush();
    expect(server.latestSeq()).toBe(1);

    await sync.compact();
    expect(server.snapshotSeq).toBe(1);
    expect(sync.getState().cursor).toBe(0);

    sync.doc.getText('body').insert(0, 'after ');
    await sync.flush();
    expect(server.latestSeq()).toBe(1);

    const cold = await openSync(server);
    expect(cold.doc.getText('body').toString()).toBe('after before compaction');

    sync.destroy();
    cold.destroy();
  });

  it('refuses to compact once a gap has been seen', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    for (const word of ['one', 'two', 'three']) {
      sync.doc.getText('body').insert(0, word);
      await sync.flush();
    }

    server.dropUpdate(2);

    const cold = new DocumentSync('doc', transportFor(server), {
      debounceMs: 0,
      pollIntervalMs: 0,
    });
    await expect(cold.open()).rejects.toThrow(SequenceGapError);
    expect(cold.getState().gapDetected).toBe(true);
    await expect(cold.compact()).rejects.toThrow('refusing to compact');

    sync.destroy();
    cold.destroy();
  });

  it('keeps a delta under the server ceiling', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'x'.repeat(1000));
    await sync.flush();

    for (const stored of server.since(0)) {
      expect(stored.ciphertext.length).toBeLessThanOrEqual(MAX_UPDATE_CHARACTERS);
    }

    sync.destroy();
  });

  it('reports pending work while offline and drains it on reconnect', async () => {
    const server = new FakeServer();
    let online = false;

    const flaky: DocumentTransport = {
      ...transportFor(server),
      pushUpdates: async (id, updates) => {
        if (!online) {
          throw new Error('offline');
        }
        return server.append(updates);
      },
    };

    const sync = new DocumentSync('doc', flaky, { debounceMs: 0, pollIntervalMs: 0 });
    await sync.open();

    sync.doc.getText('body').insert(0, 'written on a plane');
    await expect(sync.flush()).rejects.toThrow('offline');
    expect(sync.getState().status).toBe('offline');
    expect(sync.getState().pending).toBe(1);

    online = true;
    await sync.flush();
    expect(sync.getState().status).toBe('synced');
    expect(sync.getState().pending).toBe(0);
    expect(server.since(0)).toHaveLength(1);

    sync.destroy();
  });

  it('restores an XML fragment from a snapshot alone', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    const fragment = sync.doc.getXmlFragment('default');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('a document body')]);
    fragment.insert(0, [paragraph]);

    await sync.flush();
    await sync.compact();
    expect(server.since(0)).toHaveLength(0);
    expect(server.snapshotCiphertext.length).toBeGreaterThan(0);

    const cold = await openSync(server);
    expect(textOf(cold)).toContain('a document body');

    sync.destroy();
    cold.destroy();
  });

  it('seals the snapshot too', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'secret prose');
    await sync.flush();
    await sync.compact();

    expect(server.snapshotCiphertext).not.toContain('secret prose');
    const opened = await openBlob(server.snapshotCiphertext, DEK);
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, opened);
    expect(mirror.getText('body').toString()).toBe('secret prose');

    sync.destroy();
  });

  it('re-reads the head instead of overwriting when compaction hits a stale revision', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'mine');
    await sync.flush();

    const conflicting: DocumentTransport = {
      ...transportFor(server),
      compact: async () => {
        const error = new Error('conflict') as Error & { code: string };
        error.code = 'CONFLICT';
        throw error;
      },
    };

    const stale = new DocumentSync('doc', conflicting, { debounceMs: 0, pollIntervalMs: 0 });
    await stale.open();
    await expect(stale.compact()).rejects.toThrow('conflict');
    expect(server.snapshotSeq).toBe(0);

    sync.destroy();
    stale.destroy();
  });

  it('round-trips a sealed blob through the document DEK', async () => {
    const sealed = await sealBlob(new Uint8Array([1, 2, 3]), DEK);
    expect(Array.from(await openBlob(sealed, DEK))).toEqual([1, 2, 3]);
  });
});
