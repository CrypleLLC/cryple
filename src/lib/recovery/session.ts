import { ApiError, assertCanonicalUuid, request } from '@/lib/api';
import { zeroBytes } from '@/lib/encoding';
import { recoverSeedPhrase } from './rek';
import {
  unspecifiedRecoverySessionCrypto,
  type EphemeralSessionKeys,
  type RecoverySessionCrypto,
  type SessionShareContext,
} from './session-crypto';

export const SESSION_TTL_MINUTES = 30;
export const DEFAULT_POLL_INTERVAL_MS = 3_000;

export const SESSION_STATUSES = ['pending', 'shares_collected', 'completed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface CollectedShare {
  re_encrypted_share: string;
  submitted_at: string;
}

export interface RecoverySession {
  id: string;
  n_shares: number;
  k_threshold: number;
  status: SessionStatus;
  shares?: CollectedShare[];
  expires_at: string;
  created_at: string;
}

export interface RecoveryVault {
  encrypted_seed: string;
  n_shares: number;
  k_threshold: number;
  version: string;
}

export class SessionExpiredError extends Error {
  constructor() {
    super('the recovery session expired — start a fresh POST /recovery/request');
    this.name = 'SessionExpiredError';
  }
}

export interface StartRecoveryOptions {
  username: string;
  crypto?: RecoverySessionCrypto;
  timeoutMs?: number;
}

export interface StartedRecovery {
  session: RecoverySession;
  keys: EphemeralSessionKeys;
}

/**
 * NOT retry-safe: every call creates a new session row. Persist `session.id`
 * before the first attempt and resume by polling it.
 */
export async function startRecovery(
  options: StartRecoveryOptions,
): Promise<StartedRecovery> {
  const crypto = options.crypto ?? unspecifiedRecoverySessionCrypto;
  const keys = await crypto.generateEphemeralKeys();

  const response = await request<RecoverySession>({
    method: 'POST',
    path: '/recovery/request',
    timeoutMs: options.timeoutMs,
    body: {
      username: options.username,
      ephemeral_public_key: keys.publicKeyField,
    },
  });

  return { session: response.data, keys };
}

export async function getRecoverySession(
  sessionId: string,
  options: { timeoutMs?: number } = {},
): Promise<RecoverySession> {
  try {
    const response = await request<RecoverySession>({
      method: 'GET',
      path: `/recovery/session/${assertCanonicalUuid(sessionId, 'session_id')}`,
      timeoutMs: options.timeoutMs,
    });
    return response.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new SessionExpiredError();
    }
    throw error;
  }
}

export function sessionExpiresAt(session: RecoverySession): Date {
  return new Date(session.expires_at);
}

export function isSessionExpired(
  session: RecoverySession,
  now: Date = new Date(),
): boolean {
  return sessionExpiresAt(session).getTime() <= now.getTime();
}

export function hasReachedThreshold(session: RecoverySession): boolean {
  return session.status === 'shares_collected' && (session.shares?.length ?? 0) > 0;
}

export interface PollOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (session: RecoverySession) => void;
  timeoutMs?: number;
}

/**
 * Polls until the threshold is met. There are no webhooks; poll only while the
 * screen is open, and stop as soon as the session expires.
 */
export async function pollRecoverySession(
  sessionId: string,
  options: PollOptions = {},
): Promise<RecoverySession> {
  const interval = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException('polling aborted', 'AbortError');
    }

    const session = await getRecoverySession(sessionId, { timeoutMs: options.timeoutMs });
    options.onUpdate?.(session);

    if (hasReachedThreshold(session)) {
      return session;
    }
    if (isSessionExpired(session)) {
      throw new SessionExpiredError();
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval);
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('polling aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}

export async function getRecoveryVault(
  username: string,
  options: { timeoutMs?: number } = {},
): Promise<RecoveryVault> {
  const response = await request<RecoveryVault>({
    method: 'GET',
    path: '/recovery/vault',
    query: { username },
    timeoutMs: options.timeoutMs,
  });
  return response.data;
}

export interface CompleteRecoveryOptions {
  session: RecoverySession;
  keys: EphemeralSessionKeys;
  vault: RecoveryVault;
  shareContext: SessionShareContext;
  ownShare?: Uint8Array;
  crypto?: RecoverySessionCrypto;
}

export async function completeRecovery(
  options: CompleteRecoveryOptions,
): Promise<string> {
  const { session, keys, vault, shareContext, ownShare } = options;
  const crypto = options.crypto ?? unspecifiedRecoverySessionCrypto;

  if (!hasReachedThreshold(session)) {
    throw new Error('the session has not collected its threshold of shares yet');
  }

  const unwrapped: Uint8Array[] = [];

  try {
    for (const share of session.shares ?? []) {
      unwrapped.push(await crypto.unwrapShare(share.re_encrypted_share, keys, shareContext));
    }
    if (ownShare !== undefined) {
      unwrapped.push(ownShare);
    }

    if (unwrapped.length < vault.k_threshold) {
      throw new Error(
        `have ${unwrapped.length} shares, need ${vault.k_threshold} to reconstruct`,
      );
    }

    return await recoverSeedPhrase(vault.encrypted_seed, unwrapped);
  } finally {
    for (const share of unwrapped) {
      zeroBytes(share);
    }
  }
}

export function disposeEphemeralKeys(keys: EphemeralSessionKeys): void {
  zeroBytes(keys.x25519PrivateKey, keys.mlkemSecretKey);
}

export * from './session-crypto';
