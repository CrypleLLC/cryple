import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { hexToBytes } from '@/lib/encoding';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import {
  ACTIONS,
  buildActionPayload,
  buildAuthPayload,
  createChallenge,
  currentTimestamp,
  normalizeActionArgs,
  signActionEnvelope,
  signAuthEnvelope,
  signPayload,
  verifyPayload,
  CHALLENGE_BYTES,
  SIGNATURE_BYTES,
  type ActionLabel,
} from './index';

const seed = hexToBytes(vectors.seed_and_user_address.seed_hex);
const userAddress = vectors.seed_and_user_address.user_address;
const serverAuthToken = vectors.server_auth_token.server_auth_token_hex;

const tree = await deriveKeyTreeFromSeed(seed);
const privateKey = tree.identity.privateKey;
const publicKey = tree.identity.publicKeyUncompressed;
const identity = { privateKey, serverAuthToken };

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
  it('is IEEE P1363 — 64 raw bytes, base64', () => {
    const signature = signPayload(buildAuthPayload(CHALLENGE, TIMESTAMP), privateKey);
    const raw = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    expect(raw).toHaveLength(SIGNATURE_BYTES);
  });

  it('is not ASN.1/DER — a DER signature starts 0x30 and varies in length', () => {
    for (let i = 0; i < 20; i++) {
      const signature = signPayload(`${createChallenge()}:${TIMESTAMP}`, privateKey);
      const raw = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      expect(raw).toHaveLength(64);
    }
  });

  it('verifies against the derived public key', () => {
    const payload = buildAuthPayload(CHALLENGE, TIMESTAMP);
    expect(verifyPayload(payload, signPayload(payload, privateKey), publicKey)).toBe(true);
  });
});

describe('the signature is bound to everything in its payload', () => {
  const payload = buildActionPayload(CHALLENGE, TIMESTAMP, 'secret-delete', ['request-1']);
  const signature = signPayload(payload, privateKey);

  it('verifies against its own payload', () => {
    expect(verifyPayload(payload, signature, publicKey)).toBe(true);
  });

  it('is bound to the challenge', () => {
    const other = buildActionPayload('b'.repeat(64), TIMESTAMP, 'secret-delete', ['request-1']);
    expect(verifyPayload(other, signature, publicKey)).toBe(false);
  });

  it('is bound to the timestamp', () => {
    const other = buildActionPayload(CHALLENGE, TIMESTAMP + 1, 'secret-delete', ['request-1']);
    expect(verifyPayload(other, signature, publicKey)).toBe(false);
  });

  it('is bound to the action label', () => {
    const other = buildActionPayload(CHALLENGE, TIMESTAMP, 'note-delete', ['request-1']);
    expect(verifyPayload(other, signature, publicKey)).toBe(false);
  });

  it('is bound to the arguments', () => {
    const other = buildActionPayload(CHALLENGE, TIMESTAMP, 'secret-delete', ['request-2']);
    expect(verifyPayload(other, signature, publicKey)).toBe(false);
  });
});

