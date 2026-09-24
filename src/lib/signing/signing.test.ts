import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import vectors from '@/test/fixtures/test-vectors.json';
import { base64ToBytes, hexToBytes, spkiBase64ToUncompressedPoint } from '@/lib/encoding';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { generateDeviceKeys, deviceSigner } from '@/lib/device/keys';
import {
  ACTIONS,
  buildActionPayload,
  buildAuthPayload,
  createChallenge,
  currentTimestamp,
  normalizeActionArgs,
  payloadDigest,
  rawKeySigner,
  signActionEnvelope,
  signAuthEnvelope,
  signPayload,
  signRootAction,
  verifyPayload,
  CHALLENGE_BYTES,
  SIGNATURE_BYTES,
  type ActionLabel,
} from './index';

const seed = hexToBytes(vectors.seed_and_user_address.seed_hex);
const userAddress = vectors.seed_and_user_address.user_address;

const tree = await deriveKeyTreeFromSeed(seed);
const root = rawKeySigner(tree.identity.privateKey);
const rootPublicKey = tree.identity.publicKeyUncompressed;
const device = await generateDeviceKeys({ preferWebCryptoX25519: false });
const deviceKey = deviceSigner(device);
const devicePublicKey = spkiBase64ToUncompressedPoint(device.signingPublicKey);

const CHALLENGE = 'a'.repeat(64);
const TIMESTAMP = 1785000000;

describe('challenge generation', () => {
  it('produces 64 lowercase hex characters', () => {
    const challenge = createChallenge();
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge).toHaveLength(CHALLENGE_BYTES * 2);
  });

  it('is fresh every time — a reused challenge is rejected server-side', () => {
    const seen = new Set(Array.from({ length: 100 }, () => createChallenge()));
    expect(seen.size).toBe(100);
  });

  it('emits unix seconds, not milliseconds', () => {
    const now = currentTimestamp();
    expect(Number.isInteger(now)).toBe(true);
    expect(Math.abs(now - Date.now() / 1000)).toBeLessThan(2);
  });
});

describe('payload construction', () => {
  it('builds the two-field auth payload', () => {
    expect(buildAuthPayload(CHALLENGE, TIMESTAMP)).toBe(`${CHALLENGE}:${TIMESTAMP}`);
  });

  it('builds the colon-joined action payload', () => {
    expect(buildActionPayload(CHALLENGE, TIMESTAMP, 'secret-delete', ['req-1'])).toBe(
      `${CHALLENGE}:${TIMESTAMP}:secret-delete:req-1`,
    );
  });

  it('appends multiple arguments in the documented order', () => {
    expect(
      buildActionPayload(CHALLENGE, TIMESTAMP, 'rotate-second-factor', ['tok-2']),
    ).toBe(`${CHALLENGE}:${TIMESTAMP}:rotate-second-factor:tok-2`);
  });

  it('rejects arguments containing the field separator', () => {
    expect(() => buildActionPayload(CHALLENGE, TIMESTAMP, 'note-delete', ['a:b'])).toThrow(
      /must not contain/,
    );
  });

  it('rejects the wrong argument count', () => {
    expect(() => buildActionPayload(CHALLENGE, TIMESTAMP, 'rotate-second-factor', ['a', 'b'])).toThrow(
      /expected 1 argument/,
    );
  });
});

describe('signature format', () => {
  it('is IEEE P1363 — 64 raw bytes, base64 — from the root and from a WebCrypto device key', async () => {
    for (const signer of [root, deviceKey]) {
      const signature = await signPayload(buildAuthPayload(CHALLENGE, TIMESTAMP), signer);
      expect(base64ToBytes(signature)).toHaveLength(SIGNATURE_BYTES);
    }
  });

  it('is never ASN.1/DER, whatever the challenge', async () => {
    for (let i = 0; i < 20; i++) {
      const signature = await signPayload(`${createChallenge()}:${TIMESTAMP}`, deviceKey);
      expect(base64ToBytes(signature)).toHaveLength(64);
    }
  });

  it('verifies against the signer\'s own public key and no other', async () => {
    const payload = buildAuthPayload(CHALLENGE, TIMESTAMP);
    expect(verifyPayload(payload, await signPayload(payload, root), rootPublicKey)).toBe(true);
    expect(verifyPayload(payload, await signPayload(payload, deviceKey), devicePublicKey)).toBe(true);
    expect(verifyPayload(payload, await signPayload(payload, deviceKey), rootPublicKey)).toBe(false);
  });

  it('accepts a high-S signature, as the server and WebCrypto both produce them', () => {
    const [event] = vectors.device_keys.genesis_chain;
    expect(
      verifyPayload(
        event.statement,
        event.signature_base64,
        spkiBase64ToUncompressedPoint(vectors.device_keys.root_wrap.root_public_key),
      ),
    ).toBe(true);
  });

  it('keeps the device signing key non-extractable', async () => {
    await expect(crypto.subtle.exportKey('pkcs8', device.signingKey)).rejects.toThrow();
  });
});

