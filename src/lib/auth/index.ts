import {
  ApiError,
  GENERIC_AUTH_FAILURE,
  assertSessionGrant,
  request,
  type SessionGrant,
  type TokenStore,
} from '@/lib/api';
import { batchDigest, type StoredChainEvent } from '@/lib/chain';
import type { DeviceBatch } from '@/lib/keyrings/batches';
import type { DeviceRecordOnServer, KeyringsRecord } from '@/lib/keyrings/api';
import {
  signAuthEnvelope,
  signRootAction,
  type PinProofSigner,
  type Signer,
} from '@/lib/signing';

export type AuthEndpoint = '/sign-up' | '/sign-in' | '/devices/enrol' | '/devices/enrol/chain';

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

const SIGN_UP_DIAGNOSTIC =
  'The root signature did not verify, the challenge was stale, or this address already belongs ' +
  'to an account under another root key or with another genesis device. A retry must resend ' +
  'the same genesis.';

const SIGN_IN_DIAGNOSTIC =
  'Deliberately ambiguous: an unknown or removed device and a bad signature return the same 404.';

const ENROL_DIAGNOSTIC =
  'Any root or proof failure is a uniform 404: no account for this phrase, a wrong phrase, or a ' +
  'Paranoid account whose PIN proof was missing or wrong.';

export interface SignUpOutcome {
  grant: SessionGrant;
  created: boolean;
}

export async function signUpWithGenesis(options: {
  userAddress: string;
  rootPublicKey: string;
  root: Signer;
  batch: DeviceBatch;
  tokens?: TokenStore;
  timeoutMs?: number;
}): Promise<SignUpOutcome> {
  const envelope = await signAuthEnvelope(options.root);
  try {
    const response = await request<SessionGrant>({
      method: 'POST',
      path: '/sign-up',
      timeoutMs: options.timeoutMs,
      body: {
        user_address: options.userAddress,
        public_key: options.rootPublicKey,
        ...envelope,
        batch: options.batch,
      },
    });
    const grant = assertSessionGrant(response.data, '/sign-up');
    options.tokens?.set(grant.access_token);
    return { grant, created: response.status === 201 };
  } catch (error) {
    if (error instanceof ApiError && error.isAuthEndpointRejection) {
      throw new AuthRejectedError('/sign-up', SIGN_UP_DIAGNOSTIC);
    }
    throw error;
  }
}

export async function signInDevice(options: {
  deviceId: string;
  signer: Signer;
  tokens?: TokenStore;
  timeoutMs?: number;
}): Promise<SessionGrant> {
  const envelope = await signAuthEnvelope(options.signer);
  try {
    const response = await request<SessionGrant>({
      method: 'POST',
      path: '/sign-in',
      timeoutMs: options.timeoutMs,
      body: { device_id: options.deviceId, ...envelope },
    });
    const grant = assertSessionGrant(response.data, '/sign-in');
    options.tokens?.set(grant.access_token);
    return grant;
  } catch (error) {
    if (error instanceof ApiError && error.isAuthEndpointRejection) {
      throw new AuthRejectedError('/sign-in', SIGN_IN_DIAGNOSTIC);
    }
    throw error;
  }
}

export interface RootChainAnswer {
  chain: StoredChainEvent[];
  devices: DeviceRecordOnServer[];
}

export async function readChainWithRoot(options: {
  userAddress: string;
  root: Signer;
  pinProof?: PinProofSigner;
  timeoutMs?: number;
}): Promise<RootChainAnswer> {
  const envelope = await signRootAction(
    'chain-read',
    [options.userAddress],
    options.root,
    options.pinProof,
  );
  try {
    const response = await request<RootChainAnswer>({
      method: 'POST',
      path: '/devices/enrol/chain',
      timeoutMs: options.timeoutMs,
      body: { user_address: options.userAddress, ...envelope },
    });
    return { chain: response.data?.chain ?? [], devices: response.data?.devices ?? [] };
  } catch (error) {
    if (error instanceof ApiError && error.isAuthEndpointRejection) {
      throw new AuthRejectedError('/devices/enrol/chain', ENROL_DIAGNOSTIC);
    }
    throw error;
  }
}

export interface EnrolAnswer extends SessionGrant {
  chain: StoredChainEvent[];
  root_keyrings: KeyringsRecord;
}

export async function enrolWithRoot(options: {
  userAddress: string;
  root: Signer;
  batch: DeviceBatch;
  pinProof?: PinProofSigner;
  tokens?: TokenStore;
  timeoutMs?: number;
}): Promise<EnrolAnswer> {
  const envelope = await signRootAction(
    'device-enrol',
    [options.userAddress, batchDigest(options.batch.events)],
    options.root,
    options.pinProof,
  );
  try {
    const response = await request<EnrolAnswer>({
      method: 'POST',
      path: '/devices/enrol',
      timeoutMs: options.timeoutMs,
      body: { user_address: options.userAddress, ...envelope, batch: options.batch },
    });
    const grant = assertSessionGrant(response.data, '/devices/enrol');
    options.tokens?.set(grant.access_token);
    return {
      ...grant,
      chain: response.data.chain ?? [],
      root_keyrings: response.data.root_keyrings ?? { current: {}, generations: [] },
    };
  } catch (error) {
    if (error instanceof ApiError && error.isAuthEndpointRejection) {
      throw new AuthRejectedError('/devices/enrol', ENROL_DIAGNOSTIC);
    }
    throw error;
  }
}

export function signOut(tokens: TokenStore, session?: { lock(): void }): void {
  tokens.clear();
  session?.lock();
}
