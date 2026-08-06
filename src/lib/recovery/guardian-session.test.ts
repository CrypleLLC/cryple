import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { bytesToBase64, bytesToHex, hexToBytes } from '@/lib/encoding';
import { pqxdhWrap } from '@/lib/pqxdh';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import type { AuthedContext } from '@/lib/context';
import {
  awaitingSubmission,
  contributeShare,
  ephemeralPublicFields,
  generateEphemeralKeys,
  getStoredShare,
  listPendingSessions,
  submitReEncryptedShare,
  unwrapOwnShare,
  unwrapSessionShare,
  type PendingSession,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;
const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const publicKey = tree.identity.publicKeyUncompressed;

const SESSION_ID = '4d7a1b2c-4f89-11d3-9a0c-0305e82c3301';
const OWNER_ADDRESS = 'a'.repeat(64);
const GUARDIAN_ADDRESS = vectors.seed_and_user_address.user_address;

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: init.method as string,
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
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

async function newContext(paranoid = true): Promise<AuthedContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid };
}

const EPHEMERAL_KEYS = generateEphemeralKeys();
const EPHEMERAL_FIELDS = ephemeralPublicFields(EPHEMERAL_KEYS);

const SHARE_PLAINTEXT = new Uint8Array(33).fill(7);

