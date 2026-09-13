import { describe, expect, it } from 'vitest';
import { describeReceived, UNREADABLE_SHARED_NAME } from './received';
import type { ConnectionRecord, InboundShareRecord } from './api';
import type { AuthedContext } from '@/lib/context';

const context = {} as AuthedContext;

function share(over: Partial<InboundShareRecord> = {}): InboundShareRecord {
  return {
    id: '0e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e',
    connection_id: '1e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e',
    item_type: 'file',
    item_id: '2e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e',
    wrapped_dek: 'd3Jhcm1lZA==',
    created_at: '2026-09-11T00:00:00Z',
    sender_username: 'pedrosilva',
    ...over,
  };
}

const connection: ConnectionRecord = {
  id: '1e2a4c6e-8b0d-4f4a-8c8e-0b2d4f6a8c0e',
  direction: 'inbound',
  username: 'pedrosilva',
  user_address: 'a'.repeat(64),
  status: 'accepted',
  pqxdh_blob: 'not-a-real-blob',
  created_at: '2026-09-11T00:00:00Z',
};

const view = (plaintext: string) => ({ name: plaintext, body: plaintext });

describe('describing a received item that cannot be opened', () => {
  it('resolves rather than throwing, so one bad share cannot empty the screen', async () => {
    const item = await describeReceived(context, share(), connection, view, view);

    expect(item.readable).toBe(false);
    expect(item.name).toBe(UNREADABLE_SHARED_NAME);
    expect(item.problem).toBeDefined();
  });

  it('names the step that failed, so a report says where to look', async () => {
    const item = await describeReceived(context, share(), connection, view, view);

    expect(item.problem).toMatch(
      /deriving the connection key|unwrapping the item key|fetching the item|opening the payload/,
    );
  });

  it('says the connection is gone when there is none', async () => {
    const item = await describeReceived(context, share(), undefined, view, view);

    expect(item.problem).toMatch(/connection/i);
  });

  it('says so when the share arrived without a wrapped key', async () => {
    const item = await describeReceived(
      context,
      share({ wrapped_dek: undefined }),
      connection,
      view,
      view,
    );

    expect(item.problem).toMatch(/wrapped key/i);
  });

  it('keeps the sender and the type even when it cannot read the payload', async () => {
    const item = await describeReceived(context, share(), connection, view, view);

    expect(item.from).toBe('pedrosilva');
    expect(item.itemType).toBe('file');
    expect(item.connectionId).toBe(connection.id);
  });
});
