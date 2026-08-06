import { request } from '@/lib/api';
import { sha256Hex, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { pqxdhWrap } from '@/lib/pqxdh';
import { signActionEnvelope } from '@/lib/signing';
import { requireToken, type AuthedContext } from '@/lib/context';
import { RecoveryValidationError } from './errors';
import { buildRecoveryVault } from './rek';
import { USER_SHARE_INDEX, validateSplitConfig, type RekShare } from './shamir';

export const CURRENT_SETUP_VERSION = 'v1';

export interface SetupShare {
  share_index: number;
  guardian_username?: string;
  pq_hybrid_encrypted_share: string;
}

export interface SetupPayload {
  encrypted_seed: string;
  n_shares: number;
  k_threshold: number;
  version?: string;
  shares: SetupShare[];
}

export interface SetupResult {
  n_shares: number;
  k_threshold: number;
  version: string;
  share_count: number;
  updated_at: string;
}

export interface GuardianRecipient {
  username: string;
  userAddress: string;
  x25519PublicKey: Uint8Array;
  mlkemPublicKey: Uint8Array;
}

export class SetupValidationError extends RecoveryValidationError {
  constructor(message: string) {
    super(message, 'SetupValidationError');
  }
}

function fail(message: string): never {
  throw new SetupValidationError(message);
}

export function canonicalSetupString(payload: SetupPayload): string {
  const shares = [...payload.shares].sort((a, b) => a.share_index - b.share_index);

  const parts = [
    payload.encrypted_seed,
    String(payload.n_shares),
    String(payload.k_threshold),
    payload.version ?? '',
  ];

  for (const share of shares) {
    parts.push(
      [
        String(share.share_index),
        share.guardian_username ?? '',
        share.pq_hybrid_encrypted_share,
      ].join(':'),
    );
  }

  return parts.join('|');
}

export async function setupDigest(payload: SetupPayload): Promise<string> {
  return sha256Hex(utf8ToBytes(canonicalSetupString(payload)));
}

export function validateSetupPayload(payload: SetupPayload): void {
  const { n_shares, k_threshold, shares, version } = payload;

  if (payload.encrypted_seed.length === 0) {
    fail('encrypted_seed must not be empty');
  }

  validateSplitConfig({ shares: n_shares, threshold: k_threshold });

  if (shares.length !== n_shares) {
    fail(`shares.length (${shares.length}) must equal n_shares (${n_shares})`);
  }

  if (version !== undefined && version !== '' && version !== CURRENT_SETUP_VERSION) {
    fail(`version must be omitted, empty, or "${CURRENT_SETUP_VERSION}", got "${version}"`);
  }

  const seenIndex = new Set<number>();
  const seenGuardian = new Set<string>();

  for (const share of shares) {
    const { share_index, guardian_username, pq_hybrid_encrypted_share } = share;

    if (!Number.isInteger(share_index) || share_index < 0 || share_index >= n_shares) {
      fail(`share_index ${share_index} is outside 0..${n_shares - 1}`);
    }
    if (seenIndex.has(share_index)) {
      fail(`duplicate share_index ${share_index}`);
    }
    seenIndex.add(share_index);

    if (pq_hybrid_encrypted_share.length === 0) {
      fail(`share ${share_index} has no ciphertext`);
    }

    if (share_index === USER_SHARE_INDEX) {
      if (guardian_username !== undefined && guardian_username !== '') {
        fail("share 0 is the owner's own share and takes no guardian");
      }
      continue;
    }

    if (guardian_username === undefined || guardian_username === '') {
      fail(`share ${share_index} needs a guardian_username`);
    }
    if (seenGuardian.has(guardian_username)) {
      fail(`guardian "${guardian_username}" holds more than one share`);
    }
    seenGuardian.add(guardian_username);
  }

  if (!seenIndex.has(USER_SHARE_INDEX)) {
    fail('share_index 0 is required — it is the owner\'s Recovery Kit share');
  }
}

export interface BuildSetupOptions {
  seedPhrase: string;
  ownerUserAddress: string;
  ownerX25519PublicKey: Uint8Array;
  ownerMlkemPublicKey: Uint8Array;
  guardians: readonly GuardianRecipient[];
  threshold: number;
  version?: string;
}

export interface BuiltSetup {
  payload: SetupPayload;
  recoveryKitShare: Uint8Array;
}

export async function buildSetupPayload(options: BuildSetupOptions): Promise<BuiltSetup> {
  const {
    seedPhrase,
    ownerUserAddress,
    ownerX25519PublicKey,
    ownerMlkemPublicKey,
    guardians,
    threshold,
    version,
  } = options;

  const nShares = guardians.length + 1;
  validateSplitConfig({ shares: nShares, threshold });

  const { encryptedSeed, shares } = await buildRecoveryVault(seedPhrase, {
    shares: nShares,
    threshold,
  });

  const byIndex = new Map<number, RekShare>(shares.map((s) => [s.shareIndex, s]));
  const ownShare = byIndex.get(USER_SHARE_INDEX)!;
  const recoveryKitShare = ownShare.bytes.slice();

  const wrapped: SetupShare[] = [];

  try {
    wrapped.push({
      share_index: USER_SHARE_INDEX,
      pq_hybrid_encrypted_share: await pqxdhWrap(
        ownShare.bytes,
        { x25519PublicKey: ownerX25519PublicKey, mlkemPublicKey: ownerMlkemPublicKey },
        {
          usage: 'recovery-share',
          senderUserAddress: ownerUserAddress,
          recipientUserAddress: ownerUserAddress,
        },
      ),
    });

    for (const [position, guardian] of guardians.entries()) {
      const shareIndex = position + 1;
      const share = byIndex.get(shareIndex)!;

      wrapped.push({
        share_index: shareIndex,
        guardian_username: guardian.username,
        pq_hybrid_encrypted_share: await pqxdhWrap(
          share.bytes,
          {
            x25519PublicKey: guardian.x25519PublicKey,
            mlkemPublicKey: guardian.mlkemPublicKey,
          },
          {
            usage: 'recovery-share',
            senderUserAddress: ownerUserAddress,
            recipientUserAddress: guardian.userAddress,
          },
        ),
      });
    }
  } finally {
    for (const share of shares) {
      zeroBytes(share.bytes);
    }
  }

  const payload: SetupPayload = {
    encrypted_seed: encryptedSeed,
    n_shares: nShares,
    k_threshold: threshold,
    ...(version === undefined ? {} : { version }),
    shares: wrapped,
  };

  validateSetupPayload(payload);

  return { payload, recoveryKitShare };
}

export async function submitRecoverySetup(
  context: AuthedContext,
  payload: SetupPayload,
): Promise<SetupResult> {
  validateSetupPayload(payload);

  const digest = await setupDigest(payload);

  const envelope = signActionEnvelope(
    'recovery-setup',
    [digest],
    {
      privateKey: context.session.identityPrivateKey,
      serverAuthToken: context.session.serverAuthToken(),
    },
    { paranoid: context.paranoid },
  );

  const response = await request<SetupResult>({
    method: 'PUT',
    path: '/recovery/setup',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { ...payload, ...envelope },
  });

  return response.data;
}
