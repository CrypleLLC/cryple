import * as Y from 'yjs';
import { ApiError } from '@/lib/api';
import { zeroBytes } from '@/lib/encoding';
import { openUpdate, sealUpdate } from './crypto';
import {
  MAX_UPDATE_CHARACTERS,
  SequenceGapError,
  assertLogFollows,
  highestSeq,
  type AppendResult,
  type DocumentMetaRecord,
  type DocumentRecord,
  type DocumentUpdateRecord,
  type PendingUpdate,
} from './records';

export const REMOTE_ORIGIN = Symbol('cryple/documents/remote');
export const DEFAULT_DEBOUNCE_MS = 1500;
export const DEFAULT_POLL_INTERVAL_MS = 20_000;
export const DEFAULT_COMPACT_THRESHOLD = 64;
export const MAX_UPDATE_RAW_BYTES = Math.floor((MAX_UPDATE_CHARACTERS * 3) / 4) - 64;

export interface DocumentTransport {
  fetchDocument(id: string): Promise<DocumentRecord>;
  fetchUpdates(
    id: string,
    since: number,
    options?: { expectFollowing?: boolean },
  ): Promise<DocumentUpdateRecord[]>;
  pushUpdates(id: string, updates: readonly PendingUpdate[]): Promise<AppendResult>;
  compact(
    id: string,
    body: { snapshot_ciphertext: string; through_seq: number; expected_revision?: number },
  ): Promise<DocumentRecord>;
  unwrapDek(document: Pick<DocumentRecord, 'wrapped_dek'>): Promise<Uint8Array>;
  listMeta(): Promise<DocumentMetaRecord[]>;
}

export type SyncStatus = 'idle' | 'loading' | 'synced' | 'saving' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  cursor: number;
  snapshotSeq: number;
  revision: number;
  pending: number;
  lastSavedAt?: number;
  error?: string;
  gapDetected: boolean;
}

export interface DocumentSyncOptions {
  debounceMs?: number;
  pollIntervalMs?: number;
  compactThreshold?: number;
  now?: () => number;
}

export class DocumentSync {
  readonly doc = new Y.Doc();
  readonly id: string;

  private readonly transport: DocumentTransport;
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;
  private readonly compactThreshold: number;
  private readonly now: () => number;
  private readonly listeners = new Set<(state: SyncState) => void>();

  private dek?: Uint8Array;
  private queued: Uint8Array[] = [];
  private inFlight?: PendingUpdate;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private flushing?: Promise<void>;
  private destroyed = false;
  private updateHandler?: (update: Uint8Array, origin: unknown) => void;

  private state: SyncState = {
    status: 'idle',
    cursor: 0,
    snapshotSeq: 0,
    revision: 0,
    pending: 0,
    gapDetected: false,
  };

  constructor(id: string, transport: DocumentTransport, options: DocumentSyncOptions = {}) {
    this.id = id;
    this.transport = transport;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.compactThreshold = options.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD;
    this.now = options.now ?? (() => Date.now());
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => void this.listeners.delete(listener);
  }

