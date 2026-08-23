import { describe, expect, it } from 'vitest';
import type { ReleaseStatusRecord } from '@/lib/succession';
import type { SwitchRecord } from '@/lib/chain';
import { buildHeartbeatView, describeOperation } from './heartbeat';

const now = new Date('2026-08-19T12:00:00Z');
const unix = (date: string) => Math.floor(new Date(date).getTime() / 1000);

function record(chain: Partial<ReleaseStatusRecord['chain']> = {}): ReleaseStatusRecord {
  return {
    status: 'monitoring',
    votes: 0,
    required_votes: 1,
    release_cycle: 0,
    inactivity_threshold_days: 30,
    chain: {
      indexed: true,
      smart_account_address: '0xebd631e5f50b23ea0281620f6995d9d18e5cae20',
      status: 'active',
      ...chain,
    },
  };
}

function onchain(over: Partial<SwitchRecord> = {}): SwitchRecord {
  return {
    deployed: true,
    status: 'active',
    lastCheckIn: unix('2026-08-19T11:50:00Z'),
    inactivityPeriodSeconds: 3600,
    contestPeriodSeconds: 300,
    ...over,
  };
}

describe('the chain outranks the mirror', () => {
  it('does not claim the account is off-chain when the indexer is behind', () => {
    const stale = record({ indexed: false, status: 'unknown' });
    expect(buildHeartbeatView(stale, undefined, now).urgency).toBe('unconfigured');
    expect(buildHeartbeatView(stale, onchain(), now).urgency).toBe('idle');
  });

  it('takes the last check-in from the chain, not from the mirror', () => {
    const stale = record({ status: 'active', last_check_in: unix('2020-01-01T00:00:00Z') });
    const view = buildHeartbeatView(stale, onchain(), now);
    expect(view.lastCheckIn?.toISOString()).toBe('2026-08-19T11:50:00.000Z');
  });

  it('falls back to the mirror when the chain cannot be read', () => {
    const view = buildHeartbeatView(
      record({ status: 'active', last_check_in: unix('2026-08-19T11:50:00Z'), inactivity_period_seconds: 3600 }),
      undefined,
      now,
    );
    expect(view.urgency).toBe('idle');
  });
});

describe('heartbeat view', () => {
  it('offers to turn the switch on when the chain says unconfigured', () => {
    const view = buildHeartbeatView(record(), onchain({ status: 'unconfigured', lastCheckIn: undefined }), now);
    expect(view.urgency).toBe('unconfigured');
    expect(view.actionLabel).toBe('Turn on my switch');
  });

  it('stays quiet while the check-in is recent', () => {
    expect(buildHeartbeatView(record(), onchain(), now).urgency).toBe('idle');
  });

  it('nudges once half the inactivity period has passed', () => {
    const view = buildHeartbeatView(
      record(),
      onchain({ lastCheckIn: unix('2026-08-19T11:20:00Z') }),
      now,
    );
    expect(view.urgency).toBe('due');
    expect(view.offerOnLogin).toBe(true);
  });

  it('warns once guardians could act', () => {
    const view = buildHeartbeatView(
      record(),
      onchain({ lastCheckIn: unix('2026-08-19T10:00:00Z') }),
      now,
    );
    expect(view.urgency).toBe('overdue');
  });

  it('treats a running countdown as the most urgent state', () => {
    const view = buildHeartbeatView(record(), onchain({ status: 'contest' }), now);
    expect(view.urgency).toBe('contested');
    expect(view.headline).toContain('countdown');
  });

  it('never asks a released vault to look idle', () => {
    expect(buildHeartbeatView(record(), onchain({ status: 'released' }), now).urgency).toBe(
      'contested',
    );
  });

  it('keeps every headline free of chain vocabulary', () => {
    const states: SwitchRecord[] = [
      onchain(),
      onchain({ status: 'contest' }),
      onchain({ lastCheckIn: unix('2026-08-19T10:00:00Z') }),
      onchain({ status: 'unconfigured', lastCheckIn: undefined }),
    ];
    const jargon = /gas|paymaster|sponsor|userop|bundler|smart account|entrypoint|wei|eth\b/i;
    for (const state of states) {
      const view = buildHeartbeatView(record(), state, now);
      expect(view.headline).not.toMatch(jargon);
      expect(view.actionLabel).not.toMatch(jargon);
    }
  });
});

describe('operation labels', () => {
  it('uses plain language for both operations', () => {
    expect(describeOperation('check-in')).toBe("I'm alive");
    expect(describeOperation('deploy-and-configure')).toBe('Turn on my switch');
  });
});
