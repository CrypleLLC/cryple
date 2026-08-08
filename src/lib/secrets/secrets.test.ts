import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { TokenStore } from '@/lib/api';
import { SessionKeystore } from '@/lib/session';
import { buildActionPayload, verifyPayload } from '@/lib/signing';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { bytesToBase64, hexToBytes } from '@/lib/encoding';
import {
  createSecret,
  deleteSecret,
  deleteSecrets,
  generateDek,
  getSecret,
  hashReceivedCiphertext,
  KekNotSpecifiedError,
  listSecrets,
  listSecretsMeta,
  openSecret,
  openText,
  sealText,
  unspecifiedDekWrapper,
  UnsupportedPayloadVersionError,
  DEK_LENGTH,
  MAX_PLAINTEXT_BYTES,
  PAYLOAD_VERSION,
  type DekWrapper,
  type SecretsContext,
} from './index';

const mnemonic = vectors.seed_and_user_address.mnemonic;
const pin = vectors.server_auth_token.pin;
const publicKey = (await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex)))
  .identity.publicKeyUncompressed;

const ID_A = '0c892e57-93cf-423a-a9e9-fee5a9f87681';
const ID_B = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const ID_C = 'ba7816bf-8f01-4fea-9411-2b4c3f5a1e77';

/**
 * A stand-in so the transport and signing paths can be exercised while the real
 * KEK derivation is unspecified. It is NOT a protocol proposal: it stores the DEK
 * in the clear and must never leave this test file.
 */
function fakeDekWrapperForTestsOnly(): DekWrapper {
  return {
    async wrapDek(dek) {
      return bytesToBase64(dek);
    },
    async unwrapDek(wrapped) {
      return Uint8Array.from(atob(wrapped), (c) => c.charCodeAt(0));
    },
  };
}

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method as string,
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

async function newContext(
  options: { paranoid?: boolean; dek?: DekWrapper } = {},
): Promise<SecretsContext> {
  const session = new SessionKeystore({ idleTimeoutMs: 0 });
  await session.unlockWithMnemonic(mnemonic, pin);
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return {
    session,
    tokens,
    paranoid: options.paranoid ?? true,
    dek: options.dek,
  };
}

const storedSecret = {
  id: ID_A,
  ciphertext: 'AXh4eHh4eHh4eHh4Y2lwaGVy',
  wrapped_dek: 'd3JhcHBlZA==',
  version: 'v1',
  created_at: '2026-07-26T12:00:00Z',
  updated_at: '2026-07-26T12:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('Task 12 — the DEK seam ships unimplemented, on purpose', () => {
  it('throws a named error rather than inventing a KEK', async () => {
    await expect(unspecifiedDekWrapper.wrapDek(generateDek())).rejects.toThrow(
      KekNotSpecifiedError,
    );
    await expect(unspecifiedDekWrapper.unwrapDek('anything')).rejects.toThrow(
      KekNotSpecifiedError,
    );
  });

  it('points at the spec that has to resolve it', async () => {
    const error = await unspecifiedDekWrapper.wrapDek(generateDek()).catch((e) => e);
    expect(error.message).toMatch(/ECDSA\.md/);
    expect(error.message).toMatch(/opaque/);
  });

  it('is what a secrets call hits when no wrapper is supplied', async () => {
    mockFetch({ status: 201, body: { data: storedSecret } });
    await expect(createSecret(await newContext(), 'my secret')).rejects.toThrow(
      KekNotSpecifiedError,
    );
  });

  it('generates a random 256-bit DEK', () => {
    const a = generateDek();
    const b = generateDek();
    expect(a).toHaveLength(DEK_LENGTH);
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(b));
  });
});

describe('payload codec', () => {
  it('round-trips text under a DEK', async () => {
    const dek = generateDek();
    const sealed = await sealText('bank pin 1234', dek);
    expect(await openText(sealed, dek)).toBe('bank pin 1234');
  });

  it('carries a version byte so a future layout change is detectable', async () => {
    const dek = generateDek();
    const blob = Uint8Array.from(atob(await sealText('x', dek)), (c) => c.charCodeAt(0));
    expect(blob[0]).toBe(PAYLOAD_VERSION);
  });

  it('rejects an unknown version byte instead of guessing', async () => {
    const dek = generateDek();
    const blob = Uint8Array.from(atob(await sealText('x', dek)), (c) => c.charCodeAt(0));
    blob[0] = 0x02;
    await expect(openText(bytesToBase64(blob), dek)).rejects.toThrow(
      UnsupportedPayloadVersionError,
    );
  });

  it('rejects a blob too short to hold iv and tag', async () => {
    await expect(openText(bytesToBase64(new Uint8Array(8)), generateDek())).rejects.toThrow(
      /shorter than/,
    );
  });

  it('uses a fresh IV per encryption', async () => {
    const dek = generateDek();
    expect(await sealText('same', dek)).not.toBe(await sealText('same', dek));
  });

  it('fails to open under the wrong DEK', async () => {
    const sealed = await sealText('secret', generateDek());
    await expect(openText(sealed, generateDek())).rejects.toThrow();
  });
});

