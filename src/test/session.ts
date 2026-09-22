import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import type { AuthedContext } from '@/lib/context';
import { generateDeviceKeys, type DeviceKeys } from '@/lib/device/keys';
import { spkiBase64ToUncompressedPoint } from '@/lib/encoding';
import {
  generateScopeKek,
  generateSharingKeys,
  sealSharingMaterial,
} from '@/lib/keyrings/crypto';
import { FULL_DEVICE_SCOPES, KEYRING_SCOPES, type KeyringScope, type Scope } from '@/lib/scopes';
import { SessionKeystore, type KeyringEntry } from '@/lib/session';

export const TEST_USER_ADDRESS = vectors.seed_and_user_address.user_address;
export const TEST_ROOT_PUBLIC_KEY = vectors.device_keys.root_wrap.root_public_key;

export interface TestSession {
  context: AuthedContext;
  device: DeviceKeys;
  keks: Map<string, Uint8Array>;
  devicePublicKey: Uint8Array;
}

export async function openTestSession(
  options: {
    scopes?: readonly Scope[];
    paranoid?: boolean;
    generations?: Partial<Record<KeyringScope, number>>;
    userAddress?: string;
    token?: string;
  } = {},
): Promise<TestSession> {
  const scopes = options.scopes ?? FULL_DEVICE_SCOPES;
  const device = await generateDeviceKeys({ preferWebCryptoX25519: false });
  const keks = new Map<string, Uint8Array>();
  const keyrings: KeyringEntry[] = [];
  const current: Partial<Record<KeyringScope, number>> = {};

  for (const scope of KEYRING_SCOPES) {
    if (!scopes.includes(scope)) {
      continue;
    }
    const top = options.generations?.[scope] ?? 1;
    for (let generation = 1; generation <= top; generation += 1) {
      const kek = generateScopeKek();
      keks.set(`${scope}:${generation}`, kek);
      keyrings.push({
        scope,
        generation,
        kek,
        sealedMaterial:
          scope === 'sharing' ? await sealSharingMaterial(kek, generateSharingKeys()) : undefined,
      });
    }
    current[scope] = top;
  }

  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  session.open({
    userAddress: options.userAddress ?? TEST_USER_ADDRESS,
    rootPublicKey: TEST_ROOT_PUBLIC_KEY,
    deviceId: device.deviceId,
    registrationId: crypto.randomUUID(),
    scopes,
    device,
    keyrings,
    current,
  });

  const tokens = new TokenStore();
  tokens.set(options.token ?? 'jwt-token');

  return {
    context: { session, tokens, paranoid: options.paranoid ?? false },
    device,
    keks,
    devicePublicKey: spkiBase64ToUncompressedPoint(device.signingPublicKey),
  };
}

export async function newTestContext(paranoid = false): Promise<AuthedContext> {
  return (await openTestSession({ paranoid })).context;
}
