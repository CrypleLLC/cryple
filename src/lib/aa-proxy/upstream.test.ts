import { describe, expect, it } from 'vitest';
import {
  PUBLIC_PIMLICO_URL,
  describeUpstreamRejection,
  isAuthenticatedUpstream,
  resolveUpstreamUrl,
} from './upstream';
import { UPSTREAM_UNAUTHORIZED } from './envelope';
import { CHAIN_ID } from '@/lib/chain/config';

describe('resolveUpstreamUrl', () => {
  it('falls back to the public endpoint when nothing is configured', () => {
    expect(resolveUpstreamUrl({})).toBe(PUBLIC_PIMLICO_URL);
    expect(isAuthenticatedUpstream({})).toBe(false);
  });

  it('builds the authenticated endpoint from the server-only key', () => {
    const url = resolveUpstreamUrl({ PIMLICO_API_KEY: 'pim_test_key' });
    expect(url).toBe(`https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=pim_test_key`);
    expect(isAuthenticatedUpstream({ PIMLICO_API_KEY: 'pim_test_key' })).toBe(true);
  });

  it('percent-encodes the key rather than splicing it raw', () => {
    expect(resolveUpstreamUrl({ PIMLICO_API_KEY: 'a&b=c' })).toContain('apikey=a%26b%3Dc');
  });

  it('treats a whitespace-only key as absent', () => {
    expect(resolveUpstreamUrl({ PIMLICO_API_KEY: '   ' })).toBe(PUBLIC_PIMLICO_URL);
  });

  it('lets an explicit url win over the key', () => {
    expect(resolveUpstreamUrl({ PIMLICO_RPC_URL: 'https://self-hosted/rpc', PIMLICO_API_KEY: 'k' })).toBe(
      'https://self-hosted/rpc',
    );
  });
});

describe('describeUpstreamRejection', () => {
  it('turns a 401 into a permanent, self-describing error', () => {
    const rejection = describeUpstreamRejection(401);
    expect(rejection?.code).toBe(UPSTREAM_UNAUTHORIZED);
    expect(rejection?.message).toContain('401');
    expect(rejection?.message).toContain('Retrying will not help');
  });

  it('distinguishes a 403 method refusal from a bad key', () => {
    const rejection = describeUpstreamRejection(403);
    expect(rejection?.code).toBe(UPSTREAM_UNAUTHORIZED);
    expect(rejection?.message).toContain('methods enabled on the');
  });

  it('leaves every other status to pass through untouched', () => {
    for (const status of [200, 400, 429, 500, 502, 503]) {
      expect(describeUpstreamRejection(status), String(status)).toBeUndefined();
    }
  });

  it('never echoes the upstream url, which carries the key', () => {
    for (const status of [401, 403]) {
      expect(describeUpstreamRejection(status)?.message).not.toContain('apikey');
      expect(describeUpstreamRejection(status)?.message).not.toContain('pimlico.io');
    }
  });
});
