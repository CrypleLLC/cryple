import {
  ApiError,
  GENERIC_AUTH_FAILURE,
  request,
  type ApiResponse,
  type TokenStore,
} from '@/lib/api';
import { signAuthEnvelope } from '@/lib/signing';
import type { SessionKeystore } from '@/lib/session';

export type AuthEndpoint = '/sign-up' | '/sign-in' | '/auth/verify';

export interface AuthOutcome {
  accessToken: string;
  created: boolean;
}

export class AuthRejectedError extends Error {
  readonly userMessage = GENERIC_AUTH_FAILURE;
  readonly endpoint: AuthEndpoint;
  readonly diagnostic: string;

  constructor(endpoint: AuthEndpoint, diagnostic: string) {
    super(`${endpoint} rejected the credentials`);
    this.name = 'AuthRejectedError';
    this.endpoint = endpoint;
    this.diagnostic = diagnostic;
  }
}

const RESTORE_DIAGNOSTIC =
  'The server rejected this signature. On a re-run of /sign-up with a correct signature ' +
  'this means one of the enrolled encryption keys differs from what is stored — a derivation ' +
  'mismatch in this build. Check it against test-vectors.json before assuming the account is missing.';

const SIGN_IN_DIAGNOSTIC =
  'Deliberately ambiguous: no such account, wrong signature, and wrong second factor all ' +
  'return the same 404. Render one generic message.';

interface AuthRequestOptions {
  session: SessionKeystore;
  paranoid: boolean;
  tokens?: TokenStore;
  timeoutMs?: number;
}

function store(tokens: TokenStore | undefined, accessToken: string): void {
  tokens?.set(accessToken);
}

function readToken(response: ApiResponse<{ access_token?: string }>, endpoint: AuthEndpoint): string {
  const accessToken = response.data?.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(`${endpoint} returned no access_token`);
  }
  return accessToken;
}

export async function signUp(options: AuthRequestOptions): Promise<AuthOutcome> {
  const { session, paranoid, tokens, timeoutMs } = options;

  const envelope = signAuthEnvelope(
    { privateKey: session.identityPrivateKey, serverAuthToken: session.serverAuthToken() },
    { paranoid },
  );

  const keys = session.enrollmentPublicKeys;

  try {
    const response = await request<{ access_token?: string }>({
      method: 'POST',
      path: '/sign-up',
      timeoutMs,
      body: {
        user_address: session.userAddress,
        public_key: keys.publicKey,
        encryption_public_key_x25519: keys.encryptionPublicKeyX25519,
        encryption_public_key_mlkem: keys.encryptionPublicKeyMlkem,
        ...envelope,
      },
    });

    const accessToken = readToken(response, '/sign-up');
    store(tokens, accessToken);
    return { accessToken, created: response.status === 201 };
  } catch (error) {
    if (error instanceof ApiError && error.isAuthEndpointRejection) {
      throw new AuthRejectedError('/sign-up', RESTORE_DIAGNOSTIC);
    }
    throw error;
  }
}

export async function signIn(options: AuthRequestOptions): Promise<AuthOutcome> {
  const { session, paranoid, tokens, timeoutMs } = options;

  const envelope = signAuthEnvelope(
    { privateKey: session.identityPrivateKey, serverAuthToken: session.serverAuthToken() },
    { paranoid },
  );

  try {
    const response = await request<{ access_token?: string }>({
      method: 'POST',
      path: '/sign-in',
      timeoutMs,
      body: { user_address: session.userAddress, ...envelope },
    });

    const accessToken = readToken(response, '/sign-in');
    store(tokens, accessToken);
    return { accessToken, created: false };
  } catch (error) {
    if (error instanceof ApiError && error.isAuthEndpointRejection) {
      throw new AuthRejectedError('/sign-in', SIGN_IN_DIAGNOSTIC);
    }
    throw error;
  }
}

export interface RestoreOutcome extends AuthOutcome {
  accountExisted: boolean;
}

export async function restore(options: AuthRequestOptions): Promise<RestoreOutcome> {
  const outcome = await signUp(options);
  return { ...outcome, accountExisted: !outcome.created };
}

export function signOut(tokens: TokenStore, session?: SessionKeystore): void {
  tokens.clear();
  session?.lock();
}
