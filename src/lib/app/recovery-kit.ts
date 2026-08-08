import { bytesToHex, hexToBytes, sha256Hex } from '@/lib/encoding';
import { USER_SHARE_INDEX } from '@/lib/recovery';

export const RECOVERY_KIT_PREFIX = 'CRK1';
export const RECOVERY_KIT_GROUP_SIZE = 4;
const CHECKSUM_HEX_LENGTH = 4;

export interface RecoveryKitDetails {
  username: string;
  userAddress: string;
  threshold: number;
  totalShares: number;
  guardianUsernames: readonly string[];
  createdAt: Date;
}

export class RecoveryKitParseError extends Error {
  constructor(message: string) {
    super(`this does not look like a Recovery Kit share: ${message}`);
    this.name = 'RecoveryKitParseError';
  }
}

async function checksumOf(share: Uint8Array): Promise<string> {
  return (await sha256Hex(share)).slice(0, CHECKSUM_HEX_LENGTH);
}

function group(text: string): string {
  return (text.match(new RegExp(`.{1,${RECOVERY_KIT_GROUP_SIZE}}`, 'g')) ?? []).join('-');
}

export async function encodeRecoveryKitShare(share: Uint8Array): Promise<string> {
  const body = bytesToHex(share).toUpperCase();
  const checksum = (await checksumOf(share)).toUpperCase();
  return `${RECOVERY_KIT_PREFIX}-${group(body + checksum)}`;
}

export async function decodeRecoveryKitShare(text: string): Promise<Uint8Array> {
  const cleaned = text.replace(/\s+/g, '').replace(/-/g, '').toUpperCase();

  if (!cleaned.startsWith(RECOVERY_KIT_PREFIX)) {
    throw new RecoveryKitParseError(`it does not start with ${RECOVERY_KIT_PREFIX}`);
  }

  const payload = cleaned.slice(RECOVERY_KIT_PREFIX.length);
  if (!/^[0-9A-F]+$/.test(payload)) {
    throw new RecoveryKitParseError('it contains characters that are not hex digits');
  }
  if (payload.length <= CHECKSUM_HEX_LENGTH || payload.length % 2 !== 0) {
    throw new RecoveryKitParseError('it is too short or truncated');
  }

  const body = payload.slice(0, payload.length - CHECKSUM_HEX_LENGTH);
  const checksum = payload.slice(payload.length - CHECKSUM_HEX_LENGTH);
  const share = hexToBytes(body.toLowerCase());

  if ((await checksumOf(share)).toUpperCase() !== checksum) {
    throw new RecoveryKitParseError('its checksum does not match — check for a mistyped character');
  }

  return share;
}

export const RECOVERY_KIT_INSTRUCTIONS = [
  'Print this page or write it down, and store it somewhere only you can reach.',
  'This is one of the shares that rebuilds your vault. On its own it reveals nothing.',
  'You will be asked for it if you ever need your guardians to help you recover.',
  'Cryple cannot reissue it. If you lose it, your guardians alone must meet the threshold.',
] as const;

export async function renderRecoveryKit(
  share: Uint8Array,
  details: RecoveryKitDetails,
): Promise<string> {
  const encoded = await encodeRecoveryKitShare(share);
  const guardians =
    details.guardianUsernames.length === 0
      ? 'none yet'
      : details.guardianUsernames.join(', ');

  return [
    'CRYPLE RECOVERY KIT',
    '',
    `Account:    ${details.username}`,
    `Address:    ${details.userAddress}`,
    `Scheme:     ${details.threshold}-of-${details.totalShares}`,
    `Guardians:  ${guardians}`,
    `Created:    ${details.createdAt.toISOString()}`,
    `Share:      #${USER_SHARE_INDEX} (your own copy)`,
    '',
    encoded,
    '',
    ...RECOVERY_KIT_INSTRUCTIONS.map((line) => `- ${line}`),
  ].join('\n');
}
