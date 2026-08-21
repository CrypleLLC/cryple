import { describe, expect, it } from 'vitest';
import { pinSponsorshipPolicy, readSponsorshipPolicyId } from './context';

const OP = { sender: '0x1' };
const ENTRY_POINT = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const CHAIN = '0x66eee';

function contextOf(params: readonly unknown[]): Record<string, unknown> {
  return params[3] as Record<string, unknown>;
}

describe('pinSponsorshipPolicy', () => {
  it('overrides a caller-supplied policy id rather than honouring it', () => {
    const pinned = pinSponsorshipPolicy(
      'pm_getPaymasterStubData',
      [OP, ENTRY_POINT, CHAIN, { sponsorshipPolicyId: 'sp_attacker_chosen' }],
      'sp_configured',
    );
    expect(contextOf(pinned).sponsorshipPolicyId).toBe('sp_configured');
  });

  it('injects the policy when the caller sent no context at all', () => {
    const pinned = pinSponsorshipPolicy('pm_getPaymasterData', [OP, ENTRY_POINT, CHAIN], 'sp_configured');
    expect(pinned).toHaveLength(4);
    expect(contextOf(pinned).sponsorshipPolicyId).toBe('sp_configured');
  });

  it('strips a caller-supplied policy when the server has none configured', () => {
    const pinned = pinSponsorshipPolicy(
      'pm_getPaymasterStubData',
      [OP, ENTRY_POINT, CHAIN, { sponsorshipPolicyId: 'sp_attacker_chosen' }],
      undefined,
    );
    expect(contextOf(pinned)).not.toHaveProperty('sponsorshipPolicyId');
  });

  it('preserves other context fields the caller sent', () => {
    const pinned = pinSponsorshipPolicy(
      'pm_getPaymasterData',
      [OP, ENTRY_POINT, CHAIN, { sponsorshipPolicyId: 'sp_other', token: '0xUSDC' }],
      'sp_configured',
    );
    expect(contextOf(pinned)).toEqual({ sponsorshipPolicyId: 'sp_configured', token: '0xUSDC' });
  });

  it('replaces a non-object context instead of spreading it', () => {
    for (const supplied of [null, 'sp_string', 42, ['sp_array']]) {
      const pinned = pinSponsorshipPolicy(
        'pm_getPaymasterStubData',
        [OP, ENTRY_POINT, CHAIN, supplied],
        'sp_configured',
      );
      expect(contextOf(pinned)).toEqual({ sponsorshipPolicyId: 'sp_configured' });
    }
  });

  it('leaves the userOp, entryPoint and chain id untouched', () => {
    const pinned = pinSponsorshipPolicy('pm_getPaymasterData', [OP, ENTRY_POINT, CHAIN, {}], 'sp_configured');
    expect(pinned[0]).toBe(OP);
    expect(pinned[1]).toBe(ENTRY_POINT);
    expect(pinned[2]).toBe(CHAIN);
  });

  it('does not touch bundler methods', () => {
    const params = [OP, ENTRY_POINT];
    for (const method of [
      'eth_sendUserOperation',
      'eth_estimateUserOperationGas',
      'eth_getUserOperationReceipt',
    ]) {
      expect(pinSponsorshipPolicy(method, params, 'sp_configured'), method).toBe(params);
    }
  });

  it('does not mutate the caller params in place', () => {
    const supplied = { sponsorshipPolicyId: 'sp_attacker_chosen' };
    const params = [OP, ENTRY_POINT, CHAIN, supplied];
    pinSponsorshipPolicy('pm_getPaymasterStubData', params, 'sp_configured');
    expect(supplied.sponsorshipPolicyId).toBe('sp_attacker_chosen');
    expect(params[3]).toBe(supplied);
  });
});

describe('readSponsorshipPolicyId', () => {
  it('treats absent and whitespace-only as unconfigured', () => {
    expect(readSponsorshipPolicyId({})).toBeUndefined();
    expect(readSponsorshipPolicyId({ SPONSORSHIP_POLICY_ID: '   ' })).toBeUndefined();
  });

  it('trims a configured id', () => {
    expect(readSponsorshipPolicyId({ SPONSORSHIP_POLICY_ID: ' sp_configured ' })).toBe('sp_configured');
  });
});
