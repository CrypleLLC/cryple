import type { PairingStatus } from '@/lib/pairing';

export const PAIRING_POLL_MS = 2000;
export const DEFAULT_EXTENSION_NAME = 'Password extension';

export const PAIRING_COPY = {
  title: 'Browser extension',
  summary:
    'Connect the Cryple password extension to this account. It can read and save your passwords, and nothing else — no secret, note, document or file.',
  start: 'Connect a browser extension',
  codeHeading: 'Type this code into the extension',
  codeHint: 'It works once and expires in five minutes.',
  compareHeading: 'Compare the numbers',
  compareHint:
    'The extension now shows a six-digit number. It must be exactly the number below. If it is not, someone else claimed this code.',
  match: 'The numbers match',
  mismatch: 'They don’t match',
  linking: 'Connecting…',
  linked: 'The extension is connected. Choose its PIN in the extension to finish.',
  mismatchWarning:
    'The connection was refused and the code is cancelled. Different numbers mean the extension that claimed this code is not the one in front of you. Start again, and only ever type the code into your own extension.',
  expired: 'The code expired before it was used. Start again when the extension is open.',
  cancelled: 'The connection was cancelled.',
  paranoidNote:
    'Paranoid Mode does not protect the extension: its own PIN does. Choose one you do not use anywhere else, and not your account PIN.',
  nameLabel: 'Name for this extension',
} as const;

export type ConnectStep =
  | { kind: 'idle' }
  | { kind: 'waiting'; id: string; code: string; expiresAt: string }
  | { kind: 'comparing'; id: string; code: string; expiresAt: string; fingerprint: string }
  | { kind: 'linking' }
  | { kind: 'linked' }
  | { kind: 'refused' }
  | { kind: 'ended'; reason: 'expired' | 'cancelled' };

export function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function endedBy(status: PairingStatus): 'expired' | 'cancelled' | undefined {
  if (status === 'expired') {
    return 'expired';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return undefined;
}
