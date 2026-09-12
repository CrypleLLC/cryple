import { describe, expect, it } from 'vitest';
import {
  fingerprintChanged,
  groupConnections,
  sendableConnections,
  sharedNoteView,
  sharedSecretView,
  SHARING_COPY,
} from './sharing';
import { encodeSecretPayload, UNREADABLE_SECRET_NAME } from './vault';
import type { ConnectionRecord } from '@/lib/sharing';

function connection(over: Partial<ConnectionRecord>): ConnectionRecord {
  return {
    id: 'c',
    direction: 'outbound',
    username: 'pedrosilva',
    user_address: 'a'.repeat(64),
    status: 'pending',
    created_at: '2026-09-11T00:00:00Z',
    ...over,
  };
}

describe('grouping connections', () => {
  it('separates the ones waiting on me from the ones waiting on them', () => {
    const groups = groupConnections([
      connection({ id: 'a', direction: 'inbound', status: 'pending' }),
      connection({ id: 'b', direction: 'outbound', status: 'pending' }),
      connection({ id: 'c', direction: 'inbound', status: 'accepted' }),
    ]);

    expect(groups.awaitingMe.map((c) => c.id)).toEqual(['a']);
    expect(groups.awaitingThem.map((c) => c.id)).toEqual(['b']);
    expect(groups.accepted.map((c) => c.id)).toEqual(['c']);
  });

  it('never offers a pending connection as somewhere to send', () => {
    const sendable = sendableConnections([
      connection({ id: 'a', status: 'pending', direction: 'inbound' }),
      connection({ id: 'b', status: 'pending', direction: 'outbound' }),
      connection({ id: 'c', status: 'accepted' }),
    ]);

    expect(sendable.map((c) => c.id)).toEqual(['c']);
  });
});

describe('the fingerprint pin', () => {
  it('raises nothing on a first sighting', () => {
    expect(fingerprintChanged(undefined, 'AAAA-BBBB')).toBe(false);
  });

  it('raises when the pinned value no longer matches', () => {
    expect(fingerprintChanged('AAAA-BBBB', 'CCCC-DDDD')).toBe(true);
    expect(fingerprintChanged('AAAA-BBBB', 'AAAA-BBBB')).toBe(false);
  });
});

describe('the copy', () => {
  it('never claims a share can be un-read', () => {
    expect(SHARING_COPY.revokeWarning).toMatch(/cannot take back/i);
  });

  it('says plainly that a recipient can copy what they receive', () => {
    expect(SHARING_COPY.reshareWarning).toMatch(/can be copied/i);
  });

  it('warns that deleting the original breaks the recipient', () => {
    expect(SHARING_COPY.deleteOriginalWarning).toMatch(/stops working for them/i);
  });

  it('heads the rules block without promising a share can be undone', () => {
    expect(SHARING_COPY.rulesTitle).toMatch(/cannot undo/i);
  });

  it('asks for an out-of-band fingerprint check in words a person can act on', () => {
    expect(SHARING_COPY.fingerprintWhy).toMatch(/out loud|in person/i);
  });
});

describe('a connection that is gone', () => {
  it('tells the reader to ask for a new invitation, never to reuse the old one', () => {
    expect(SHARING_COPY.connectionGone).toMatch(/invite you again/i);
    expect(SHARING_COPY.connectionGone).toMatch(/do not reuse/i);
  });
});

describe('what a received text item shows when it is opened', () => {
  it('shows a secret as its value, never the envelope it travelled in', () => {
    const plaintext = encodeSecretPayload({ name: 'Router login', value: 'hunter2' });

    expect(sharedSecretView(plaintext)).toEqual({ name: 'Router login', body: 'hunter2' });
    expect(sharedSecretView(plaintext).body).not.toMatch(/"name"|"value"/);
  });

  it('falls back to the raw text when a secret was not written by this vault', () => {
    expect(sharedSecretView('not json')).toEqual({
      name: UNREADABLE_SECRET_NAME,
      body: 'not json',
    });
  });

  it('shows a note in full, titled by its first line', () => {
    expect(sharedNoteView('# Title\nbody')).toEqual({
      name: 'Title',
      body: '# Title\nbody',
    });
  });
});
