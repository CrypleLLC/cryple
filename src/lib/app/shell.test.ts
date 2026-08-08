import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import type { PendingPinReset, PendingSession } from '@/lib/recovery';
import type { SecretMetaRecord, SecretRecord } from '@/lib/secrets';
import type { Beneficiary, ReleaseStatusRecord, ReleaseVoteReport } from '@/lib/succession';
import { KekNotSpecifiedError } from '@/lib/secrets';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import { hexToBytes } from '@/lib/encoding';
import { buildActionPayload, createChallenge, currentTimestamp, signPayload } from '@/lib/signing';
import {
  actionableCount,
  auditVotes,
  buildBeneficiaryViews,
  buildInbox,
  buildReleaseView,
  buildVaultIndex,
  checkIntegrity,
  decodeRecoveryKitShare,
  encodeRecoveryKitShare,
  formatBytes,
  hasExpired,
  INBOX_POLL_INTERVAL_MS,
  isVaultSealed,
  RECOVERY_KIT_PREFIX,
  RecoveryKitParseError,
  renderRecoveryKit,
} from './index';

const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));
const OWNER_ADDRESS = 'a'.repeat(64);

function session(overrides: Partial<PendingSession> = {}): PendingSession {
  return {
    session_id: '9c1e5f2a-4f89-11d3-9a0c-0305e82c3301',
    owner_username: '3f1c8a2b9d4e',
    ephemeral_x25519_public: 'x',
    ephemeral_mlkem_public: 'm',
    submitted: false,
    expires_at: '2026-07-26T12:30:00Z',
    created_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function reset(overrides: Partial<PendingPinReset> = {}): PendingPinReset {
  return {
    request_id: '7b3d5e1c-4f89-11d3-9a0c-0305e82c3301',
    owner_username: 'a92f4c1d8e0b',
    status: 'pending_quorum',
    voted: false,
    created_at: '2026-07-26T11:00:00Z',
    ...overrides,
  };
}

describe('the guardian inbox merges both queues', () => {
  it('polls about once a minute, not every few seconds', () => {
    expect(INBOX_POLL_INTERVAL_MS).toBe(60_000);
  });

  it('carries recovery sessions and PIN resets side by side', () => {
    const items = buildInbox([session()], [reset()]);

    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.kind))).toEqual(
      new Set(['recovery-session', 'pin-reset']),
    );
  });

  it('floats what needs the guardian to act to the top', () => {
    const items = buildInbox(
      [session({ submitted: true })],
      [reset({ created_at: '2026-07-26T09:00:00Z' })],
    );

    expect(items[0].kind).toBe('pin-reset');
    expect(items[0].actionable).toBe(true);
    expect(items[1].actionable).toBe(false);
  });

  it('orders equally actionable items newest first', () => {
    const items = buildInbox(
      [session({ created_at: '2026-07-26T08:00:00Z' })],
      [reset({ created_at: '2026-07-26T13:00:00Z' })],
    );

    expect(items[0].kind).toBe('pin-reset');
  });

  it('counts only what the guardian can still act on', () => {
    const items = buildInbox(
      [session(), session({ session_id: 'other', submitted: true })],
      [reset({ status: 'contest_period' }), reset({ request_id: 'voted', voted: true })],
    );

    expect(actionableCount(items)).toBe(1);
  });

  it('treats a contest_period reset as informational, never as a vote prompt', () => {
    const [item] = buildInbox([], [reset({ status: 'contest_period' })]);

    expect(item.actionable).toBe(false);
    expect(item.detail).toMatch(/contest period/i);
  });

  it('marks an already-submitted share as done rather than hiding it', () => {
    const [item] = buildInbox([session({ submitted: true })], []);

    expect(item.actionable).toBe(false);
    expect(item.detail).toMatch(/already sent/i);
  });

  it('reports a recovery session as expired once its 30 minutes are up', () => {
    const [item] = buildInbox([session()], []);

    expect(hasExpired(item, new Date('2026-07-26T12:15:00Z'))).toBe(false);
    expect(hasExpired(item, new Date('2026-07-26T13:00:00Z'))).toBe(true);
  });

  it('has no expiry for a PIN reset — its clock is the 48h contest period', () => {
    const [item] = buildInbox([], [reset()]);
    expect(item.expiresAt).toBeUndefined();
  });
});

