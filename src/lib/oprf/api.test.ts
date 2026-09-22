import { afterEach, describe, expect, it, vi } from 'vitest';
import { ed25519, ristretto255_oprf } from '@noble/curves/ed25519.js';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from '@/lib/encoding';
import { deriveRootKeys, mnemonicToSeed } from '@/lib/keys';
import { buildActionPayload, payloadDigest, rawKeySigner, verifyPayload } from '@/lib/signing';
import {
  DeviceRegistrationGoneError,
  OfflineError,
  accountPinProof,
  confirmDevicePin,
  enableParanoid,
  evaluateDevicePin,
  registerDevicePin,
  rotateAccountPin,
} from './api';
import { deviceConfirmMessage } from './pin-keys';

const root = await deriveRootKeys(await mnemonicToSeed(vectors.seed_and_user_address.mnemonic));
const rootSigner = rawKeySigner(root.signing.privateKey);
const REGISTRATION = '00000000-0000-4000-8000-0000000000aa';

interface Call {
  path: string;
  body: Record<string, unknown>;
  token?: string;
}

function server(options: { maxAttempts?: number; unreachable?: boolean } = {}) {
  const deviceKey = ristretto255_oprf.oprf.generateKeyPair().secretKey;
  const accountKey = ristretto255_oprf.oprf.generateKeyPair().secretKey;
  const calls: Call[] = [];
  const state = {
    used: 0,
    attempt: '',
    confirmKey: '',
    deleted: false,
    proofKey: '',
  };
  const max = options.maxAttempts ?? 10;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (options.unreachable) {
        throw new TypeError('network down');
      }
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ path, body, token: headers.Authorization });
      const answer = (status: number, data?: unknown) =>
        ({
          status,
          ok: status >= 200 && status < 300,
          text: async () => (data === undefined ? '' : JSON.stringify(data)),
          headers: { get: () => null },
        }) as unknown as Response;
      const evaluate = (key: Uint8Array) =>
        bytesToBase64(ristretto255_oprf.oprf.blindEvaluate(key, base64ToBytes(body.blinded_element)));

      if (path === '/oprf/devices') {
        return answer(201, { data: { registration_id: REGISTRATION, evaluated_element: evaluate(deviceKey) } });
      }
      if (path.endsWith('/commit')) {
        state.confirmKey = body.confirm_public_key;
        return answer(204);
      }
      if (path.endsWith('/evaluate') && path.startsWith('/oprf/devices/')) {
        if (state.deleted || state.used >= max) {
          state.deleted = true;
          return answer(404, { code: 'NOT_FOUND' });
        }
        state.used += 1;
        state.attempt = crypto.randomUUID();
        return answer(200, {
          data: { evaluated_element: evaluate(deviceKey), attempt_id: state.attempt, attempts_remaining: max - state.used },
        });
      }
      if (path.endsWith('/confirm')) {
        const ok =
          body.attempt_id === state.attempt &&
          ed25519.verify(
            base64ToBytes(body.proof),
            utf8ToBytes(deviceConfirmMessage(REGISTRATION, body.attempt_id)),
            base64ToBytes(state.confirmKey),
          );
        state.attempt = '';
        if (!ok) {
          return answer(404, { code: 'NOT_FOUND' });
        }
        state.used = 0;
        return answer(204);
      }
      if (path === '/oprf/account/evaluate' || path === '/oprf/account/begin') {
        return answer(200, { data: { evaluated_element: evaluate(accountKey) } });
      }
      if (path === '/oprf/account/enable' || path === '/oprf/account/rotate') {
        state.proofKey = body.proof_public_key;
        return answer(204);
      }
      return answer(404, { code: 'NOT_FOUND' });
    }),
  );
  return { calls, state };
}

