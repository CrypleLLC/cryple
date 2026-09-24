import { InvalidChainError, verifyProofPath, type PublishedSharingKeys } from '@/lib/chain';
import type { AuthedContext } from '@/lib/context';
import type { SessionKeystore } from '@/lib/session';
import { getPublicKeys, resolveUsername } from '@/lib/users';
import type { ConnectionRecord } from './api';
import { editAddressBook, loadAddressBook, pinRoot } from './address-book';
import { rootFingerprint } from './keys';

export interface PublishedCounterparty {
  uuid: string;
  userAddress: string;
  rootPublicKey: string;
  fingerprint: string;
  sharingKeys: PublishedSharingKeys;
  proofVerified: boolean;
}

export type ConnectionTrust =
  | { status: 'trusted'; fingerprint: string }
  | { status: 'unpinned'; fingerprint: string }
  | { status: 'root-changed'; fingerprint: string; pinned: string }
  | { status: 'proof-invalid'; fingerprint: string }
  | { status: 'account-changed' }
  | { status: 'unresolvable' };

export class ConnectionNotTrustedError extends Error {
  readonly trust: ConnectionTrust;

  constructor(connection: Pick<ConnectionRecord, 'id'>, trust: ConnectionTrust) {
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

export function forgetPublishedCounterparties(session: SessionKeystore): void {
  sessionCounterparties(session).entries = new Map();
}

export async function fetchPublishedCounterparty(
  context: AuthedContext,
  username: string,
): Promise<PublishedCounterparty | undefined> {
  const resolved = await resolveUsername(context, username);
  if (!resolved) {
    return undefined;
  }
  const published = await getPublicKeys(context, resolved.uuid);
  let proofVerified = true;
  try {
    verifyProofPath(
      published.user_address,
      published.root_public_key,
      published.sharing_keys,
      published.proof ?? [],
    );
  } catch (error) {
    if (!(error instanceof InvalidChainError)) {
      throw error;
    }
    proofVerified = false;
  }
  return {
    uuid: resolved.uuid,
    userAddress: published.user_address,
    rootPublicKey: published.root_public_key,
    fingerprint: await rootFingerprint(published.root_public_key),
    sharingKeys: published.sharing_keys,
    proofVerified,
  };
}

export async function publishedCounterparty(
  context: AuthedContext,
  connection: Pick<ConnectionRecord, 'id' | 'username'>,
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

export async function judgeCounterparty(
  context: AuthedContext,
  published: PublishedCounterparty,
  options: { mayPin: boolean },
): Promise<ConnectionTrust> {
  const { fingerprint } = published;
  if (!published.proofVerified) {
    return { status: 'proof-invalid', fingerprint };
  }

  let book = await loadAddressBook(context);
  let pinned = book.pins[published.userAddress];
  if (pinned === undefined) {
    if (!options.mayPin) {
      return { status: 'unpinned', fingerprint };
    }
    book = await editAddressBook(context, pinRoot(published.userAddress, published.rootPublicKey));
    pinned = book.pins[published.userAddress];
  }

  if (pinned.root_public_key !== published.rootPublicKey) {
    return {
      status: 'root-changed',
      fingerprint,
      pinned: await rootFingerprint(pinned.root_public_key),
    };
  }
  return { status: 'trusted', fingerprint };
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
  const awaitingMe = connection.status !== 'accepted' && connection.direction === 'inbound';
  return judgeCounterparty(context, published, { mayPin: !awaitingMe });
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

export async function ownRootFingerprint(context: AuthedContext): Promise<string> {
  return rootFingerprint(context.session.rootPublicKey);
}
