import { assertCanonicalUuid, request } from '@/lib/api';
import { requireToken, type TokenContext } from '@/lib/context';
import { formatPairingCode } from './fingerprint';

export type PairingStatus = 'open' | 'claimed' | 'linked' | 'cancelled' | 'expired';

export interface OpenedPairing {
  id: string;
  code: string;
  expires_at: string;
}

export interface PairingRecord {
  id: string;
  status: PairingStatus;
  device_id?: string;
  signing_public_key?: string;
  x25519_public_key?: string;
  mlkem_public_key?: string;
  expires_at: string;
}

export interface ClaimRequest {
  code: string;
  deviceId: string;
  signingPublicKey: string;
  x25519PublicKey: string;
  mlkemPublicKey: string;
}

export interface ClaimedPairing {
  claim_id: string;
  user_address: string;
  root_public_key: string;
  username?: string;
  expires_at: string;
}

export async function openPairing(context: TokenContext): Promise<OpenedPairing> {
  const response = await request<OpenedPairing>({
    method: 'POST',
    path: '/devices/pairings',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function getPairing(context: TokenContext, id: string): Promise<PairingRecord> {
  const response = await request<PairingRecord>({
    method: 'GET',
    path: `/devices/pairings/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export async function completePairing(context: TokenContext, id: string, deviceId: string): Promise<void> {
  await request<unknown>({
    method: 'POST',
    path: `/devices/pairings/${assertCanonicalUuid(id)}/complete`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { device_id: assertCanonicalUuid(deviceId) },
  });
}

export async function cancelPairing(context: TokenContext, id: string): Promise<void> {
  await request<unknown>({
    method: 'DELETE',
    path: `/devices/pairings/${assertCanonicalUuid(id)}`,
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
}

export async function claimPairing(
  claim: ClaimRequest,
  options: { timeoutMs?: number } = {},
): Promise<ClaimedPairing> {
  const response = await request<ClaimedPairing>({
    method: 'POST',
    path: '/pairings/claim',
    timeoutMs: options.timeoutMs,
    body: {
      code: formatPairingCode(claim.code),
      device_id: assertCanonicalUuid(claim.deviceId),
      signing_public_key: claim.signingPublicKey,
      x25519_public_key: claim.x25519PublicKey,
      mlkem_public_key: claim.mlkemPublicKey,
    },
  });
  return response.data;
}

export async function claimStatus(
  claimId: string,
  options: { timeoutMs?: number } = {},
): Promise<PairingStatus> {
  const response = await request<{ status: PairingStatus }>({
    method: 'GET',
    path: `/pairings/${assertCanonicalUuid(claimId)}`,
    timeoutMs: options.timeoutMs,
  });
  return response.data.status;
}
