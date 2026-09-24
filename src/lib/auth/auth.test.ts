import { afterEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore, GENERIC_AUTH_FAILURE, userMessageFor, ApiError } from '@/lib/api';
import { ChainState, batchDigest, eventHash } from '@/lib/chain';
import { deviceDeclaration, deviceSigner, generateDeviceKeys } from '@/lib/device/keys';
import { base64ToBytes, spkiBase64ToUncompressedPoint } from '@/lib/encoding';
import { deriveRootKeys, mnemonicToSeed } from '@/lib/keys';
import { buildGenesis, wrapKekForRoot } from '@/lib/keyrings';
import { FULL_DEVICE_SCOPES } from '@/lib/scopes';
import {
  buildActionPayload,
  buildAuthPayload,
  payloadDigest,
  rawKeySigner,
  verifyPayload,
} from '@/lib/signing';
import {
  AuthRejectedError,
  enrolWithRoot,
  readChainWithRoot,
  signInDevice,
  signOut,
  signUpWithGenesis,
} from './index';

const root = await deriveRootKeys(await mnemonicToSeed(vectors.seed_and_user_address.mnemonic));
const rootSigner = rawKeySigner(root.signing.privateKey);
const device = await generateDeviceKeys({ preferWebCryptoX25519: false });
const devicePublicKey = spkiBase64ToUncompressedPoint(device.signingPublicKey);

async function genesis() {
  return buildGenesis({
    userAddress: root.userAddress,
    rootPublicKey: root.signing.publicKeySpkiBase64,
    root: rootSigner,
    wrapForRoot: (kek) => wrapKekForRoot(root.wrapKey, kek),
    device: deviceDeclaration(device, FULL_DEVICE_SCOPES),
  });
}

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      const spec = specs[Math.min(index++, specs.length - 1)];
      const text = spec.body === undefined ? '' : JSON.stringify(spec.body);
      return {
        status: spec.status,
        ok: spec.status >= 200 && spec.status < 300,
        text: async () => text,
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );

  return calls;
}

const grant = (status: number) => ({
  status,
  body: { data: { access_token: 'jwt', device_id: device.deviceId } },
});
const rejected = { status: 404, body: { code: 'NOT_FOUND' } };

afterEach(() => vi.unstubAllGlobals());

