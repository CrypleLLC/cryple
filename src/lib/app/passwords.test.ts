import { describe, expect, it } from 'vitest';
import {
  buildPasswordRows,
  decodeCredentialPayload,
  encodeCredentialPayload,
  MalformedCredentialPayloadError,
  siteLabel,
  UNREADABLE_CREDENTIAL_SITE,
  type OpenedCredential,
} from './passwords';
import type { CredentialSummary } from '@/lib/credentials';

function record(overrides: Partial<CredentialSummary> = {}): CredentialSummary {
  return {
    credential_id: '3f6b0d3e-8f2a-4d1c-9a5e-2b7c1d4e6f80',
    revision_id: '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
    seq: 1,
    ciphertext: 'sealed',
    wrapped_dek: 'wrapped',
    key_generation: 1,
    version: 'v1',
    created_at: '2026-09-24T10:00:00Z',
    ...overrides,
  };
}

function opened(plaintext: string, overrides: Partial<CredentialSummary> = {}): OpenedCredential {
  return { record: record(overrides), plaintext };
}

describe('the credential payload', () => {
  it('round-trips every field', () => {
    const payload = { site: 'example.com', username: 'ada', password: 'hunter2', note: 'work' };
    expect(decodeCredentialPayload(encodeCredentialPayload(payload))).toEqual(payload);
  });

  it('omits an empty note rather than storing one', () => {
    const encoded = encodeCredentialPayload({
      site: 'example.com',
      username: 'ada',
      password: 'hunter2',
      note: '',
    });
    expect(JSON.parse(encoded)).not.toHaveProperty('note');
    expect(decodeCredentialPayload(encoded).note).toBeUndefined();
  });

  it('refuses a payload this UI did not write', () => {
    expect(() => decodeCredentialPayload('not json')).toThrow(MalformedCredentialPayloadError);
    expect(() => decodeCredentialPayload('{"site":"a"}')).toThrow(MalformedCredentialPayloadError);
    expect(() => decodeCredentialPayload('{"site":"a","username":"b","password":3}')).toThrow(
      MalformedCredentialPayloadError,
    );
  });
});

describe('the password rows', () => {
  it('sorts by site and then username, case-insensitively', () => {
    const rows = buildPasswordRows([
      opened('{"site":"zeta.com","username":"ada","password":"p"}', { credential_id: '1' }),
      opened('{"site":"Alpha.com","username":"zoe","password":"p"}', { credential_id: '2' }),
      opened('{"site":"alpha.com","username":"ada","password":"p"}', { credential_id: '3' }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(['3', '2', '1']);
  });

  it('renders a credential it cannot open without leaking an empty row', () => {
    const rows = buildPasswordRows([{ record: record() }]);

    expect(rows[0].readable).toBe(false);
    expect(rows[0].site).toBe(UNREADABLE_CREDENTIAL_SITE);
    expect(rows[0].password).toBe('');
  });

  it('treats a payload from another writer as unreadable rather than throwing', () => {
    const rows = buildPasswordRows([opened('{"name":"old","value":"shape"}')]);

    expect(rows[0].readable).toBe(false);
  });
});

describe('the site label', () => {
  it('reduces a stored URL to its host for display', () => {
    expect(siteLabel('https://www.example.com/login?next=/')).toBe('example.com');
    expect(siteLabel('example.com')).toBe('example.com');
  });

  it('shows what the user typed when it is not a URL', () => {
    expect(siteLabel('My bank')).toBe('My bank');
  });
});

describe('fields this app does not know', () => {
  it('survive an edit made here', () => {
    const written = JSON.stringify({
      site: 'https://github.com',
      username: 'pedro',
      password: 'old',
      totp_seed: 'JBSWY3DP',
      urls: ['https://gist.github.com'],
      match: 'host',
    });
    const decoded = decodeCredentialPayload(written);
    expect(decoded.urls).toEqual(['https://gist.github.com']);
    expect(decoded.match).toBe('host');
    expect(decoded.extra).toEqual({ totp_seed: 'JBSWY3DP' });

    const edited = JSON.parse(encodeCredentialPayload({ ...decoded, password: 'new' }));
    expect(edited).toEqual({
      totp_seed: 'JBSWY3DP',
      site: 'https://github.com',
      username: 'pedro',
      password: 'new',
      urls: ['https://gist.github.com'],
      match: 'host',
    });
  });

  it('drop an empty address and the default match', () => {
    const encoded = JSON.parse(
      encodeCredentialPayload({ site: 'a', username: 'b', password: 'c', urls: [' ', ''], match: 'domain' }),
    );
    expect(encoded).toEqual({ site: 'a', username: 'b', password: 'c' });
  });

  it('refuse a malformed urls or match', () => {
    expect(() => decodeCredentialPayload('{"site":"a","username":"b","password":"c","urls":"x"}')).toThrow(
      MalformedCredentialPayloadError,
    );
    expect(() => decodeCredentialPayload('{"site":"a","username":"b","password":"c","match":"x"}')).toThrow(
      MalformedCredentialPayloadError,
    );
  });
});
