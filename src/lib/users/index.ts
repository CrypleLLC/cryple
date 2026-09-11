import { ApiError, assertCanonicalUuid, request, USERNAME_MALFORMED } from '@/lib/api';
import { deriveServerAuthToken } from '@/lib/pin';
import { signActionEnvelope } from '@/lib/signing';
import { requireToken, type AuthedContext } from '@/lib/context';

const USER_ADDRESS_PATTERN = /^[0-9a-f]{64}$/;

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

export class MalformedUsernameError extends Error {
  readonly userMessage = USERNAME_MALFORMED;

  constructor(value: string) {
    super(`"${value}" does not match ${USERNAME_PATTERN.source}`);
    this.name = 'MalformedUsernameError';
  }
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export interface AccountRecord {
  user_address: string;
  username: string;
  uuid: string;
  has_password: boolean;
  created_at: string;
}

export interface UsernameResolution {
  uuid: string;
  username: string;
}

export interface PublicKeysRecord {
  uuid: string;
  encryption_public_key_x25519: string;
  encryption_public_key_mlkem: string;
}

export async function getMe(context: AuthedContext): Promise<AccountRecord> {
  const response = await request<AccountRecord>({
    method: 'GET',
    path: '/users/me',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function fetchAccountMode(
  context: AuthedContext,
): Promise<{ paranoid: boolean; account: AccountRecord }> {
  const account = await getMe(context);
  return { paranoid: account.has_password, account };
}

export async function lookupUsername(
  userAddress: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  if (!USER_ADDRESS_PATTERN.test(userAddress)) {
    throw new Error('user_address must be 64 lowercase hex characters');
  }
  const response = await request<{ username: string }>({
    method: 'GET',
    path: '/users/lookup',
    query: { address: userAddress },
    timeoutMs: options.timeoutMs,
  });
  return response.data.username;
}

export async function updateUsername(
  context: AuthedContext,
  username: string,
): Promise<string> {
  const claimed = normalizeUsername(username);
  if (!isUsername(claimed)) {
    throw new MalformedUsernameError(username);
  }

  const envelope = signActionEnvelope(
    'username-update',
    [claimed],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  await request<void>({
    method: 'PUT',
    path: '/users/username',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { username: claimed, ...envelope },
  });

  return claimed;
}

export async function resolveUsername(
  context: AuthedContext,
  username: string,
): Promise<UsernameResolution | undefined> {
  const wanted = normalizeUsername(username);
  if (!isUsername(wanted)) {
    return undefined;
  }

  try {
    const response = await request<UsernameResolution>({
      method: 'GET',
      path: '/users/resolve',
      query: { username: wanted },
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
    });
    return response.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

export async function getPublicKeys(
  context: AuthedContext,
  uuid: string,
): Promise<PublicKeysRecord> {
  const response = await request<PublicKeysRecord>({
    method: 'GET',
    path: `/users/${assertCanonicalUuid(uuid, 'uuid')}/public-keys`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export type EnableSecondFactorOutcome =
  | { status: 'enabled' }
  | { status: 'already-enabled' };

export async function enableSecondFactor(
  context: AuthedContext,
  newPin: string,
): Promise<EnableSecondFactorOutcome> {
  const newToken = await deriveServerAuthToken(newPin, context.session.userAddress);

  const envelope = signActionEnvelope(
    'enable-second-factor',
    [newToken],
    { privateKey: context.session.identityPrivateKey },
    { paranoid: false },
  );

  try {
    await request<void>({
      method: 'POST',
      path: '/users/second-factor',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: { new_password: newToken, ...envelope },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isCredentialFailure) {
      const { paranoid } = await fetchAccountMode(context);
      if (paranoid) {
        await context.session.rekeySecondFactor(newPin);
        return { status: 'already-enabled' };
      }
    }
    throw error;
  }

  await context.session.rekeySecondFactor(newPin);
  return { status: 'enabled' };
}

export async function rotateSecondFactor(
  context: AuthedContext,
  newPin: string,
): Promise<void> {
  const newToken = await deriveServerAuthToken(newPin, context.session.userAddress);

  const envelope = signActionEnvelope(
    'rotate-second-factor',
    [newToken],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: true },
  );

  await request<void>({
    method: 'PUT',
    path: '/users/password',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { new_password: newToken, ...envelope },
  });

  await context.session.rekeySecondFactor(newPin);
}

export async function deleteAccount(context: AuthedContext): Promise<void> {
  const envelope = signActionEnvelope(
    'account-delete',
    [context.session.userAddress],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  try {
    await request<void>({
      method: 'DELETE',
      path: '/users',
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
      body: envelope,
    });
  } catch (error) {
    if (error instanceof ApiError && error.isCredentialFailure) {
      return;
    }
    throw error;
  } finally {
    context.tokens.clear();
    context.session.lock();
  }
}