describe('sign-up carries the genesis, signed by the root', () => {
  it('sends the root key, a root signature over challenge:timestamp and three verifying genesis events', async () => {
    const calls = mockFetch(grant(201));
    const built = await genesis();
    const outcome = await signUpWithGenesis({
      userAddress: root.userAddress,
      rootPublicKey: root.signing.publicKeySpkiBase64,
      root: rootSigner,
      batch: built.batch,
    });

    const body = calls[0].body;
    expect(calls[0].url).toMatch(/\/sign-up$/);
    expect(body.public_key).toBe(vectors.device_keys.root_wrap.root_public_key);
    expect(body.user_address).toBe(vectors.seed_and_user_address.user_address);
    expect(
      verifyPayload(
        buildAuthPayload(body.challenge as string, body.timestamp as number),
        body.signature as string,
        root.signing.publicKeyUncompressed,
      ),
    ).toBe(true);
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('encryption_public_key_x25519');

    const replayed = ChainState.replay(
      root.userAddress,
      root.signing.publicKeySpkiBase64,
      built.batch.events.map((event, index) => ({
        ...event,
        seq: index + 1,
        event_hash: eventHash(event.statement, event.signer, event.signature),
      })),
    );
    expect(replayed.activeDeviceIds()).toEqual([device.deviceId]);
    expect(outcome).toEqual({ grant: { access_token: 'jwt', device_id: device.deviceId }, created: true });
  });

  it('reads a retry of the same genesis (200) as the same device, not a new account', async () => {
    mockFetch(grant(200));
    const built = await genesis();
    const outcome = await signUpWithGenesis({
      userAddress: root.userAddress,
      rootPublicKey: root.signing.publicKeySpkiBase64,
      root: rootSigner,
      batch: built.batch,
    });
    expect(outcome.created).toBe(false);
    expect(outcome.grant.device_id).toBe(device.deviceId);
  });

  it('never puts the phrase, the seed, a PIN or a private key on the wire', async () => {
    const calls = mockFetch(grant(201));
    const built = await genesis();
    await signUpWithGenesis({
      userAddress: root.userAddress,
      rootPublicKey: root.signing.publicKeySpkiBase64,
      root: rootSigner,
      batch: built.batch,
    });
    const wire = JSON.stringify(calls[0].body);
    for (const word of vectors.seed_and_user_address.mnemonic.split(' ').slice(0, 1)) {
      expect(wire).not.toContain(` ${word} `);
    }
    expect(wire).not.toContain(vectors.seed_and_user_address.seed_hex);
    expect(wire).not.toContain(vectors.identity_key_p256.private_key_hex);
    expect(wire).not.toContain(vectors.vault_kek.vault_kek_base64);
  });

  it('renders a rejected sign-up with the one generic copy', async () => {
    mockFetch(rejected);
    const built = await genesis();
    const error = await signUpWithGenesis({
      userAddress: root.userAddress,
      rootPublicKey: root.signing.publicKeySpkiBase64,
      root: rootSigner,
      batch: built.batch,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthRejectedError);
    expect((error as AuthRejectedError).userMessage).toBe(GENERIC_AUTH_FAILURE);
  });
});

describe('sign-in is the device signing with its own key', () => {
  it('sends the device id and a device signature, and nothing about the account', async () => {
    const calls = mockFetch(grant(200));
    const tokens = new TokenStore();
    await signInDevice({ deviceId: device.deviceId, signer: deviceSigner(device), tokens });

    const body = calls[0].body;
    expect(Object.keys(body).sort()).toEqual(['challenge', 'device_id', 'signature', 'timestamp']);
    expect(
      verifyPayload(
        buildAuthPayload(body.challenge as string, body.timestamp as number),
        body.signature as string,
        devicePublicKey,
      ),
    ).toBe(true);
    expect(tokens.get()).toBe('jwt');
  });

  it('uses a fresh challenge on every attempt', async () => {
    const calls = mockFetch(rejected, grant(200));
    await signInDevice({ deviceId: device.deviceId, signer: deviceSigner(device) }).catch(() => undefined);
    await signInDevice({ deviceId: device.deviceId, signer: deviceSigner(device) });
    expect(calls[0].body.challenge).not.toBe(calls[1].body.challenge);
  });

  it('leaves the token store untouched when the device is refused', async () => {
    mockFetch(rejected);
    const tokens = new TokenStore();
    tokens.set('previous');
    await expect(
      signInDevice({ deviceId: device.deviceId, signer: deviceSigner(device), tokens }),
    ).rejects.toBeInstanceOf(AuthRejectedError);
    expect(tokens.get()).toBe('previous');
  });

  it('signs out by dropping the token and locking', () => {
    const tokens = new TokenStore();
    tokens.set('jwt');
    const lock = vi.fn();
    signOut(tokens, { lock });
    expect(tokens.get()).toBeUndefined();
    expect(lock).toHaveBeenCalledOnce();
  });
});

describe('enrolment is root-signed over the batch it carries', () => {
  it('signs device-enrol over the address and the digest of the statements', async () => {
    const built = await genesis();
    const calls = mockFetch({
      status: 201,
      body: { data: { access_token: 'jwt', device_id: device.deviceId, chain: [], root_keyrings: { current: {}, generations: [] } } },
    });
    await enrolWithRoot({ userAddress: root.userAddress, root: rootSigner, batch: built.batch });

    const body = calls[0].body;
    expect(calls[0].url).toMatch(/\/devices\/enrol$/);
    expect(body).not.toHaveProperty('pin_proof');
    expect(
      verifyPayload(
        buildActionPayload(body.challenge as string, body.timestamp as number, 'device-enrol', [
          root.userAddress,
          batchDigest(built.batch.events),
        ]),
        body.signature as string,
        root.signing.publicKeyUncompressed,
      ),
    ).toBe(true);
  });

  it('carries a PIN proof over the same digest on a Paranoid account', async () => {
    const built = await genesis();
    const seed = new Uint8Array(32).fill(7);
    const calls = mockFetch({
      status: 201,
      body: { data: { access_token: 'jwt', device_id: device.deviceId } },
    });
    await enrolWithRoot({
      userAddress: root.userAddress,
      root: rootSigner,
      batch: built.batch,
      pinProof: (digest) => ed25519.sign(digest, seed),
    });

    const body = calls[0].body;
    const payload = buildActionPayload(body.challenge as string, body.timestamp as number, 'device-enrol', [
      root.userAddress,
      batchDigest(built.batch.events),
    ]);
    expect(
      ed25519.verify(base64ToBytes(body.pin_proof as string), payloadDigest(payload), ed25519.getPublicKey(seed)),
    ).toBe(true);
  });

  it('reads the chain it builds on with the root, before holding any token', async () => {
    const calls = mockFetch({ status: 200, body: { data: { chain: [], devices: [] } } });
    await readChainWithRoot({ userAddress: root.userAddress, root: rootSigner });

    const body = calls[0].body;
    expect(calls[0].url).toMatch(/\/devices\/enrol\/chain$/);
    expect(
      verifyPayload(
        buildActionPayload(body.challenge as string, body.timestamp as number, 'chain-read', [
          root.userAddress,
        ]),
        body.signature as string,
        root.signing.publicKeyUncompressed,
      ),
    ).toBe(true);
  });

  it('renders every enrolment 404 with the generic copy', () => {
    for (const endpoint of ['POST /devices/enrol', 'POST /devices/enrol/chain', 'POST /sign-in']) {
      expect(userMessageFor(new ApiError({ code: 'NOT_FOUND', status: 404, endpoint }))).toBe(
        GENERIC_AUTH_FAILURE,
      );
    }
  });
});
