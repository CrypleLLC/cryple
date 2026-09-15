import { describe, expect, it } from 'vitest';
import {
  connectionsToVerify,
  groupConnections,
  sendableConnections,
  sendRefusal,
  sharedNoteView,
  sharedSecretView,
  SHARING_COPY,
  trustAlarm,
} from './sharing';
import { encodeSecretPayload, UNREADABLE_SECRET_NAME } from './vault';
import type { ConnectionRecord, ConnectionTrust } from '@/lib/sharing';

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

describe('what a connection check shows', () => {
  const refused: ConnectionTrust[] = [
    { status: 'keys-changed', fingerprint: 'CCCC-DDDD', pinned: 'AAAA-BBBB' },
    { status: 'account-changed' },
    { status: 'unresolvable' },
    { status: 'unpinned', fingerprint: 'AAAA-BBBB' },
  ];

  it('raises nothing for a trusted connection or an invitation not yet accepted', () => {
    expect(trustAlarm({ status: 'trusted', fingerprint: 'AAAA-BBBB' })).toBeUndefined();
    expect(trustAlarm({ status: 'unpinned', fingerprint: 'AAAA-BBBB' })).toBeUndefined();
  });

  it('raises a danger alarm when the keys or the account behind a connection changed', () => {
    expect(
      trustAlarm({ status: 'keys-changed', fingerprint: 'CCCC-DDDD', pinned: 'AAAA-BBBB' }),
    ).toEqual({ tone: 'danger', message: SHARING_COPY.fingerprintChanged });
    expect(trustAlarm({ status: 'account-changed' })).toEqual({
      tone: 'danger',
      message: SHARING_COPY.fingerprintAccountChanged,
    });
  });

  it('warns rather than alarms when the keys could not be checked', () => {
    expect(trustAlarm({ status: 'unresolvable' })?.tone).toBe('warning');
  });

  it('tells the person that nothing was sent, for every refusal', () => {
    for (const trust of refused) {
      expect(sendRefusal(trust)).toMatch(/nothing (more )?can be sent/i);
    }
  });

  it('sends a changed fingerprint to a new invitation, never a repair', () => {
    expect(SHARING_COPY.fingerprintChanged).toMatch(/invite each other again/i);
  });

  it('checks accepted connections and invitations this account sent, not ones awaiting me', () => {
    const checked = connectionsToVerify([
      connection({ id: 'a', direction: 'inbound', status: 'pending' }),
      connection({ id: 'b', direction: 'outbound', status: 'pending' }),
      connection({ id: 'c', direction: 'inbound', status: 'accepted' }),
    ]);

    expect(checked.map((c) => c.id)).toEqual(['b', 'c']);
  });
});

describe('the copy', () => {
  it('says plainly that a recipient can copy what they receive', () => {
    expect(SHARING_COPY.reshareWarning).toMatch(/can be copied/i);
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
