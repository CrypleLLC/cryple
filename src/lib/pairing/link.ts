import { readVerifiedChain } from '@/lib/account';
import { validateMlkemPublicKey, validateSigningPublicKey, validateX25519PublicKey } from '@/lib/chain';
import type { AuthedContext } from '@/lib/context';
import { applyDeviceBatch, buildDeviceLink, refreshKeyrings } from '@/lib/keyrings';
import { completePairing, type PairingRecord } from './api';
import { pairingFingerprint } from './fingerprint';

export const EXTENSION_SCOPES = ['passwords'] as const;

export interface ClaimedDevice {
  deviceId: string;
  signingPublicKey: string;
  x25519PublicKey: string;
  mlkemPublicKey: string;
}

export class PairingNotClaimedError extends Error {
  constructor() {
    super('nothing has claimed this pairing yet');
    this.name = 'PairingNotClaimedError';
  }
}

export function claimedDevice(pairing: PairingRecord): ClaimedDevice {
  if (
    pairing.status !== 'claimed' ||
    pairing.device_id === undefined ||
    pairing.signing_public_key === undefined ||
    pairing.x25519_public_key === undefined ||
    pairing.mlkem_public_key === undefined
  ) {
    throw new PairingNotClaimedError();
  }
  validateSigningPublicKey(pairing.signing_public_key);
  validateX25519PublicKey(pairing.x25519_public_key);
  validateMlkemPublicKey(pairing.mlkem_public_key);
  return {
    deviceId: pairing.device_id,
    signingPublicKey: pairing.signing_public_key,
    x25519PublicKey: pairing.x25519_public_key,
    mlkemPublicKey: pairing.mlkem_public_key,
  };
}

export function ownerFingerprint(context: AuthedContext, code: string, device: ClaimedDevice): string {
  return pairingFingerprint({
    code,
    userAddress: context.session.userAddress,
    rootPublicKey: context.session.rootPublicKey,
    ...device,
  });
}

async function passwordsKeks(context: AuthedContext) {
  const { session } = context;
  const current = session.currentGeneration('passwords');
  const keks = [];
  for (let generation = 1; generation <= current; generation += 1) {
    if (!session.hasKek('passwords', generation)) {
      await refreshKeyrings(context);
    }
    keks.push({ scope: 'passwords' as const, generation, kek: session.kek('passwords', generation) });
  }
  return keks;
}

export async function linkClaimedDevice(
  context: AuthedContext,
  pairingId: string,
  device: ClaimedDevice,
): Promise<void> {
  const { session } = context;
  const state = await readVerifiedChain(
    context,
    { userAddress: session.userAddress, rootPublicKey: session.rootPublicKey },
    session.deviceId,
  );
  const batch = await buildDeviceLink({
    state,
    author: { name: session.deviceId, signer: session.signer() },
    device: { ...device, scopes: EXTENSION_SCOPES },
    keks: await passwordsKeks(context),
  });
  await applyDeviceBatch(context, batch);
  await completePairing(context, pairingId, device.deviceId);
}
