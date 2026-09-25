import { scopeDekWrapper } from '@/lib/keyrings';
import { openTestSession } from '@/test/session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '@/lib/api';
import { buildActionPayload, verifyPayload, type ActionLabel } from '@/lib/signing';
import { spkiBase64ToUncompressedPoint } from '@/lib/encoding';
import {
  deleteCredential,
  deleteCredentials,
  generateDek,
  listCredentials,
  listCredentialsMeta,
  openCredential,
  pruneCredential,
  syncCredentials,
  writeCredential,
  MAX_PLAINTEXT_BYTES,
  type CredentialsContext,
  type DekWrapper,
  deletedCredentials,
} from './index';

const ID_A = '0c892e57-93cf-423a-a9e9-fee5a9f87681';
const ID_B = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const ID_C = 'ba7816bf-8f01-4fea-9411-2b4c3f5a1e77';

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

async function newContext(options: { dek?: DekWrapper } = {}): Promise<CredentialsContext> {
  const { session } = (await openTestSession()).context;
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { session, tokens, paranoid: true, dek: options.dek };
}

const storedRevision = {
  credential_id: ID_A,
  revision_id: ID_B,
  seq: 7,
  ciphertext: 'AXh4eHh4eHh4eHh4Y2lwaGVy',
  wrapped_dek: 'd3JhcHBlZA==',
  key_generation: 1,
  version: 'v1',
  created_at: '2026-09-24T12:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('a credential DEK is wrapped under the passwords KEK', () => {
  it('wraps under passwords, not under secrets', async () => {
    const context = await newContext();
    const dek = generateDek();

    const underPasswords = await scopeDekWrapper(context, 'passwords').wrapDek(dek);
    const underSecrets = await scopeDekWrapper(context, 'secrets').wrapDek(dek);

    expect(underPasswords.wrapped_dek).not.toBe(underSecrets.wrapped_dek);
    await expect(scopeDekWrapper(context, 'secrets').unwrapDek(underPasswords)).rejects.toThrow();
  });

  it('round-trips a credential through the passwords KEK', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 201, body: { data: storedRevision } });

    await writeCredential(context, '{"site":"a","username":"b","password":"c"}', {
      credentialId: ID_A,
      revisionId: ID_B,
    });

    const sent = calls[0].body as { ciphertext: string; wrapped_dek: string };
    const plaintext = await openCredential(context, {
      ...storedRevision,
      ciphertext: sent.ciphertext,
      wrapped_dek: sent.wrapped_dek,
    });

    expect(JSON.parse(plaintext)).toEqual({ site: 'a', username: 'b', password: 'c' });
  });
});

describe('writing is an append', () => {
  it('posts rather than putting, and carries both ids so a retry is one row', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 201, body: { data: storedRevision } });

    const result = await writeCredential(context, 'payload', {
      credentialId: ID_A,
      revisionId: ID_B,
    });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/credentials');
    expect(calls[0].body).toMatchObject({ credential_id: ID_A, revision_id: ID_B });
    expect(result.created).toBe(true);
  });

  it('reports a replayed revision as not created', async () => {
    const context = await newContext();
    mockFetch({ status: 200, body: { data: storedRevision } });

    const result = await writeCredential(context, 'payload', {
      credentialId: ID_A,
      revisionId: ID_B,
    });

    expect(result.created).toBe(false);
  });

  it('editing reuses the credential id, so an edit is a new revision of the same credential', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 201, body: { data: storedRevision } });

    await writeCredential(context, 'first', { credentialId: ID_A });
    await writeCredential(context, 'second', { credentialId: ID_A });

    const first = calls[0].body as Record<string, string>;
    const second = calls[1].body as Record<string, string>;
    expect(second.credential_id).toBe(first.credential_id);
    expect(second.revision_id).not.toBe(first.revision_id);
  });

  it('refuses a payload over the per-credential budget before sealing it', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 201, body: { data: storedRevision } });

    await expect(
      writeCredential(context, 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)),
    ).rejects.toThrow(/over the/);
    expect(calls).toHaveLength(0);
  });
});

describe('the two listings are different endpoints', () => {
  it('lists the vault view without a fields parameter', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 200, body: { data: [storedRevision] } });

    await listCredentials(context);

    expect(calls[0].url).toContain('/credentials');
    expect(calls[0].url).not.toContain('fields=meta');
    expect(calls[0].url).not.toContain('/sync');
  });

  it('asks for meta when it needs the rekey set', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 200, body: { data: [] } });

    await listCredentialsMeta(context);

    expect(calls[0].url).toContain('fields=meta');
  });

  it('syncs from its own route, carrying the cursor', async () => {
    const context = await newContext();
    const calls = mockFetch({
      status: 200,
      body: { data: { revisions: [], cursor: 41, has_more: false } },
    });

    await syncCredentials(context, 41);

    expect(calls[0].url).toContain('/credentials/sync');
    expect(calls[0].url).toContain('cursor=41');
  });
});

describe('the destructive calls are signed, and bind what they destroy', () => {
  function verify(
    context: CredentialsContext,
    body: Record<string, unknown>,
    action: ActionLabel,
    args: string[],
  ) {
    return verifyPayload(
      buildActionPayload(body.challenge as string, body.timestamp as number, action, args),
      body.signature as string,
      spkiBase64ToUncompressedPoint(context.session.device.signingPublicKey),
    );
  }

  it('signs the credential id on a single delete', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 204 });

    await deleteCredential(context, ID_A);

    const body = calls[0].body as Record<string, unknown>;
    expect(calls[0].method).toBe('DELETE');
    expect(await verify(context, body, 'credential-delete', [ID_A])).toBe(true);
  });

  it('sorts and de-duplicates a batch before signing it', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 200, body: { data: { requested: 3, tombstoned: 3 } } });

    await deleteCredentials(context, [ID_C, ID_A, ID_B, ID_A]);

    const body = calls[0].body as { ids: string[] };
    expect(body.ids).toEqual([ID_A, ID_B, ID_C]);
    expect(await verify(context, body as never, 'credential-delete', body.ids)).toBe(true);
  });

  it('binds keep_last into the prune signature, not only the id', async () => {
    const context = await newContext();
    const calls = mockFetch({ status: 200, body: { data: { pruned: 4 } } });

    await pruneCredential(context, ID_A, 5);

    const body = calls[0].body as Record<string, unknown>;
    expect(body.keep_last).toBe(5);
    expect(await verify(context, body, 'credential-prune', [ID_A, '5'])).toBe(true);
    expect(await verify(context, body, 'credential-prune', [ID_A, '1'])).toBe(false);
  });
});

describe('recently deleted', () => {
  const revision = (credential: string, seq: number, deleted: boolean) => ({
    credential_id: credential,
    revision_id: `${credential}-${seq}`,
    seq,
    ciphertext: deleted ? '' : 'c',
    wrapped_dek: deleted ? '' : 'w',
    key_generation: 1,
    version: 'v1',
    created_at: `2026-09-24T10:00:${String(seq).padStart(2, '0')}Z`,
    deleted,
  });

  it('lists a credential whose latest revision is a tombstone, with its last live revision', () => {
    const found = deletedCredentials([
      revision('a', 1, false),
      revision('a', 2, false),
      revision('b', 3, false),
      revision('a', 4, true),
      revision('c', 5, false),
      revision('c', 6, true),
      revision('c', 7, false),
    ]);
    expect(found.map((entry) => [entry.credentialId, entry.lastLive.seq])).toEqual([['a', 2]]);
  });
});
