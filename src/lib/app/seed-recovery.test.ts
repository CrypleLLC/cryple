import { describe, expect, it } from 'vitest';
import type { RecoverySession, RecoveryVault } from '@/lib/recovery';
import {
  checkRecoveryUsername,
  collectedShares,
  describeProgress,
  guardianShareCount,
  guardiansStillNeeded,
  INITIAL_SEED_RECOVERY,
  minutesRemaining,
  seedRecoveryReducer,
  thresholdIsReachable,
} from './seed-recovery';

const EXPIRES_AT = '2026-08-23T12:30:00Z';

function session(overrides: Partial<RecoverySession> = {}): RecoverySession {
  return {
    id: '9c1e5f2a-4f89-11d3-9a0c-0305e82c3301',
    n_shares: 3,
    k_threshold: 2,
    status: 'pending',
    expires_at: EXPIRES_AT,
    created_at: '2026-08-23T12:00:00Z',
    ...overrides,
  };
}

function vault(overrides: Partial<RecoveryVault> = {}): RecoveryVault {
  return {
    encrypted_seed: 'base64',
    n_shares: 3,
    k_threshold: 2,
    version: 'v1',
    ...overrides,
  };
}

function collected(count: number): RecoverySession {
  return session({
    status: 'shares_collected',
    shares: Array.from({ length: count }, () => ({
      re_encrypted_share: 'base64',
      submitted_at: '2026-08-23T12:05:00Z',
    })),
  });
}

describe('the seed recovery state machine', () => {
  it('starts on the request step with nothing held', () => {
    expect(INITIAL_SEED_RECOVERY).toEqual({ step: 'request' });
  });

  it('moves to waiting once the session exists', () => {
    const state = seedRecoveryReducer(INITIAL_SEED_RECOVERY, {
      type: 'started',
      username: 'alice1234abcd',
      session: session(),
      vault: vault(),
    });

    expect(state.step).toBe('waiting');
    expect(state.username).toBe('alice1234abcd');
    expect(state.session?.id).toBe(session().id);
  });

  it('ignores a late poll result once the step has moved on', () => {
    const waiting = seedRecoveryReducer(INITIAL_SEED_RECOVERY, {
      type: 'started',
      username: 'alice1234abcd',
      session: session(),
      vault: vault(),
    });
    const reconstructing = seedRecoveryReducer(waiting, {
      type: 'threshold-reached',
      session: collected(2),
    });

    const late = seedRecoveryReducer(reconstructing, {
      type: 'session-updated',
      session: session({ status: 'pending' }),
    });

    expect(late).toBe(reconstructing);
  });

  it('keeps the username across a restart so the field is not retyped', () => {
    const waiting = seedRecoveryReducer(INITIAL_SEED_RECOVERY, {
      type: 'started',
      username: 'alice1234abcd',
      session: session(),
      vault: vault(),
    });

    const restarted = seedRecoveryReducer(waiting, { type: 'restart' });

    expect(restarted.step).toBe('request');
    expect(restarted.username).toBe('alice1234abcd');
    expect(restarted.session).toBeUndefined();
    expect(restarted.vault).toBeUndefined();
  });

  it('reports a failure on the request step without pretending a session exists', () => {
    const failed = seedRecoveryReducer(INITIAL_SEED_RECOVERY, {
      type: 'failed',
      message: 'no such account',
    });

    expect(failed.step).toBe('request');
    expect(failed.error).toBe('no such account');
    expect(failed.session).toBeUndefined();
  });
});

describe('what the session can and cannot reach', () => {
  it("counts guardians as every share but the owner's own", () => {
    expect(guardianShareCount(session({ n_shares: 3 }))).toBe(2);
    expect(guardianShareCount(session({ n_shares: 1 }))).toBe(0);
  });

  it('accepts the recommended 2-of-3, where two guardians meet the threshold', () => {
    expect(thresholdIsReachable(session({ n_shares: 3, k_threshold: 2 }), false)).toBe(true);
  });

  it('refuses a vault whose threshold no set of guardians can meet', () => {
    expect(thresholdIsReachable(session({ n_shares: 3, k_threshold: 3 }), false)).toBe(false);
  });

  it('counts the Recovery Kit as a share, so 3-of-3 becomes reachable with it', () => {
    expect(thresholdIsReachable(session({ n_shares: 3, k_threshold: 3 }), true)).toBe(true);
  });

  it('needs one guardian fewer on a 2-of-3 when the kit is held', () => {
    expect(guardiansStillNeeded(session({ n_shares: 3, k_threshold: 2 }), true)).toBe(1);
    expect(guardiansStillNeeded(session({ n_shares: 3, k_threshold: 2 }), false)).toBe(2);
  });

  it('is satisfied by the kit plus one guardian on a 2-of-3', () => {
    expect(guardiansStillNeeded(collected(1), true)).toBe(0);
    expect(guardiansStillNeeded(collected(1), false)).toBe(1);
  });

  it('never asks for fewer than no guardians once the threshold is passed', () => {
    expect(guardiansStillNeeded(collected(2), true)).toBe(0);
  });

  it('counts collected shares as none when the field is absent', () => {
    expect(collectedShares(session())).toBe(0);
    expect(collectedShares(collected(2))).toBe(2);
  });

  it('never reports negative minutes once the session has expired', () => {
    const past = new Date('2026-08-23T13:00:00Z');
    expect(minutesRemaining(session(), past)).toBe(0);
    expect(minutesRemaining(session(), new Date('2026-08-23T12:20:00Z'))).toBe(10);
  });
});

describe('progress copy', () => {
  it('names what is still outstanding before anything arrives', () => {
    expect(describeProgress(session(), false)).toBe(
      'Waiting for 2 more guardians of your 2.',
    );
  });

  it('says the kit already counts, and asks for one guardian fewer', () => {
    expect(describeProgress(session(), true)).toBe(
      'Your Recovery Kit counts as one piece. Waiting for 1 more guardian of your 2.',
    );
  });

  it('counts down as shares arrive', () => {
    expect(describeProgress(collected(1), false)).toBe(
      'Waiting for 1 more guardian of your 2.',
    );
  });

  it('stops counting once the kit and one guardian meet a 2-of-3', () => {
    expect(describeProgress(collected(1), true)).toBe('Every piece needed has arrived.');
  });

  it('stops counting once guardians alone meet the threshold', () => {
    expect(describeProgress(collected(2), false)).toBe('Every piece needed has arrived.');
  });
});

describe('the username field', () => {
  it('lowercases and trims what was typed', () => {
    expect(checkRecoveryUsername('  Alice1234ABCD ')).toEqual({
      ok: true,
      username: 'alice1234abcd',
    });
  });

  it('rejects an empty field', () => {
    expect(checkRecoveryUsername('   ').ok).toBe(false);
  });

  it('rejects a phrase pasted into the username field', () => {
    expect(checkRecoveryUsername('abandon abandon about').ok).toBe(false);
  });
});
