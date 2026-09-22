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
import { connectionWith, type ConnectionRecord, type ConnectionTrust } from '@/lib/sharing';

function connection(over: Partial<ConnectionRecord>): ConnectionRecord {
  return {
    id: 'c',
    direction: 'outbound',
    username: 'pedrosilva',
    user_address: 'a'.repeat(64),
    status: 'pending',
    sender_key_generation: 1,
    recipient_key_generation: 1,
    keys: [],
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
    { status: 'root-changed', fingerprint: 'CCCC-DDDD', pinned: 'AAAA-BBBB' },
    { status: 'proof-invalid', fingerprint: 'CCCC-DDDD' },
    { status: 'account-changed' },
    { status: 'unresolvable' },
    { status: 'unpinned', fingerprint: 'AAAA-BBBB' },
  ];

  it('raises nothing for a trusted connection or an invitation not yet accepted', () => {
    expect(trustAlarm({ status: 'trusted', fingerprint: 'AAAA-BBBB' })).toBeUndefined();
    expect(trustAlarm({ status: 'unpinned', fingerprint: 'AAAA-BBBB' })).toBeUndefined();
  });

  it('raises a danger alarm when the root key, the proof path or the account changed', () => {
    expect(
      trustAlarm({ status: 'root-changed', fingerprint: 'CCCC-DDDD', pinned: 'AAAA-BBBB' }),
    ).toEqual({ tone: 'danger', message: SHARING_COPY.fingerprintChanged, newInvitation: true });
    expect(trustAlarm({ status: 'proof-invalid', fingerprint: 'CCCC-DDDD' })?.tone).toBe('danger');
    expect(trustAlarm({ status: 'account-changed' })?.tone).toBe('danger');
    expect(trustAlarm({ status: 'account-changed' })?.message).toContain(
      SHARING_COPY.fingerprintAccountChanged,
    );
  });

  it('offers a new invitation for a connection whose counterparty is gone, never a silent repair', () => {
    for (const trust of [{ status: 'unresolvable' }, { status: 'account-changed' }] as const) {
      const alarm = trustAlarm(trust);
      expect(alarm?.newInvitation).toBe(true);
      expect(alarm?.message).toContain(SHARING_COPY.lostConnection);
    }
    expect(SHARING_COPY.lostConnection).toMatch(/new invitation/);
    expect(SHARING_COPY.lostConnection).toMatch(/never repaired/);
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

describe('one connection works both ways', () => {
  it('says so where the invitation is made', () => {
    expect(SHARING_COPY.inviteHint).toMatch(/both send each other/);
    expect(SHARING_COPY.inviteExists).toMatch(/both directions/);
  });

  it('finds an existing connection with a username whoever invited, normalised as typed', () => {
    const existing = [
      connection({ id: 'a', direction: 'inbound', status: 'accepted', username: 'anacosta' }),
      connection({ id: 'b', direction: 'outbound', status: 'pending', username: 'joaquim' }),
    ];
    expect(connectionWith(existing, '  AnaCosta ')?.id).toBe('a');
    expect(connectionWith(existing, 'joaquim')?.id).toBe('b');
    expect(connectionWith(existing, 'rui')).toBeUndefined();
  });

  it('offers an accepted connection for sending, whichever side invited', () => {
    const sendable = sendableConnections([
      connection({ id: 'invited-me', direction: 'inbound', status: 'accepted' }),
      connection({ id: 'i-invited', direction: 'outbound', status: 'accepted' }),
    ]);
    expect(sendable.map((c) => c.id)).toEqual(['invited-me', 'i-invited']);
  });
});