describe('a sign-in signature can never be used as an action signature', () => {
  it('refuses in both directions — two fields can never collide with three or more', () => {
    const authPayload = buildAuthPayload(CHALLENGE, TIMESTAMP);
    const authSignature = signPayload(authPayload, privateKey);

    const actionPayload = buildActionPayload(CHALLENGE, TIMESTAMP, 'account-delete', [
      userAddress,
    ]);
    const actionSignature = signPayload(actionPayload, privateKey);

    expect(verifyPayload(actionPayload, authSignature, publicKey)).toBe(false);
    expect(verifyPayload(authPayload, actionSignature, publicKey)).toBe(false);
  });

  it('never produces an action payload with only two fields', () => {
    for (const action of Object.keys(ACTIONS) as ActionLabel[]) {
      const args = ACTIONS[action].args.map((name, index) => `${name}-${index}`);
      const payload = buildActionPayload(CHALLENGE, TIMESTAMP, action, args);
      expect(payload.split(':').length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('secret-delete is the one batchable action', () => {
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

describe('the action table matches the authoritative spec', () => {
  it('covers all 6 actions', () => {
    expect(Object.keys(ACTIONS)).toHaveLength(6);
  });

  it('makes document-delete batchable, like secret-delete and note-delete', () => {
    expect(ACTIONS['document-delete']).toMatchObject({
      args: ['document_id'],
      secondFactor: true,
      signer: 'owner',
      variadic: true,
    });
  });

  it('makes note-delete batchable, like secret-delete', () => {
    expect(ACTIONS['note-delete']).toMatchObject({
      args: ['note_id'],
      secondFactor: true,
      signer: 'owner',
      variadic: true,
    });
  });

  it('normalizes note-delete ids the way the server rebuilds them — sorted and de-duplicated', () => {
    const a = '0c892e57-93cf-423a-a9e9-fee5a9f87681';
    const b = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const c = 'ba7816bf-8f01-4fea-9411-2b4c3f5a1e77';

    expect(normalizeActionArgs('note-delete', [c, a, b, a])).toEqual([a, b, c]);
    expect(() => normalizeActionArgs('note-delete', [])).toThrow(/at least one/);
  });

  it('encodes the one structural second-factor carve-out', () => {
    expect(ACTIONS['enable-second-factor'].secondFactor).toBe(false);
  });

  it('demands the second factor everywhere else', () => {
    for (const [action, spec] of Object.entries(ACTIONS)) {
      expect(spec.secondFactor).toBe(action !== 'enable-second-factor');
    }
  });

  it('records who signs; every action today is the account owner acting on itself', () => {
    for (const spec of Object.values(ACTIONS)) {
      expect(spec.signer).toBe('owner');
    }
  });
});

describe('second factor attachment', () => {
  it('attaches password on a Paranoid auth envelope and omits it on Standard', () => {
    expect(signAuthEnvelope(identity, { paranoid: true }).password).toBe(serverAuthToken);
    expect(signAuthEnvelope(identity, { paranoid: false }).password).toBeUndefined();
  });

  it('attaches password when the action demands it and the account is Paranoid', () => {
    expect(signActionEnvelope('account-delete', [userAddress], identity, { paranoid: true }).password)
      .toBe(serverAuthToken);
  });

  it('omits password on a Standard account even for a second-factor action', () => {
    expect(
      signActionEnvelope('account-delete', [userAddress], identity, { paranoid: false }).password,
    ).toBeUndefined();
  });

  it('omits password for the carve-outs even on a Paranoid account', () => {
    for (const action of ['enable-second-factor'] as const) {
      const args = ACTIONS[action].args.map((name) => `${name}-value`);
      expect(signActionEnvelope(action, args, identity, { paranoid: true }).password).toBeUndefined();
    }
  });

  it('refuses to sign a Paranoid request with no token held', () => {
    expect(() =>
      signActionEnvelope('account-delete', [userAddress], { privateKey }, { paranoid: true }),
    ).toThrow(/Server_Auth_Token/);
    expect(() => signAuthEnvelope({ privateKey }, { paranoid: true })).toThrow(/Server_Auth_Token/);
  });
});

describe('envelopes are fresh per call', () => {
  it('never reuses a challenge across two signings of the same action', () => {
    const first = signActionEnvelope('note-delete', ['id-1'], identity, { paranoid: false });
    const second = signActionEnvelope('note-delete', ['id-1'], identity, { paranoid: false });
    expect(first.challenge).not.toBe(second.challenge);
    expect(first.signature).not.toBe(second.signature);
  });

  it('produces an envelope whose signature verifies over its own rebuilt payload', () => {
    const envelope = signActionEnvelope('account-delete', ['a-user-address'], identity, {
      paranoid: true,
    });
    const payload = buildActionPayload(
      envelope.challenge,
      envelope.timestamp,
      'account-delete',
      ['a-user-address'],
    );
    expect(verifyPayload(payload, envelope.signature, publicKey)).toBe(true);
  });
});