async function ownerWrappedShare(): Promise<string> {
  return pqxdhWrap(
    SHARE_PLAINTEXT,
    { x25519PublicKey: tree.x25519.publicKey, mlkemPublicKey: tree.mlkem768.publicKey },
    {
      usage: 'recovery-share',
      senderUserAddress: OWNER_ADDRESS,
      recipientUserAddress: GUARDIAN_ADDRESS,
    },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('the guardian inbox', () => {
  const sessions: PendingSession[] = [
    {
      session_id: SESSION_ID,
      owner_username: '3f1c8a2b9d4e',
      ...EPHEMERAL_FIELDS,
      submitted: false,
      expires_at: '2026-07-26T12:30:00Z',
      created_at: '2026-07-26T12:00:00Z',
    },
    {
      session_id: '9c4f2a1b-4f89-11d3-9a0c-0305e82c3301',
      owner_username: '7a2d5e1b8c3f',
      ...EPHEMERAL_FIELDS,
      submitted: true,
      expires_at: '2026-07-26T12:30:00Z',
      created_at: '2026-07-26T12:00:00Z',
    },
  ];

  it('lists pending sessions across pages', async () => {
    mockFetch({ status: 200, body: { data: sessions, page: { has_more: false } } });
    expect(await listPendingSessions(await newContext())).toHaveLength(2);
  });

  it('separates the ones still awaiting this guardian', () => {
    expect(awaitingSubmission(sessions)).toHaveLength(1);
    expect(awaitingSubmission(sessions)[0].session_id).toBe(SESSION_ID);
  });

  it('fetches the guardian’s own stored share for a session', async () => {
    const calls = mockFetch({
      status: 200,
      body: {
        data: {
          session_id: SESSION_ID,
          ...EPHEMERAL_FIELDS,
          pq_hybrid_encrypted_share: 'opaque',
        },
      },
    });

    const stored = await getStoredShare(await newContext(), SESSION_ID);
    expect(calls[0].url).toContain(`/recovery/share/${SESSION_ID}`);
    expect(stored.pq_hybrid_encrypted_share).toBe('opaque');
  });
});

describe('unwrapping the guardian’s own share — this half IS specified', () => {
  it('opens what the owner wrapped with usage recovery-share', async () => {
    const wrapped = await ownerWrappedShare();

    const opened = await unwrapOwnShare({
      storedShare: wrapped,
      ownerUserAddress: OWNER_ADDRESS,
      guardianUserAddress: GUARDIAN_ADDRESS,
      x25519PrivateKey: tree.x25519.privateKey,
      mlkemSecretKey: tree.mlkem768.secretKey,
    });

    expect(bytesToHex(opened)).toBe(bytesToHex(SHARE_PLAINTEXT));
  });

  it('fails under the wrong owner address — the info string binds both parties', async () => {
    const wrapped = await ownerWrappedShare();

    await expect(
      unwrapOwnShare({
        storedShare: wrapped,
        ownerUserAddress: 'c'.repeat(64),
        guardianUserAddress: GUARDIAN_ADDRESS,
        x25519PrivateKey: tree.x25519.privateKey,
        mlkemSecretKey: tree.mlkem768.secretKey,
      }),
    ).rejects.toThrow();
  });
});

describe('submitting the re-encrypted share', () => {
  it('binds both the session and the share itself', async () => {
    const calls = mockFetch({ status: 204 });
    const reEncrypted = 'cmUtZW5jcnlwdGVk';

    await submitReEncryptedShare(await newContext(), SESSION_ID, reEncrypted);

    const body = calls[0].body!;
    expect(body.session_id).toBe(SESSION_ID);
    expect(body.re_encrypted_share).toBe(reEncrypted);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'recovery-share-submit',
          [SESSION_ID, reEncrypted],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('will not verify if the share is swapped — that is the point of binding it', async () => {
    const calls = mockFetch({ status: 204 });
    await submitReEncryptedShare(await newContext(), SESSION_ID, 'cmUtZW5jcnlwdGVk');

    const body = calls[0].body!;
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'recovery-share-submit',
          [SESSION_ID, 'Y29ycnVwdGVk'],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(false);
  });

  it('uses the guardian’s own second factor', async () => {
    const paranoid = mockFetch({ status: 204 });
    await submitReEncryptedShare(await newContext(true), SESSION_ID, 'x');
    expect(paranoid[0].body).toHaveProperty('password');

    const standard = mockFetch({ status: 204 });
    await submitReEncryptedShare(await newContext(false), SESSION_ID, 'x');
    expect(standard[0].body).not.toHaveProperty('password');
  });

  it('refuses an empty share before sending', async () => {
    mockFetch({ status: 204 });
    await expect(submitReEncryptedShare(await newContext(), SESSION_ID, '')).rejects.toThrow(
      /must not be empty/,
    );
  });
});

describe('the full contribution', () => {
  const storedResponse = {
    status: 200,
    body: {
      data: {
        session_id: SESSION_ID,
        ...EPHEMERAL_FIELDS,
        pq_hybrid_encrypted_share: '',
      },
    },
  };

  const contributeOptions = {
    ownerUserAddress: OWNER_ADDRESS,
    guardianUserAddress: GUARDIAN_ADDRESS,
    x25519PrivateKey: tree.x25519.privateKey,
    mlkemSecretKey: tree.mlkem768.secretKey,
  };

  it('fetches, unwraps, re-wraps and submits', async () => {
    const wrapped = await ownerWrappedShare();
    const calls = mockFetch(
      {
        status: 200,
        body: { data: { ...storedResponse.body.data, pq_hybrid_encrypted_share: wrapped } },
      },
      { status: 204 },
    );

    await contributeShare(await newContext(), SESSION_ID, contributeOptions);

    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url).toContain('/recovery/submit');
  });

  it('hands the recovering device something only its ephemeral keys can open', async () => {
    const wrapped = await ownerWrappedShare();
    const calls = mockFetch(
      {
        status: 200,
        body: { data: { ...storedResponse.body.data, pq_hybrid_encrypted_share: wrapped } },
      },
      { status: 204 },
    );

    await contributeShare(await newContext(), SESSION_ID, contributeOptions);

    const submitted = calls[1].body!.re_encrypted_share as string;
    const opened = await unwrapSessionShare(submitted, EPHEMERAL_KEYS, SESSION_ID);

    expect(bytesToHex(opened)).toBe(bytesToHex(SHARE_PLAINTEXT));
  });

  it('never puts the plaintext share on the wire', async () => {
    const wrapped = await ownerWrappedShare();
    const calls = mockFetch(
      {
        status: 200,
        body: { data: { ...storedResponse.body.data, pq_hybrid_encrypted_share: wrapped } },
      },
      { status: 204 },
    );

    await contributeShare(await newContext(), SESSION_ID, contributeOptions);

    const submitted = calls[1].body!.re_encrypted_share as string;
    expect(submitted).not.toBe(bytesToBase64(SHARE_PLAINTEXT));
    expect(atob(submitted)).not.toContain(String.fromCharCode(7).repeat(33));
  });

  it('refuses a malformed ephemeral key rather than wrapping to nonsense', async () => {
    const wrapped = await ownerWrappedShare();
    mockFetch({
      status: 200,
      body: {
        data: {
          session_id: SESSION_ID,
          ephemeral_x25519_public: 'AAAA',
          ephemeral_mlkem_public: EPHEMERAL_FIELDS.ephemeral_mlkem_public,
          pq_hybrid_encrypted_share: wrapped,
        },
      },
    });

    await expect(
      contributeShare(await newContext(), SESSION_ID, contributeOptions),
    ).rejects.toThrow(/ephemeral_x25519_public/);
  });
});
