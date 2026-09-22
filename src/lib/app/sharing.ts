import type {
  ConnectionRecord,
  ConnectionTrust,
  ItemType,
  SharedTextView,
} from '@/lib/sharing';
import { decodeSecretPayload, UNREADABLE_SECRET_NAME } from './vault';
import { noteTitle } from './notes';

export const SHARING_COPY = {
  title: 'Sharing',
  summary: 'Send an item to another Cryple account, without the server ever holding a key to it.',

  inviteTitle: 'Invite someone',
  inviteHint:
    'Ask them for their username and type it here. They have to accept before you can send ' +
    'anything, and once they have, you can send as much as you like.',
  inviteLabel: 'Their username',
  inviteSubmit: 'Send invitation',
  inviteSending: 'Sending…',
  inviteSent: (username: string) => `Invitation sent to ${username}.`,
  inviteUnknown: 'No account currently uses that username.',
  inviteExists: 'You are already connected to that account.',

  pendingInbound: 'Waiting for you',
  pendingOutbound: 'Waiting for them',
  connected: 'Connected',

  fingerprintTitle: 'Check their fingerprint before you accept',
  fingerprintWhy:
    'Read this code to them out loud, on a call or in person, and check it matches what they ' +
    'see. It is the fingerprint of their account key, which never changes. It is the one part ' +
    'of sharing that maths cannot do for you: if the server ever substituted another account ' +
    'for theirs, this is where it shows.',
  fingerprintMine: 'Yours',
  fingerprintTheirs: 'Theirs',
  fingerprintConfirm: 'It matches — accept',
  fingerprintDecline: 'Decline',
  fingerprintChanged:
    'This connection’s account key is not the one you first checked. An account key never ' +
    'changes, so someone may be intercepting it, and nothing more can be sent through it. Tell ' +
    'them through another channel, then disconnect and invite each other again.',
  fingerprintProofInvalid:
    'Their sharing keys could not be traced back to their account key, so they may not be ' +
    'theirs. Nothing can be sent through this connection until they can.',
  fingerprintAccountChanged:
    'The username on this connection now leads to a different account from the one you ' +
    'connected to, so nothing more can be sent through it.',
  fingerprintUncheckable:
    'This connection’s keys could not be checked, so nothing can be sent through it right now.',
  fingerprintUnaccepted:
    'This connection has not been accepted yet, so nothing can be sent through it.',
  fingerprintAlarmBadge: 'Do not send',

  reshareWarning:
    'Anything you send can be copied by the person you send it to. Only share with people you ' +
    'would trust with the contents.',

  inboxTitle: 'Shared with you',
  sharedEmptyHint:
    'When someone you are connected to sends you an item, it appears here, decrypted on this ' +
    'device.',
  inboxEmpty: 'Nothing has been shared with you yet.',
  open: 'Open',
  download: 'Download',
  opening: 'Opening…',
  staleConnection:
    'This connection was made by an older version of Cryple and its key exchange cannot be ' +
    'reproduced. Disconnect and invite each other again — nothing that was sent through it can ' +
    'be recovered.',
  lostConnection:
    'This connection is gone. To share again, send a new invitation and compare fingerprints ' +
    'again. A connection is never repaired by looking their username up again: the name may ' +
    'belong to someone else now.',
  nicknameLabel: 'Nickname',
  nicknameHint: 'Only you see it. It is sealed in your address book, never sent in the clear.',
  nicknameSave: 'Save nickname',
  copying: 'Copying…',
  copyExplain:
    'A copy is re-encrypted under a key of your own, so it survives the original being deleted ' +
    'or unshared. Anything you can read can be copied like this, which is why sharing never ' +
    'claims otherwise.',
  nothingToCopy: 'There is nothing to copy yet: they have not saved this document since sharing it.',
  connectionGone:
    'The connection this came through is gone, so this can no longer be opened. Ask them to ' +
    'invite you again — do not reuse the old one.',
  documentNotReadable:
    'Shared documents cannot be opened here yet. Everything needed to decrypt this one has ' +
    'arrived; the reader has not been built.',
  connectionsEmpty: 'You have no connections yet.',
  copyToMyAccount: 'Copy to my own account',
  copied: 'Copied to your account. Your copy is independent of theirs.',
  disconnect: 'Disconnect',
  disconnectWarning: 'Disconnecting deletes every share between you, in both directions.',
} as const;

export const ITEM_LABELS: Record<ItemType, string> = {
  secret: 'Secret',
  note: 'Note',
  document: 'Document',
  file: 'File',
};

export interface ConnectionGroups {
  awaitingMe: ConnectionRecord[];
  awaitingThem: ConnectionRecord[];
  accepted: ConnectionRecord[];
}

export function groupConnections(connections: readonly ConnectionRecord[]): ConnectionGroups {
  const groups: ConnectionGroups = { awaitingMe: [], awaitingThem: [], accepted: [] };

  for (const connection of connections) {
    if (connection.status === 'accepted') {
      groups.accepted.push(connection);
    } else if (connection.direction === 'inbound') {
      groups.awaitingMe.push(connection);
    } else {
      groups.awaitingThem.push(connection);
    }
  }

  return groups;
}

export function sendableConnections(
  connections: readonly ConnectionRecord[],
): ConnectionRecord[] {
  return connections.filter((connection) => connection.status === 'accepted');
}

export function connectionsToVerify(
  connections: readonly ConnectionRecord[],
): ConnectionRecord[] {
  return connections.filter(
    (connection) => connection.status === 'accepted' || connection.direction === 'outbound',
  );
}

export interface TrustAlarm {
  tone: 'danger' | 'warning';
  message: string;
  newInvitation: boolean;
}

export function trustAlarm(trust: ConnectionTrust): TrustAlarm | undefined {
  switch (trust.status) {
    case 'root-changed':
      return { tone: 'danger', message: SHARING_COPY.fingerprintChanged, newInvitation: true };
    case 'proof-invalid':
      return { tone: 'danger', message: SHARING_COPY.fingerprintProofInvalid, newInvitation: false };
    case 'account-changed':
      return {
        tone: 'danger',
        message: `${SHARING_COPY.fingerprintAccountChanged} ${SHARING_COPY.lostConnection}`,
        newInvitation: true,
      };
    case 'unresolvable':
      return {
        tone: 'warning',
        message: `${SHARING_COPY.fingerprintUncheckable} ${SHARING_COPY.lostConnection}`,
        newInvitation: true,
      };
    case 'trusted':
    case 'unpinned':
      return undefined;
  }
}

export function sendRefusal(trust: ConnectionTrust): string {
  return trustAlarm(trust)?.message ?? SHARING_COPY.fingerprintUnaccepted;
}

export function sharedSecretView(plaintext: string): SharedTextView {
  try {
    const { name, value } = decodeSecretPayload(plaintext);

    return { name, body: value };
  } catch {
    return { name: UNREADABLE_SECRET_NAME, body: plaintext };
  }
}

export function sharedNoteView(plaintext: string): SharedTextView {
  return { name: noteTitle(plaintext), body: plaintext };
}
