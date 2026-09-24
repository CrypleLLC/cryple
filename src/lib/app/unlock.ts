import { DEVICE_REMOVED, rateLimitMessage } from '@/lib/api';

export const UNLOCK_COPY = {
  title: 'Unlock',
  subtitle: 'Enter this browser’s PIN.',
  submit: 'Unlock',
  submitting: 'Unlocking…',
  forgotten:
    'This browser has forgotten your account: too many wrong PINs were tried, or it was removed ' +
    'from another of your devices. Your vault is untouched. Enter your recovery phrase to add ' +
    'this browser again.',
  removed: DEVICE_REMOVED,
  offline:
    'Unlocking needs the server, and it cannot be reached right now. Check your connection and ' +
    'try again. This is not a PIN error, and no attempt was used.',
  removeBrowser: 'Remove this browser',
  startOver: 'I forgot this browser’s PIN',
  startOverConfirm:
    'This browser will forget your account and leave your devices. Your vault is untouched, and ' +
    'your recovery phrase adds this browser again, with a new PIN.',
  startOverSubmit: 'Forget this browser',
  stay: 'Keep trying the PIN',
} as const;

export function wrongPinMessage(attemptsRemaining: number): string {
  if (attemptsRemaining <= 1) {
    return (
      'Wrong PIN. One attempt left. After one more wrong PIN, this browser forgets your ' +
      'account, and you will need your recovery phrase to add it again.'
    );
  }
  return (
    `Wrong PIN. ${attemptsRemaining} attempts left. When none are left, this browser forgets ` +
    'your account, and you will need your recovery phrase to add it again.'
  );
}

export function unlockRateLimited(retryAfterSeconds: number | undefined): string {
  return rateLimitMessage(retryAfterSeconds);
}