describe('the vault index', () => {
  function meta(overrides: Partial<SecretMetaRecord> = {}): SecretMetaRecord {
    return {
      id: '0c892e57-93cf-423a-a9e9-fee5a9f87681',
      ciphertext_sha256: 'aa'.repeat(32),
      ciphertext_bytes: 2048,
      version: 'v1',
      created_at: '2026-07-26T12:00:00Z',
      updated_at: '2026-07-26T12:00:00Z',
      ...overrides,
    };
  }

  it('renders newest first', () => {
    const index = buildVaultIndex([
      meta({ id: 'old', updated_at: '2026-07-20T12:00:00Z' }),
      meta({ id: 'new', updated_at: '2026-07-28T12:00:00Z' }),
    ]);

    expect(index.map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('hashes the ciphertext it received rather than trusting the reported digest', async () => {
    const [entry] = buildVaultIndex([meta()]);
    const secret: SecretRecord = {
      id: entry.id,
      ciphertext: 'AQIDBA==',
      wrapped_dek: 'x',
      version: 'v1',
      created_at: entry.updatedAt,
      updated_at: entry.updatedAt,
    };

    const result = await checkIntegrity(secret, entry);

    expect(result.matches).toBe(false);
    expect(result.hash).not.toBe(entry.reportedHash);
  });

  it('reports a match when the received bytes really do hash to the reported digest', async () => {
    const ciphertext = 'AQIDBA==';
    const secret: SecretRecord = {
      id: 'x',
      ciphertext,
      wrapped_dek: 'x',
      version: 'v1',
      created_at: '2026-07-26T12:00:00Z',
      updated_at: '2026-07-26T12:00:00Z',
    };

    const probe = await checkIntegrity(secret, buildVaultIndex([meta()])[0]);
    const [entry] = buildVaultIndex([meta({ ciphertext_sha256: probe.hash })]);

    expect((await checkIntegrity(secret, entry)).matches).toBe(true);
  });

  it('recognises the sealed-vault condition rather than showing a raw crash', () => {
    expect(isVaultSealed(new KekNotSpecifiedError('unwrapDek'))).toBe(true);
    expect(isVaultSealed(new Error('network down'))).toBe(false);
  });

  it('formats sizes for the index', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB');
  });
});

describe('the succession dashboard stays inside the reachable states', () => {
  function status(overrides: Partial<ReleaseStatusRecord> = {}): ReleaseStatusRecord {
    return {
      status: 'monitoring',
      votes: 0,
      required_votes: 2,
      release_cycle: 1,
      inactivity_threshold_days: 180,
      last_check_in: '2026-07-26T12:00:00Z',
      ...overrides,
    };
  }

  it('renders the monitoring state without implying a countdown', () => {
    const view = buildReleaseView(status());

    expect(view.status).toBe('monitoring');
    expect(view.countdownStartedAt).toBeUndefined();
    expect(view.headline).toMatch(/monitoring normally/);
  });

  it('renders the countdown once a quorum starts one', () => {
    const view = buildReleaseView(
      status({ status: 'counting_down', votes: 2, trigger_started_at: '2026-07-26T12:00:00Z' }),
    );

    expect(view.headline).toMatch(/countdown is running/);
    expect(view.countdownStartedAt?.toISOString()).toBe('2026-07-26T12:00:00.000Z');
  });

  it('audits each vote by rebuilding the payload, and separates verified from not', () => {
    const challenge = createChallenge();
    const timestamp = currentTimestamp();
    const good = signPayload(
      buildActionPayload(challenge, timestamp, 'succession-release-vote', [OWNER_ADDRESS, 1]),
      tree.identity.privateKey,
    );

    const report: ReleaseVoteReport = {
      action: 'succession-release-vote',
      owner_user_address: OWNER_ADDRESS,
      release_cycle: 1,
      votes: [
        {
          guardian_username: 'g1',
          guardian_public_key: vectors.identity_key_p256.public_key_spki_base64,
          release_cycle: 1,
          signature: good,
          challenge,
          timestamp,
          voted_at: '2026-07-29T17:20:46Z',
        },
        {
          guardian_username: 'g2',
          guardian_public_key: vectors.identity_key_p256.public_key_spki_base64,
          release_cycle: 1,
          signature: good,
          challenge: createChallenge(),
          timestamp,
          voted_at: '2026-07-29T17:21:46Z',
        },
      ],
    };

    const audited = auditVotes(report);

    expect(audited.verifiedCount).toBe(1);
    expect(audited.unverifiedCount).toBe(1);
    expect(audited.ownerUserAddress).toBe(OWNER_ADDRESS);
  });

  it('labels a closed heir account instead of rendering an empty username', () => {
    const beneficiaries: Beneficiary[] = [
      {
        id: '1a2b3c4d-4f89-11d3-9a0c-0305e82c3301',
        user_uuid: '',
        username: '',
        encrypted_label: 'x',
        public_key_x25519_snapshot: 'x',
        public_key_mlkem_snapshot: 'x',
        status: 'active',
        keys_rotated: true,
        share_count: 3,
        created_at: '2026-07-26T12:00:00Z',
      },
    ];

    const [view] = buildBeneficiaryViews(beneficiaries);

    expect(view.accountClosed).toBe(true);
    expect(view.username).toBe('(account closed)');
    expect(view.shareCount).toBe(3);
  });
});

describe('the Recovery Kit surface for share 0', () => {
  const share = new Uint8Array(33).map((_, index) => index * 7);

  it('round-trips a share through its printable form', async () => {
    const encoded = await encodeRecoveryKitShare(share);
    expect(await decodeRecoveryKitShare(encoded)).toEqual(share);
  });

  it('carries a version prefix so a later format change is detectable', async () => {
    expect(await encodeRecoveryKitShare(share)).toMatch(
      new RegExp(`^${RECOVERY_KIT_PREFIX}-`),
    );
  });

  it('reads back a share the user retyped with different spacing and case', async () => {
    const encoded = await encodeRecoveryKitShare(share);
    const retyped = `  ${encoded.toLowerCase().replace(/-/g, ' ')}  `;

    expect(await decodeRecoveryKitShare(retyped)).toEqual(share);
  });

  it('catches a single mistyped character instead of returning a wrong share', async () => {
    const encoded = await encodeRecoveryKitShare(share);
    const index = encoded.length - 8;
    const wrong = encoded[index] === 'A' ? 'B' : 'A';
    const broken = `${encoded.slice(0, index)}${wrong}${encoded.slice(index + 1)}`;

    await expect(decodeRecoveryKitShare(broken)).rejects.toThrow(RecoveryKitParseError);
  });

  it('rejects text that is not a Recovery Kit share at all', async () => {
    await expect(decodeRecoveryKitShare('hello world')).rejects.toThrow(RecoveryKitParseError);
  });

  it('renders a kit that states the scheme and never claims it can be reissued', async () => {
    const kit = await renderRecoveryKit(share, {
      username: '3f1c8a2b9d4e',
      userAddress: OWNER_ADDRESS,
      threshold: 2,
      totalShares: 3,
      guardianUsernames: ['alice1234abcd', 'bob5678efgh'],
      createdAt: new Date('2026-08-06T00:00:00Z'),
    });

    expect(kit).toMatch(/2-of-3/);
    expect(kit).toMatch(/alice1234abcd, bob5678efgh/);
    expect(kit).toMatch(/cannot reissue it/);
    expect(kit).toContain(await encodeRecoveryKitShare(share));
  });
});