describe('the signature is bound to everything in its payload', async () => {
  const payload = buildActionPayload(CHALLENGE, TIMESTAMP, 'secret-delete', ['request-1']);
  const signature = await signPayload(payload, deviceKey);

  it('verifies against its own payload', () => {
    expect(verifyPayload(payload, signature, devicePublicKey)).toBe(true);
  });

  it('is bound to the challenge', () => {
    const other = buildActionPayload('b'.repeat(64), TIMESTAMP, 'secret-delete', ['request-1']);
    expect(verifyPayload(other, signature, devicePublicKey)).toBe(false);
  });

  it('is bound to the timestamp', () => {
    const other = buildActionPayload(CHALLENGE, TIMESTAMP + 1, 'secret-delete', ['request-1']);
    expect(verifyPayload(other, signature, devicePublicKey)).toBe(false);
  });

  it('is bound to the action label', () => {
    const other = buildActionPayload(CHALLENGE, TIMESTAMP, 'note-delete', ['request-1']);
    expect(verifyPayload(other, signature, devicePublicKey)).toBe(false);
  });

  it('is bound to the arguments', () => {
    const other = buildActionPayload(CHALLENGE, TIMESTAMP, 'secret-delete', ['request-2']);
    expect(verifyPayload(other, signature, devicePublicKey)).toBe(false);
  });
});

