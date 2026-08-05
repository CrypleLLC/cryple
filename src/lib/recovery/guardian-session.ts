import { assertCanonicalUuid, collectPages, request, type PageRequest } from '@/lib/api';
import { pqxdhUnwrap } from '@/lib/pqxdh';
import { signActionEnvelope } from '@/lib/signing';
import { requireToken, type AuthedContext } from '@/lib/context';
import { zeroBytes } from '@/lib/encoding';
import {
  unspecifiedRecoverySessionCrypto,
  type RecoverySessionCrypto,
} from './session-crypto';

export const GUARDIAN_INBOX_POLL_INTERVAL_MS = 60_000;

export interface PendingSession {
  session_id: string;
  owner_username: string;
  ephemeral_public_key: string;
  submitted: boolean;
  expires_at: string;
  created_at: string;
}

export interface StoredShare {
  session_id: string;
  ephemeral_public_key: string;
  pq_hybrid_encrypted_share: string;
}

export async function listPendingSessions(
  context: AuthedContext,
): Promise<PendingSession[]> {
  return collectPages<PendingSession>((page: PageRequest) =>
    request<PendingSession[]>({
      method: 'GET',
      path: '/recovery/sessions/pending',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      query: { limit: page.limit, cursor: page.cursor },
    }),
  );
}

export function awaitingSubmission(sessions: readonly PendingSession[]): PendingSession[] {
  return sessions.filter((session) => !session.submitted);
}

export async function getStoredShare(
  context: AuthedContext,
  sessionId: string,
): Promise<StoredShare> {
  const response = await request<StoredShare>({
    method: 'GET',
    path: `/recovery/share/${assertCanonicalUuid(sessionId, 'session_id')}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export interface UnwrapOwnShareOptions {
  storedShare: string;
  ownerUserAddress: string;
  guardianUserAddress: string;
  x25519PrivateKey: Uint8Array;
  mlkemSecretKey: Uint8Array;
}

/**
 * Fully specified: the owner wrapped this with usage `recovery-share`,
 * sender = owner, recipient = this guardian.
 */
export async function unwrapOwnShare(
  options: UnwrapOwnShareOptions,
): Promise<Uint8Array> {
  return pqxdhUnwrap(
    options.storedShare,
    {
      x25519PrivateKey: options.x25519PrivateKey,
      mlkemSecretKey: options.mlkemSecretKey,
    },
    {
      usage: 'recovery-share',
      senderUserAddress: options.ownerUserAddress,
      recipientUserAddress: options.guardianUserAddress,
    },
  );
}

export async function submitReEncryptedShare(
  context: AuthedContext,
  sessionId: string,
  reEncryptedShare: string,
): Promise<void> {
  const canonical = assertCanonicalUuid(sessionId, 'session_id');

  if (reEncryptedShare.length === 0) {
    throw new Error('re_encrypted_share must not be empty');
  }

  const envelope = signActionEnvelope(
    'recovery-share-submit',
    [canonical, reEncryptedShare],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  await request<void>({
    method: 'POST',
    path: '/recovery/submit',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { session_id: canonical, re_encrypted_share: reEncryptedShare, ...envelope },
  });
}

export interface ContributeOptions {
  ownerUserAddress: string;
  guardianUserAddress: string;
  recoveringUserAddress: string;
  x25519PrivateKey: Uint8Array;
  mlkemSecretKey: Uint8Array;
  crypto?: RecoverySessionCrypto;
}

/**
 * The whole guardian contribution: fetch, unwrap, re-wrap, submit.
 * The re-wrap step depends on the unspecified `recovery-session` binding.
 */
export async function contributeShare(
  context: AuthedContext,
  sessionId: string,
  options: ContributeOptions,
): Promise<void> {
  const sessionCrypto = options.crypto ?? unspecifiedRecoverySessionCrypto;
  const stored = await getStoredShare(context, sessionId);

  let plaintextShare: Uint8Array | undefined;
  try {
    plaintextShare = await unwrapOwnShare({
      storedShare: stored.pq_hybrid_encrypted_share,
      ownerUserAddress: options.ownerUserAddress,
      guardianUserAddress: options.guardianUserAddress,
      x25519PrivateKey: options.x25519PrivateKey,
      mlkemSecretKey: options.mlkemSecretKey,
    });

    const reEncrypted = await sessionCrypto.rewrapToSession(
      plaintextShare,
      stored.ephemeral_public_key,
      {
        senderUserAddress: options.guardianUserAddress,
        recipientUserAddress: options.recoveringUserAddress,
      },
    );

    await submitReEncryptedShare(context, sessionId, reEncrypted);
  } finally {
    zeroBytes(plaintextShare);
  }
}
