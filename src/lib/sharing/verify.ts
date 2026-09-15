import type { AuthedContext } from '@/lib/context';
import type { SessionKeystore } from '@/lib/session';
import { getPublicKeys, resolveUsername } from '@/lib/users';
import type { ConnectionRecord } from './api';
import { keyFingerprint, publishedRecipientKeys } from './keys';
import { fingerprintPinOptions, pinFingerprint, readFingerprintPin } from './pins';

export interface PublishedCounterparty {
  userAddress: string;
  fingerprint: string;
}

export type ConnectionTrust =
  | { status: 'trusted'; fingerprint: string }
  | { status: 'unpinned'; fingerprint: string }
  | { status: 'keys-changed'; fingerprint: string; pinned: string }
  | { status: 'account-changed' }
  | { status: 'unresolvable' };

export class ConnectionNotTrustedError extends Error {
  readonly trust: ConnectionTrust;

  constructor(connection: ConnectionRecord, trust: ConnectionTrust) {
    super(`refusing to send through connection ${connection.id}: ${trust.status}`);
    this.name = 'ConnectionNotTrustedError';
    this.trust = trust;
  }
}

interface SessionCounterparties {
  entries: Map<string, PublishedCounterparty>;
}

const counterpartiesBySession = new WeakMap<SessionKeystore, SessionCounterparties>();

function sessionCounterparties(session: SessionKeystore): SessionCounterparties {
  const known = counterpartiesBySession.get(session);
  if (known !== undefined) {
    return known;
  }

  const created: SessionCounterparties = { entries: new Map() };
  session.onLock(() => {
    created.entries = new Map();
  });
  counterpartiesBySession.set(session, created);
  return created;
}

async function fetchPublishedCounterparty(
  context: AuthedContext,
  username: string,
): Promise<PublishedCounterparty | undefined> {
  const resolved = await resolveUsername(context, username);
  if (!resolved) {
    return undefined;
  }

  const published = await getPublicKeys(context, resolved.uuid);
  return {
    userAddress: published.user_address,
    fingerprint: await keyFingerprint(publishedRecipientKeys(published)),
  };
}

export async function publishedCounterparty(
  context: AuthedContext,
  connection: ConnectionRecord,
): Promise<PublishedCounterparty | undefined> {
  const holder = sessionCounterparties(context.session);
  const entries = holder.entries;
  const cacheKey = `${connection.id}|${connection.username}`;

  const cached = entries.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const fetched = await fetchPublishedCounterparty(context, connection.username);
  if (fetched !== undefined && holder.entries === entries) {
    entries.set(cacheKey, fetched);
  }
  return fetched;
}

export async function verifyConnection(
  context: AuthedContext,
  connection: ConnectionRecord,
): Promise<ConnectionTrust> {
  const published = await publishedCounterparty(context, connection);
  if (published === undefined) {
    return { status: 'unresolvable' };
  }
  if (published.userAddress !== connection.user_address) {
    return { status: 'account-changed' };
  }

  const { fingerprint } = published;
  const pins = fingerprintPinOptions(context);
  const pinned = await readFingerprintPin(connection.id, pins);

  if (pinned === undefined && connection.status !== 'accepted') {
    return { status: 'unpinned', fingerprint };
  }

  const standing = pinned ?? (await pinFingerprint(connection.id, fingerprint, pins));
  return standing === fingerprint
    ? { status: 'trusted', fingerprint }
    : { status: 'keys-changed', fingerprint, pinned: standing };
}

export async function assertConnectionTrusted(
  context: AuthedContext,
  connection: ConnectionRecord,
): Promise<void> {
  const trust = await verifyConnection(context, connection);
  if (trust.status !== 'trusted') {
    throw new ConnectionNotTrustedError(connection, trust);
  }
}