describe('a sign-in signature can never be used as an action signature', () => {
  it('refuses in both directions — two fields can never collide with three or more', async () => {
    const authPayload = buildAuthPayload(CHALLENGE, TIMESTAMP);
    const authSignature = await signPayload(authPayload, root);
    const actionPayload = buildActionPayload(CHALLENGE, TIMESTAMP, 'account-delete', [userAddress]);
    const actionSignature = await signPayload(actionPayload, root);

    expect(verifyPayload(actionPayload, authSignature, rootPublicKey)).toBe(false);
    expect(verifyPayload(authPayload, actionSignature, rootPublicKey)).toBe(false);
  });

  it('never produces an action payload with only two fields', () => {
    for (const action of Object.keys(ACTIONS) as ActionLabel[]) {
      const args = ACTIONS[action].args.map((name, index) => `${name}-${index}`);
      const payload = buildActionPayload(CHALLENGE, TIMESTAMP, action, args);
      expect(payload.split(':').length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the four batchable delete actions', () => {
  it('sorts ids ascending before signing', () => {
    expect(normalizeActionArgs('secret-delete', ['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('de-duplicates ids', () => {
    expect(normalizeActionArgs('secret-delete', ['b', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('produces an order-independent payload', () => {
    const ids = [
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      '0c892e57-93cf-423a-a9e9-fee5a9f87681',
      'ba7816bf-8f01-4fea-9411-2b4c3f5a1e77',
    ];
    const forward = buildActionPayload(CHALLENGE, TIMESTAMP, 'secret-delete', ids);
    const reversed = buildActionPayload(CHALLENGE, TIMESTAMP, 'secret-delete', [...ids].reverse());
    expect(forward).toBe(reversed);
  });

  it('treats the single delete as the one-element case of the same label', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(buildActionPayload(CHALLENGE, TIMESTAMP, 'secret-delete', [id])).toBe(
      `${CHALLENGE}:${TIMESTAMP}:secret-delete:${id}`,
    );
  });

  it('refuses an empty id list', () => {
    expect(() => normalizeActionArgs('secret-delete', [])).toThrow(/at least one/);
  });
});

describe('the action table matches signed-actions.md', () => {
  it('covers all 27 actions', () => {
    expect(Object.keys(ACTIONS)).toHaveLength(27);
  });

  it('leaves writing a credential unsigned, which is what keeps an extension on the JWT side', () => {
    expect(Object.keys(ACTIONS).filter((action) => action.startsWith('credential-'))).toEqual([
      'credential-delete',
      'credential-prune',
      'credential-rekey',
    ]);
  });

  it('makes every re-wrap variadic and device-signed, like the delete it resembles', () => {
    for (const action of ['secret-rekey', 'note-rekey', 'document-rekey', 'file-rekey'] as const) {
      expect(ACTIONS[action].signer).toBe('device');
      expect(ACTIONS[action].pinProof).toBe(false);
      expect(ACTIONS[action].variadic).toBe(true);
    }
  });

  it('names the root as the signer of exactly the account-level actions', () => {
    const rootActions = Object.entries(ACTIONS)
      .filter(([, spec]) => spec.signer === 'root')
      .map(([action]) => action)
      .sort();
    expect(rootActions).toEqual(
      [
        'account-delete',
        'chain-read',
        'device-enrol',
        'enable-second-factor',
        'pin-evaluate',
        'rotate-second-factor',
        'second-factor-begin',
      ].sort(),
    );
  });

  it('takes a PIN proof on the root actions that can hurt a Paranoid account, and never on a device action', () => {
    for (const [action, spec] of Object.entries(ACTIONS)) {
      const expected = ['account-delete', 'chain-read', 'device-enrol', 'rotate-second-factor', 'second-factor-begin'].includes(action);
      expect(spec.pinProof).toBe(expected);
    }
  });

  it('binds both generations into an invitation, and the counterparty or item into every sharing signature', () => {
    expect(ACTIONS['connection-invite'].args).toEqual([
      'recipient_username',
      'pqxdh_blob',
      'sender_key_generation',
      'recipient_key_generation',
    ]);
    expect(ACTIONS['share-create'].args).toEqual(['connection_id', 'item_type', 'item_id']);
    expect(ACTIONS['connection-keys'].args).toEqual(['connection_id', 'keys_digest']);
    expect(ACTIONS['address-book-update'].args).toEqual(['expected_revision', 'ciphertext_digest']);
  });

  it('makes the four deletes batchable and signed by the device', () => {
    for (const action of ['secret-delete', 'note-delete', 'document-delete', 'file-delete'] as const) {
      expect(ACTIONS[action]).toMatchObject({ signer: 'device', pinProof: false, variadic: true });
    }
  });

  it('keeps username-update single-argument and signed by the device', () => {
    expect(ACTIONS['username-update']).toMatchObject({ args: ['username'], signer: 'device' });
    expect(() => normalizeActionArgs('username-update', ['pedrosilva', 'psilva'])).toThrow(
      /expected 1 argument/,
    );
  });
});

describe('who signs what', () => {
  it('signs sign-in and device actions with the device, carrying no password and no proof', async () => {
    const auth = await signAuthEnvelope(deviceKey);
    expect(auth).not.toHaveProperty('password');
    expect(verifyPayload(buildAuthPayload(auth.challenge, auth.timestamp), auth.signature, devicePublicKey)).toBe(true);

    const action = await signActionEnvelope('secret-delete', ['id-1'], deviceKey);
    expect(action).not.toHaveProperty('password');
    expect(action).not.toHaveProperty('pin_proof');
  });

  it('refuses to sign a root action with the device helper, and a device action with the root helper', async () => {
    await expect(
      signActionEnvelope('account-delete' as never, [userAddress], deviceKey),
    ).rejects.toThrow(/root/);
    await expect(signRootAction('secret-delete' as never, ['id'], root)).rejects.toThrow(/device/);
  });

  it('sends no pin_proof for a Standard account', async () => {
    const envelope = await signRootAction('account-delete', [userAddress], root);
    expect(envelope).not.toHaveProperty('pin_proof');
  });

  it('proves the PIN over the very digest the root signature covers', async () => {
    const proofSeed = hexToBytes(vectors.pin_oprf.account_registration.account_proof_seed_hex);
    const envelope = await signRootAction('account-delete', [userAddress], root, (digest) =>
      ed25519.sign(digest, proofSeed),
    );
    const payload = buildActionPayload(envelope.challenge, envelope.timestamp, 'account-delete', [
      userAddress,
    ]);

    expect(verifyPayload(payload, envelope.signature, rootPublicKey)).toBe(true);
    expect(
      ed25519.verify(
        base64ToBytes(envelope.pin_proof as string),
        payloadDigest(payload),
        base64ToBytes(vectors.pin_oprf.account_registration.proof_public_key_base64),
      ),
    ).toBe(true);
  });

  it('refuses a proof on an action that never carries one', async () => {
    await expect(
      signRootAction('enable-second-factor', ['key'], root, () => new Uint8Array(64)),
    ).rejects.toThrow(/never carries/);
  });
});

describe('envelopes are fresh per call', () => {
  it('never reuses a challenge across two signings of the same action', async () => {
    const first = await signActionEnvelope('note-delete', ['id-1'], deviceKey);
    const second = await signActionEnvelope('note-delete', ['id-1'], deviceKey);
    expect(first.challenge).not.toBe(second.challenge);
    expect(first.signature).not.toBe(second.signature);
  });

  it('emits a timestamp in unix seconds', () => {
    expect(currentTimestamp()).toBeLessThan(10_000_000_000);
  });
});