  async open(): Promise<void> {
    this.patch({ status: 'loading' });

    const record = await this.transport.fetchDocument(this.id);
    this.dek = await this.transport.unwrapDek(record);

    if (record.snapshot_ciphertext.length > 0) {
      const snapshot = await openUpdate(record.snapshot_ciphertext, this.dek);
      try {
        Y.applyUpdate(this.doc, snapshot, REMOTE_ORIGIN);
      } finally {
        zeroBytes(snapshot);
      }
    }

    this.patch({
      snapshotSeq: record.snapshot_seq,
      revision: record.revision,
      cursor: 0,
    });

    await this.pull({ coldStart: true });

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN || this.destroyed) {
        return;
      }
      this.queued.push(update.slice());
      this.patch({ status: 'saving', pending: this.pendingCount() });
      this.scheduleFlush();
    };
    this.doc.on('update', this.updateHandler);

    this.patch({ status: 'synced' });
  }

  async pull(options: { coldStart?: boolean } = {}): Promise<number> {
    const dek = this.requireDek();
    const since = this.state.cursor;

    let updates: DocumentUpdateRecord[];
    try {
      updates = await this.transport.fetchUpdates(this.id, since, {
        expectFollowing: options.coldStart !== true,
      });
      if (options.coldStart === true) {
        assertLogFollows(updates, this.state.snapshotSeq);
      }
    } catch (error) {
      if (error instanceof SequenceGapError) {
        this.patch({ gapDetected: true, status: 'error', error: error.message });
      }
      throw error;
    }

    for (const update of updates) {
      const bytes = await openUpdate(update.ciphertext, dek);
      try {
        Y.applyUpdate(this.doc, bytes, REMOTE_ORIGIN);
      } finally {
        zeroBytes(bytes);
      }
    }

    this.patch({ cursor: highestSeq(since, updates) });
    return updates.length;
  }

  async poll(): Promise<boolean> {
    const meta = (await this.transport.listMeta()).find((entry) => entry.id === this.id);
    if (meta === undefined) {
      return false;
    }
    if (meta.revision !== this.state.revision) {
      await this.refreshHead();
      return true;
    }
    if (meta.latest_seq <= this.state.cursor) {
      return false;
    }
    await this.pull();
    return true;
  }

  startPolling(): () => void {
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.poll().catch(() => this.markOffline()), this.pollIntervalMs);
    this.pollTimer.unref?.();
    return () => this.stopPolling();
  }

  stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async flush(): Promise<void> {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    const running = this.flushing;
    if (running !== undefined) {
      await running.catch(() => undefined);
    }
    if (this.inFlight === undefined && this.queued.length === 0) {
      return;
    }

    const pass = this.drain();
    this.flushing = pass;
    try {
      await pass;
    } finally {
      if (this.flushing === pass) {
        this.flushing = undefined;
      }
    }
  }

  private async drain(): Promise<void> {
    while (this.inFlight !== undefined || this.queued.length > 0) {
      const batch = await this.takeBatch();
      if (batch === undefined) {
        return;
      }

      try {
        const result = await this.transport.pushUpdates(this.id, [batch]);
        this.inFlight = undefined;
        this.patch({
          cursor: this.cursorAfterAppend(result),
          status: this.pendingCount() > 0 ? 'saving' : 'synced',
          pending: this.pendingCount(),
          lastSavedAt: this.now(),
          error: undefined,
        });
      } catch (error) {
        this.inFlight = batch;
        this.markOffline(error);
        throw error;
      }
    }
  }

  async compact(): Promise<void> {
    if (this.state.gapDetected) {
      throw new Error('refusing to compact: a gap in the update log means unmerged data is missing');
    }

    const dek = this.requireDek();
    await this.flush();

    const through = this.state.cursor;
    if (through <= this.state.snapshotSeq) {
      return;
    }

    const snapshot = Y.encodeStateAsUpdate(this.doc);
    let installed: DocumentRecord;
    try {
      installed = await this.transport.compact(this.id, {
        snapshot_ciphertext: await sealUpdate(snapshot, dek),
        through_seq: through,
        expected_revision: this.state.revision,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        await this.refreshHead();
        return;
      }
      throw error;
    } finally {
      zeroBytes(snapshot);
    }

    this.patch({
      snapshotSeq: installed.snapshot_seq,
      revision: installed.revision,
      cursor: 0,
    });

    await this.pull({ coldStart: true });
  }

  shouldCompact(): boolean {
    return !this.state.gapDetected && this.state.cursor - this.state.snapshotSeq >= this.compactThreshold;
  }

  async close(): Promise<void> {
    this.stopPolling();
    try {
      await this.flush();
      if (this.shouldCompact()) {
        await this.compact();
      }
    } finally {
      this.destroy();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPolling();
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.updateHandler !== undefined) {
      this.doc.off('update', this.updateHandler);
      this.updateHandler = undefined;
    }
    zeroBytes(this.dek);
    this.dek = undefined;
    for (const update of this.queued) {
      zeroBytes(update);
    }
    this.queued = [];
    this.doc.destroy();
    this.listeners.clear();
  }

  private cursorAfterAppend(result: AppendResult): number {
    return result.latest_seq === this.state.cursor + result.applied
      ? result.latest_seq
      : this.state.cursor;
  }

  private async refreshHead(): Promise<void> {
    const dek = this.requireDek();
    const record = await this.transport.fetchDocument(this.id);

    if (record.snapshot_ciphertext.length > 0) {
      const snapshot = await openUpdate(record.snapshot_ciphertext, dek);
      try {
        Y.applyUpdate(this.doc, snapshot, REMOTE_ORIGIN);
      } finally {
        zeroBytes(snapshot);
      }
    }

    this.patch({
      snapshotSeq: record.snapshot_seq,
      revision: record.revision,
      cursor: 0,
    });
    await this.pull({ coldStart: true });
  }

  private async takeBatch(): Promise<PendingUpdate | undefined> {
    if (this.inFlight !== undefined) {
      return this.inFlight;
    }
    if (this.queued.length === 0) {
      return undefined;
    }

    const take = this.queued.length === 1 ? 1 : this.chunkSize();
    const chunk = this.queued.slice(0, take);
    this.queued = this.queued.slice(take);

    const merged = Y.mergeUpdates(chunk);

    try {
      const ciphertext = await sealUpdate(merged, this.requireDek());
      if (ciphertext.length > MAX_UPDATE_CHARACTERS) {
        throw new Error(
          `sealed update is ${ciphertext.length} characters, over the server ceiling of ` +
            `${MAX_UPDATE_CHARACTERS} — compact this document before editing further`,
        );
      }

      const pending: PendingUpdate = {
        client_update_id: crypto.randomUUID(),
        ciphertext,
      };
      this.inFlight = pending;
      return pending;
    } finally {
      zeroBytes(merged);
      for (const update of chunk) {
        zeroBytes(update);
      }
    }
  }

  private chunkSize(): number {
    let bytes = 0;
    for (let index = 0; index < this.queued.length; index++) {
      bytes += this.queued[index].length;
      if (bytes > MAX_UPDATE_RAW_BYTES) {
        return Math.max(index, 1);
      }
    }
    return this.queued.length;
  }

  private scheduleFlush(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.flush().catch(() => undefined);
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  private pendingCount(): number {
    return this.queued.length + (this.inFlight === undefined ? 0 : 1);
  }

  private markOffline(error?: unknown): void {
    this.patch({
      status: 'offline',
      pending: this.pendingCount(),
      error: error instanceof Error ? error.message : undefined,
    });
  }

  private requireDek(): Uint8Array {
    if (this.dek === undefined) {
      throw new Error('document is not open — call open() before syncing');
    }
    return this.dek;
  }

  private patch(next: Partial<SyncState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