describe('POST /secrets', () => {
  it('sends a client-generated id — that is what makes the retry safe', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedSecret } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    await createSecret(context, 'my secret');

    const body = calls[0].body!;
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.version).toBe('v1');
    expect(typeof body.ciphertext).toBe('string');
    expect(typeof body.wrapped_dek).toBe('string');
  });

  it('reuses a caller-supplied id so a retry replays the identical body', async () => {
    const calls = mockFetch({ status: 200, body: { data: storedSecret } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    const result = await createSecret(context, 'my secret', { id: ID_A });
    expect(calls[0].body!.id).toBe(ID_A);
    expect(result.created).toBe(false);
  });

  it('distinguishes 201 stored from 200 already stored', async () => {
    mockFetch({ status: 201, body: { data: storedSecret } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });
    expect((await createSecret(context, 'x')).created).toBe(true);
  });

  it('never puts the plaintext on the wire', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedSecret } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    await createSecret(context, 'correct horse battery staple');
    expect(JSON.stringify(calls[0].body)).not.toContain('correct horse');
  });

  it('refuses a payload over the per-item plaintext budget', async () => {
    mockFetch({ status: 201, body: { data: storedSecret } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    await expect(
      createSecret(context, 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)),
    ).rejects.toThrow(/per-item budget/);
  });

  it('refuses a non-canonical supplied id', async () => {
    mockFetch({ status: 201, body: { data: storedSecret } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });
    await expect(createSecret(context, 'x', { id: ID_A.toUpperCase() })).rejects.toThrow(
      /canonical/,
    );
  });

  it('round-trips through openSecret', async () => {
    const calls = mockFetch({ status: 201, body: { data: storedSecret } });
    const context = await newContext({ dek: fakeDekWrapperForTestsOnly() });

    await createSecret(context, 'the real payload');
    const echoed = {
      ...storedSecret,
      ciphertext: calls[0].body!.ciphertext as string,
      wrapped_dek: calls[0].body!.wrapped_dek as string,
    };

    expect(await openSecret(context, echoed)).toBe('the real payload');
  });
});

describe('reads', () => {
  it('renders the vault index from ?fields=meta', async () => {
    const calls = mockFetch({ status: 200, body: { data: [] } });
    await listSecretsMeta(await newContext());
    expect(calls[0].url).toBe('http://localhost:8080/secrets?fields=meta');
  });

  it('fetches the full listing without pagination parameters', async () => {
    const calls = mockFetch({ status: 200, body: { data: [storedSecret] } });
    expect(await listSecrets(await newContext())).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8080/secrets');
  });

  it('returns an empty array for an empty vault', async () => {
    mockFetch({ status: 200, body: { data: [] } });
    expect(await listSecrets(await newContext())).toEqual([]);
  });

  it('reads a single secret by canonical id', async () => {
    const calls = mockFetch({ status: 200, body: { data: storedSecret } });
    expect((await getSecret(await newContext(), ID_A)).id).toBe(ID_A);
    expect(calls[0].url).toContain(`/secrets/${ID_A}`);
  });

  it('hashes the ciphertext you received rather than trusting ciphertext_sha256', async () => {
    const digest = await hashReceivedCiphertext(storedSecret.ciphertext);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashReceivedCiphertext('tampered')).not.toBe(digest);
  });
});

describe('deletes', () => {
  it('sends a required body carrying the secret-delete signature', async () => {
    const calls = mockFetch({ status: 204 });
    await deleteSecret(await newContext(), ID_A);

    const body = calls[0].body!;
    expect(calls[0].method).toBe('DELETE');
    expect(body).toBeDefined();
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'secret-delete',
          [ID_A],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
  });

  it('sorts and de-duplicates the batch before signing', async () => {
    const calls = mockFetch({ status: 200, body: { data: { requested: 3, deleted: 3 } } });

    const result = await deleteSecrets(await newContext(), [ID_C, ID_A, ID_B, ID_A]);

    const body = calls[0].body!;
    expect(body.ids).toEqual([ID_A, ID_B, ID_C]);
    expect(
      verifyPayload(
        buildActionPayload(
          body.challenge as string,
          body.timestamp as number,
          'secret-delete',
          [ID_A, ID_B, ID_C],
        ),
        body.signature as string,
        publicKey,
      ),
    ).toBe(true);
    expect(result).toEqual({ requested: 3, deleted: 3 });
  });

  it('reads the 200 body — deleted below requested is not an error', async () => {
    mockFetch({ status: 200, body: { data: { requested: 2, deleted: 1 } } });
    expect(await deleteSecrets(await newContext(), [ID_A, ID_B])).toEqual({
      requested: 2,
      deleted: 1,
    });
  });

  it('attaches password only on a Paranoid account', async () => {
    const paranoid = mockFetch({ status: 204 });
    await deleteSecret(await newContext({ paranoid: true }), ID_A);
    expect(paranoid[0].body).toHaveProperty('password');

    const standard = mockFetch({ status: 204 });
    await deleteSecret(await newContext({ paranoid: false }), ID_A);
    expect(standard[0].body).not.toHaveProperty('password');
  });

  it('refuses a non-canonical id in either form', async () => {
    mockFetch({ status: 204 });
    await expect(deleteSecret(await newContext(), 'nope')).rejects.toThrow(/canonical/);
    await expect(deleteSecrets(await newContext(), [ID_A, 'nope'])).rejects.toThrow(
      /canonical/,
    );
  });
});