function tokens(): TokenStore {
  const store = new TokenStore();
  store.set('jwt');
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('the device PIN', () => {
  it('registers with a blinded PIN and commits the device-confirm key, sending neither the PIN nor its keys', async () => {
    const fake = server();
    const registration = await registerDevicePin({ tokens: tokens() }, '482915');

    expect(fake.calls.map((call) => call.path)).toEqual([
      '/oprf/devices',
      `/oprf/devices/${REGISTRATION}/commit`,
    ]);
    expect(fake.calls.every((call) => call.token === 'Bearer jwt')).toBe(true);
    expect(JSON.stringify(fake.calls)).not.toContain('482915');
    expect(registration.salt).toHaveLength(32);
    expect(fake.state.confirmKey).toBe(registration.keys.confirmPublicKey);
  }, 30_000);

  it('derives the same wrap key at unlock, and a confirmation gives every attempt back', async () => {
    const fake = server();
    const registration = await registerDevicePin({ tokens: tokens() }, '482915');

    const evaluation = await evaluateDevicePin(REGISTRATION, '482915', registration.salt);
    expect(Array.from(evaluation.keys.wrapKey)).toEqual(Array.from(registration.keys.wrapKey));
    expect(evaluation.attemptsRemaining).toBe(9);
    expect(fake.calls.at(-1)?.token).toBeUndefined();

    await confirmDevicePin(REGISTRATION, evaluation);
    expect(fake.state.used).toBe(0);
  }, 30_000);

  it('derives another key from a wrong PIN, so the local open fails and the attempt stays spent', async () => {
    const fake = server();
    const registration = await registerDevicePin({ tokens: tokens() }, '482915');
    const wrong = await evaluateDevicePin(REGISTRATION, '482916', registration.salt);

    expect(Array.from(wrong.keys.wrapKey)).not.toEqual(Array.from(registration.keys.wrapKey));
    expect(fake.state.used).toBe(1);
  }, 30_000);

  it('reads 404 on evaluate as a registration that is gone, never as a wrong PIN', async () => {
    server({ maxAttempts: 0 });
    await expect(evaluateDevicePin(REGISTRATION, '482915', new Uint8Array(32))).rejects.toBeInstanceOf(
      DeviceRegistrationGoneError,
    );
  });

  it('says offline, not wrong PIN, when the server cannot be reached', async () => {
    server({ unreachable: true });
    await expect(evaluateDevicePin(REGISTRATION, '482915', new Uint8Array(32))).rejects.toBeInstanceOf(
      OfflineError,
    );
  });
});

describe('the account PIN (Paranoid)', () => {
  it('turns Paranoid on with a root-signed begin and enable, sending no proof', async () => {
    const fake = server();
    await enableParanoid({ tokens: tokens() }, rootSigner, root.userAddress, '482915');

    expect(fake.calls.map((call) => call.path)).toEqual(['/oprf/account/begin', '/oprf/account/enable']);
    const [begin, enable] = fake.calls;
    expect(begin.body).not.toHaveProperty('pin_proof');
    expect(enable.body).not.toHaveProperty('pin_proof');
    expect(
      verifyPayload(
        buildActionPayload(begin.body.challenge as string, begin.body.timestamp as number, 'second-factor-begin', [
          root.userAddress,
          begin.body.blinded_element as string,
        ]),
        begin.body.signature as string,
        root.signing.publicKeyUncompressed,
      ),
    ).toBe(true);
    expect(
      verifyPayload(
        buildActionPayload(enable.body.challenge as string, enable.body.timestamp as number, 'enable-second-factor', [
          enable.body.proof_public_key as string,
        ]),
        enable.body.signature as string,
        root.signing.publicKeyUncompressed,
      ),
    ).toBe(true);
  }, 30_000);

  it('derives the same proof key from an evaluation as the one it enabled', async () => {
    const fake = server();
    await enableParanoid({ tokens: tokens() }, rootSigner, root.userAddress, '482915');
    const proof = await accountPinProof(rootSigner, root.userAddress, '482915');
    expect(proof.key.publicKey).toBe(fake.state.proofKey);

    const evaluate = fake.calls.at(-1)!;
    expect(evaluate.path).toBe('/oprf/account/evaluate');
    expect(evaluate.token).toBeUndefined();
    expect(evaluate.body.user_address).toBe(root.userAddress);
  }, 30_000);

  it('rotates with a proof under the current PIN on both begin and rotate, over each one’s own digest', async () => {
    const fake = server();
    await enableParanoid({ tokens: tokens() }, rootSigner, root.userAddress, '482915');
    const current = fake.state.proofKey;
    fake.calls.length = 0;

    await rotateAccountPin({ tokens: tokens() }, rootSigner, root.userAddress, '482915', '715392');

    expect(fake.calls.map((call) => call.path)).toEqual([
      '/oprf/account/evaluate',
      '/oprf/account/begin',
      '/oprf/account/rotate',
    ]);
    for (const [call, action, args] of [
      [fake.calls[1], 'second-factor-begin', [root.userAddress, fake.calls[1].body.blinded_element]],
      [fake.calls[2], 'rotate-second-factor', [fake.calls[2].body.proof_public_key]],
    ] as const) {
      const payload = buildActionPayload(call.body.challenge as string, call.body.timestamp as number, action, args as unknown as string[]);
      expect(
        ed25519.verify(base64ToBytes(call.body.pin_proof as string), payloadDigest(payload), base64ToBytes(current)),
      ).toBe(true);
    }
    expect(fake.state.proofKey).not.toBe(current);
  }, 60_000);
});
